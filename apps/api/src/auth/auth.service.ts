import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

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
    if (error) throw new UnauthorizedException(error.message);
    if (!data) throw new UnauthorizedException('Email o clave incorrectos');

    const usuario = data as any;
    const token = await this.jwt.signAsync({
      sub: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      sucursalId: usuario.sucursal_id,
    });
    return {
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
    };
  }
}
