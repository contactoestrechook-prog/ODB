import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class CajaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async cajas() {
    const { data, error } = await this.db
      .from('cajas')
      .select('id, nombre, sucursal:sucursales(id, nombre)')
      .order('nombre');
    if (error) throw new BadRequestException(error.message);

    const { data: abiertas } = await this.db
      .from('sesiones_caja')
      .select('id, caja_id, monto_inicial, abierta_en, usuario:usuarios(nombre)')
      .is('cerrada_en', null);
    const porCaja = new Map((abiertas ?? []).map((s: any) => [s.caja_id, s]));
    return (data ?? []).map((c: any) => ({ ...c, sesionAbierta: porCaja.get(c.id) ?? null }));
  }

  async abrir(cajaId: string, montoInicial: number, usuarioId: string) {
    const { data, error } = await this.db.rpc('abrir_sesion_caja', {
      p_caja: cajaId,
      p_usuario: usuarioId,
      p_monto_inicial: montoInicial,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { sesionId: data };
  }

  async cerrar(sesionId: string, montoCierre: number) {
    const { data, error } = await this.db.rpc('cerrar_sesion_caja', {
      p_sesion: sesionId,
      p_monto_cierre: montoCierre,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  async sesiones(limite = 30) {
    const { data, error } = await this.db
      .from('sesiones_caja')
      .select(
        `id, monto_inicial, monto_cierre, diferencia, abierta_en, cerrada_en,
         caja:cajas(nombre, sucursal:sucursales(nombre)),
         usuario:usuarios(nombre)`,
      )
      .order('abierta_en', { ascending: false })
      .limit(Math.min(limite, 100));
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private traducirError(mensaje: string): string {
    if (mensaje.includes('permission denied')) {
      return 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env';
    }
    return mensaje;
  }
}
