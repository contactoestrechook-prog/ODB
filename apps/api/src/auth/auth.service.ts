import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { hashClave, verificarClave } from '../comun/passwords';
import { enviarMail, mailDeReseteo, hayMailConfigurado } from '../comun/mail';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, clave: string) {
    const { data, error } = await this.db
      .rpc('verificar_login', { p_email: email, p_clave: clave })
      .maybeSingle();
    // La cuenta se enfría sola tras 5 claves erradas: el mensaje del bloqueo se
    // muestra tal cual para que el empleado sepa cuánto esperar en vez de seguir
    // probando (el límite por IP no alcanza: vive en memoria de cada réplica).
    if (error) {
      const bloqueada = /bloqueada/i.test(error.message ?? '');
      throw new UnauthorizedException(bloqueada ? error.message : 'Email o clave incorrectos');
    }
    if (!data) throw new UnauthorizedException('Email o clave incorrectos');

    const usuario = data as any;
    const debeCambiarClave = usuario.debe_cambiar_clave === true;
    const token = await this.firmar(usuario);
    return {
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, debeCambiarClave },
    };
  }

  // ---- OLVIDÉ MI CONTRASEÑA ----
  // Pedir el enlace. Contesta SIEMPRE lo mismo exista o no el mail: si dijera
  // "ese mail no está registrado" cualquiera podría averiguar quién tiene
  // usuario en el sistema probando direcciones.
  async pedirReseteo(email: string, origen?: string) {
    const generico = {
      ok: true,
      mensaje: 'Si ese mail tiene una cuenta, le llega un enlace para elegir una contraseña nueva. Revisá también el correo no deseado.',
    };
    const limpio = String(email ?? '').trim().toLowerCase();
    if (!limpio || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio)) return generico;

    const { data: u } = await this.db
      .from('usuarios')
      .select('id, nombre, email, activo')
      .ilike('email', limpio)
      .maybeSingle();
    if (!u || (u as any).activo === false) return generico;
    const usuario = u as any;

    // freno de abuso: como mucho 3 pedidos por usuario cada 15 minutos
    const { count } = await this.db
      .from('reseteos_clave')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', usuario.id)
      .gte('creado_en', new Date(Date.now() - 15 * 60_000).toISOString());
    if ((count ?? 0) >= 3) return generico;

    // el token viaja en el enlace; en la base queda solo su huella
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { error } = await this.db.from('reseteos_clave').insert({
      usuario_id: usuario.id,
      token_hash: tokenHash,
      vence_en: new Date(Date.now() + 30 * 60_000).toISOString(),
      pedido_desde: origen ?? null,
    });
    if (error) throw new BadRequestException(error.message);

    const base = (process.env.ODB_PANEL_URL ?? 'https://odb-admin-production.up.railway.app').replace(/\/$/, '');
    const enlace = `${base}/restablecer?token=${token}`;
    const { asunto, html, texto } = mailDeReseteo(usuario.nombre ?? 'Hola', enlace);
    const envio = await enviarMail({ para: usuario.email, asunto, html, texto });
    if (!envio.enviado) {
      // Sin mail configurado el circuito no se cae: queda registrado para que
      // un dueño pueda pasarle el enlace a la persona por otro medio.
      this.log.warn(`reseteo de ${usuario.email}: no se pudo mandar el mail (${envio.motivo})`);
    }
    return generico;
  }

  // Validar el enlace antes de mostrar el formulario (que no escriba una clave
  // nueva para enterarse recién al final de que el enlace venció).
  async verificarTokenReseteo(token: string) {
    const fila = await this.buscarReseteoVigente(token);
    return { valido: !!fila, nombre: fila?.nombre ?? null };
  }

  // Elegir la clave nueva con el enlace.
  async resetearClave(token: string, claveNueva: string) {
    if (!claveNueva || claveNueva.length < 6) {
      throw new BadRequestException('La clave nueva debe tener al menos 6 caracteres');
    }
    const fila = await this.buscarReseteoVigente(token);
    if (!fila) {
      throw new BadRequestException('El enlace venció o ya se usó. Pedí uno nuevo desde "Olvidé mi contraseña".');
    }
    const { error } = await this.db
      .from('usuarios')
      .update({ clave_hash: hashClave(claveNueva), debe_cambiar_clave: false, intentos_fallidos: 0, bloqueado_hasta: null })
      .eq('id', fila.usuario_id);
    if (error) throw new BadRequestException(error.message);

    // el usado y TODOS los demás pendientes de esa persona se queman
    await this.db.from('reseteos_clave')
      .update({ usado_en: new Date().toISOString() })
      .eq('usuario_id', fila.usuario_id)
      .is('usado_en', null);

    await this.db.from('auditoria').insert({
      usuario_id: fila.usuario_id, accion: 'clave_restablecida', entidad: 'usuario',
      entidad_id: fila.usuario_id, datos_despues: { via: 'enlace de mail' },
    }).then(() => null, () => null);

    return { ok: true, mensaje: 'Listo: ya podés entrar con tu contraseña nueva.' };
  }

  private async buscarReseteoVigente(token: string) {
    const limpio = String(token ?? '').trim();
    if (!limpio) return null;
    const tokenHash = createHash('sha256').update(limpio).digest('hex');
    const { data } = await this.db
      .from('reseteos_clave')
      .select('id, usuario_id, vence_en, usado_en, usuarios(nombre, activo)')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    const f = data as any;
    if (!f || f.usado_en) return null;
    if (new Date(f.vence_en).getTime() < Date.now()) return null;
    if (f.usuarios?.activo === false) return null;
    return { usuario_id: f.usuario_id as string, nombre: (f.usuarios?.nombre ?? null) as string | null };
  }

  // Cambio de la propia clave (usuario autenticado). Verifica la actual, valida
  // la nueva y baja la bandera debe_cambiar_clave. Devuelve un token fresco.
  async cambiarClave(usuarioId: string, claveActual: string, claveNueva: string) {
    if (!claveNueva || claveNueva.length < 6) {
      throw new BadRequestException('La clave nueva debe tener al menos 6 caracteres');
    }
    if (claveActual === claveNueva) {
      throw new BadRequestException('La clave nueva tiene que ser distinta a la actual');
    }
    const { data: u } = await this.db
      .from('usuarios')
      .select('id, nombre, rol, sucursal_id, clave_hash, activo')
      .eq('id', usuarioId)
      .maybeSingle();
    if (!u || u.activo === false) throw new UnauthorizedException('Usuario inexistente o inactivo');
    if (!verificarClave(claveActual, u.clave_hash)) {
      throw new BadRequestException('La clave actual no es correcta');
    }

    const { error } = await this.db
      .from('usuarios')
      .update({ clave_hash: hashClave(claveNueva), debe_cambiar_clave: false })
      .eq('id', usuarioId);
    if (error) throw new BadRequestException(error.message);

    await this.db.from('auditoria').insert({
      usuario_id: usuarioId,
      accion: 'cambiar_clave',
      entidad: 'usuario',
      entidad_id: usuarioId,
      datos_despues: { propia: true },
    });

    const token = await this.firmar(u);
    return { ok: true, token, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, debeCambiarClave: false } };
  }

  private firmar(u: any) {
    return this.jwt.signAsync({
      sub: u.id,
      nombre: u.nombre,
      rol: u.rol,
      sucursalId: u.sucursal_id,
    });
  }
}
