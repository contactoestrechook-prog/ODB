import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { hashClave, verificarClave } from '../comun/passwords';

@Injectable()
export class AuthService {
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
