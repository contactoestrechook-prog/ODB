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
      .select('id, caja_id, monto_inicial, abierta_en, usuario:usuarios!sesiones_caja_usuario_id_fkey(nombre)')
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
         usuario:usuarios!sesiones_caja_usuario_id_fkey(nombre)`,
      )
      .order('abierta_en', { ascending: false })
      .limit(Math.min(limite, 100));
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Arqueos agrupados por cajero (control de desempeño y faltantes)
  async porCajero() {
    const { data, error } = await this.db
      .from('sesiones_caja')
      .select('monto_cierre, diferencia, cerrada_en, abierta_en, usuario:usuarios!sesiones_caja_usuario_id_fkey(id, nombre, rol)')
      .not('cerrada_en', 'is', null)
      .order('cerrada_en', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const porUsuario = new Map<string, any>();
    for (const s of (data ?? []) as any[]) {
      const u = s.usuario;
      if (!u) continue;
      const acc = porUsuario.get(u.id) ?? {
        usuario: u.nombre, rol: u.rol, cierres: 0, totalCerrado: 0,
        diferenciaNeta: 0, conDiferencia: 0, ultimoCierre: null as string | null,
      };
      acc.cierres += 1;
      acc.totalCerrado += Number(s.monto_cierre ?? 0);
      acc.diferenciaNeta += Number(s.diferencia ?? 0);
      if (Number(s.diferencia ?? 0) !== 0) acc.conDiferencia += 1;
      if (!acc.ultimoCierre || s.cerrada_en > acc.ultimoCierre) acc.ultimoCierre = s.cerrada_en;
      porUsuario.set(u.id, acc);
    }
    return [...porUsuario.values()]
      .map((a) => ({ ...a, totalCerrado: Math.round(a.totalCerrado), diferenciaNeta: Math.round(a.diferenciaNeta) }))
      .sort((a, b) => b.cierres - a.cierres);
  }

  // Resumen de cajas y arqueos (KPIs del workspace)
  async resumen() {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const [cajasR, abiertasR, mesR] = await Promise.all([
      this.db.from('cajas').select('id'),
      this.db.from('sesiones_caja').select('id, monto_inicial').is('cerrada_en', null),
      this.db.from('sesiones_caja').select('diferencia').gte('abierta_en', inicioMes.toISOString()).not('cerrada_en', 'is', null),
    ]);
    const cerradasMes = (mesR.data ?? []) as any[];
    return {
      cajasTotal: (cajasR.data ?? []).length,
      cajasAbiertas: (abiertasR.data ?? []).length,
      baseEnCajas: (abiertasR.data ?? []).reduce((s: number, x: any) => s + Number(x.monto_inicial), 0),
      sesionesMes: cerradasMes.length,
      conDiferenciaMes: cerradasMes.filter((s) => Number(s.diferencia) !== 0).length,
      diferenciaNetaMes: Math.round(cerradasMes.reduce((s, x) => s + Number(x.diferencia ?? 0), 0)),
    };
  }

  private traducirError(mensaje: string): string {
    if (mensaje.includes('permission denied')) {
      return 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env';
    }
    return mensaje;
  }
}
