import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
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

  async registro(dni: string, nombre: string, clave: string, fechaNacimiento?: string, codigoReferido?: string) {
    const dniLimpio = (dni ?? '').replace(/\D/g, '');
    const nac = /^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento ?? '') ? fechaNacimiento : null;
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
      await this.db.from('clientes').update({ nombre, ...(nac ? { fecha_nacimiento: nac } : {}) }).eq('id', existente.id);
    } else {
      const { data: creado } = await this.db
        .from('clientes')
        .insert({ dni: dniLimpio, nombre, fecha_nacimiento: nac })
        .select('id')
        .single();
      // El referido SOLO aplica a clientes nuevos (los que ya compraron en caja no cuentan)
      if (creado?.id && codigoReferido) await this.aplicarReferido(creado.id, codigoReferido);
    }

    return this.login(dniLimpio, clave);
  }

  // --- Auth por EMAIL (tienda web). Convive con el alta por DNI de la app. ---
  async registroEmail(email: string, nombre: string, clave: string, codigoReferido?: string) {
    const mail = (email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new BadRequestException('Email inválido');
    if ((clave ?? '').length < 6) throw new BadRequestException('La clave debe tener al menos 6 caracteres');

    const { error } = await this.db.auth.admin.createUser({
      email: mail,
      password: clave,
      email_confirm: true,
      user_metadata: { nombre, email: mail },
    });
    if (error) {
      throw new BadRequestException(
        error.message.includes('already') ? 'Ese email ya tiene cuenta: iniciá sesión' : error.message,
      );
    }

    const { data: existente } = await this.db.from('clientes').select('id').eq('email', mail).maybeSingle();
    if (existente) {
      await this.db.from('clientes').update({ nombre }).eq('id', existente.id);
    } else {
      const { data: creado } = await this.db.from('clientes').insert({ email: mail, nombre }).select('id').single();
      if (creado?.id && codigoReferido) await this.aplicarReferido(creado.id, codigoReferido);
    }
    return this.loginEmail(mail, clave);
  }

  async loginEmail(email: string, clave: string) {
    const mail = (email ?? '').trim().toLowerCase();
    const verificador = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await verificador.auth.signInWithPassword({ email: mail, password: clave });
    if (error) throw new UnauthorizedException('Email o clave incorrectos');

    let { data: cliente } = await this.db
      .from('clientes')
      .select('id, dni, nombre, tipo, puntos, verificado, email')
      .eq('email', mail)
      .maybeSingle();
    if (!cliente) {
      const { data: creado } = await this.db
        .from('clientes')
        .insert({ email: mail })
        .select('id, dni, nombre, tipo, puntos, verificado, email')
        .single();
      cliente = creado;
    }
    const token = await this.jwt.signAsync({
      sub: cliente!.id,
      dni: cliente!.dni,
      email: cliente!.email,
      nombre: cliente!.nombre,
      rol: 'cliente',
      verificado: cliente!.verificado === true,
    });
    return { token, cliente };
  }

  // Vincula al nuevo cliente con quien lo invitó (anti auto-referido y anti duplicado).
  private async aplicarReferido(nuevoId: string, codigo: string) {
    const cod = (codigo ?? '').trim().toUpperCase();
    if (!cod) return;
    const { data: ref } = await this.db
      .from('clientes')
      .select('id')
      .eq('codigo_referido', cod)
      .maybeSingle();
    if (!ref || ref.id === nuevoId) return;
    await this.db.from('clientes').update({ referido_por: ref.id }).eq('id', nuevoId).is('referido_por', null);
    // unique(referido_id) garantiza un solo referidor por invitado
    await this.db.from('referidos').insert({ referrer_id: ref.id, referido_id: nuevoId });
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
      verificado: cliente!.verificado === true,
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
  // Se valida la firma HMAC-SHA256 del cuerpo crudo contra DIDIT_WEBHOOK_SECRET
  // (y un timestamp reciente) para que nadie pueda falsificar una verificación.
  async webhook(rawBody: Buffer | undefined, headers: Record<string, string>) {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) {
      throw new ForbiddenException('Webhook de Didit sin configurar (falta DIDIT_WEBHOOK_SECRET)');
    }
    const firma = headers['x-signature'] ?? headers['x-didit-signature'];
    const ts = headers['x-timestamp'];
    if (!rawBody || !firma) throw new ForbiddenException('Webhook sin firma');

    const esperada = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(firma);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException('Firma de webhook inválida');
    }
    // anti-replay: el timestamp (si viene) no puede tener más de 5 minutos
    if (ts && Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      throw new ForbiddenException('Webhook expirado');
    }

    let payload: any = {};
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return { ok: false }; }
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
