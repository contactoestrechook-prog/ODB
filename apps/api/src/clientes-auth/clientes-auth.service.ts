import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Cuentas de clientes de la app sobre Supabase Auth (GoTrue):
// el DNI se mapea a un email sintético interno. GoTrue hashea las claves,
// maneja sesiones y deja listo el recupero de clave para más adelante.
const emailPara = (dni: string) => `${dni.trim()}@clientes.odb.interno`;

@Injectable()
export class ClientesAuthService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly jwt: JwtService,
  ) {}

  async registro(dni: string, nombre: string, clave: string) {
    const dniLimpio = (dni ?? '').replace(/\D/g, '');
    if (!/^\d{7,9}$/.test(dniLimpio)) throw new BadRequestException('DNI inválido');
    if ((clave ?? '').length < 6) {
      throw new BadRequestException('La clave debe tener al menos 6 caracteres');
    }

    const { error } = await this.db.auth.admin.createUser({
      email: emailPara(dniLimpio),
      password: clave,
      email_confirm: true,
      user_metadata: { dni: dniLimpio, nombre },
    });
    if (error) {
      throw new BadRequestException(
        error.message.includes('already') ? 'Ese DNI ya tiene cuenta: iniciá sesión' : error.message,
      );
    }

    // ficha comercial del cliente (se crea o se completa si ya compró en caja)
    const { data: existente } = await this.db
      .from('clientes')
      .select('id')
      .eq('dni', dniLimpio)
      .maybeSingle();
    if (existente) {
      await this.db.from('clientes').update({ nombre }).eq('id', existente.id);
    } else {
      await this.db.from('clientes').insert({ dni: dniLimpio, nombre });
    }

    return this.login(dniLimpio, clave);
  }

  async login(dni: string, clave: string) {
    const dniLimpio = (dni ?? '').replace(/\D/g, '');
    // Cliente descartable SOLO para validar la clave: si usáramos el cliente
    // global, signInWithPassword le pegaría la sesión del usuario y la API
    // dejaría de operar con permisos de servicio.
    const verificador = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sesion, error } = await verificador.auth.signInWithPassword({
      email: emailPara(dniLimpio),
      password: clave,
    });
    if (error) throw new UnauthorizedException('DNI o clave incorrectos');

    let { data: cliente } = await this.db
      .from('clientes')
      .select('id, dni, nombre, tipo, puntos, verificado')
      .eq('dni', dniLimpio)
      .maybeSingle();

    // autocuración: si la cuenta existe en Auth pero falta la ficha comercial
    if (!cliente) {
      const nombre = (sesion.user?.user_metadata as any)?.nombre ?? null;
      const { data: creado } = await this.db
        .from('clientes')
        .insert({ dni: dniLimpio, nombre })
        .select('id, dni, nombre, tipo, puntos, verificado')
        .single();
      cliente = creado;
    }

    const token = await this.jwt.signAsync({
      sub: cliente!.id,
      dni: cliente!.dni,
      nombre: cliente!.nombre,
      rol: 'cliente',
    });
    return { token, cliente };
  }

  // --- Verificación de identidad (Didit: DNI + rostro contra RENAPER) ---
  async crearVerificacion(dni: string) {
    if (!process.env.DIDIT_API_KEY || !process.env.DIDIT_WORKFLOW_ID) {
      throw new BadRequestException(
        'Verificación biométrica sin configurar: crear la cuenta en didit.me (gratis hasta 500/mes), y poner DIDIT_API_KEY y DIDIT_WORKFLOW_ID en apps/api/.env',
      );
    }
    const res = await fetch('https://verification.didit.me/v3/session/', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.DIDIT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: process.env.DIDIT_WORKFLOW_ID,
        vendor_data: dni,
        callback: process.env.DIDIT_CALLBACK_URL ?? undefined,
      }),
    });
    const datos = (await res.json()) as any;
    if (!res.ok) throw new BadRequestException(`Didit: ${datos.detail ?? res.status}`);

    await this.db
      .from('clientes')
      .update({ verificacion_id: datos.session_id })
      .eq('dni', dni);
    return { url: datos.url, sessionId: datos.session_id };
  }

  // Webhook de Didit: marca al cliente como verificado cuando aprueba.
  // TODO(produccion): validar la firma X-Didit-Signature con el webhook secret.
  async webhook(payload: any) {
    const estado = payload?.status ?? payload?.decision?.status;
    const dni = payload?.vendor_data;
    if (!dni) return { ok: false };
    if (['Approved', 'approved', 'APPROVED'].includes(estado)) {
      await this.db
        .from('clientes')
        .update({
          verificado: true,
          verificado_en: new Date().toISOString(),
          consentimiento_datos: new Date().toISOString(),
        })
        .eq('dni', String(dni));
    }
    return { ok: true };
  }
}
