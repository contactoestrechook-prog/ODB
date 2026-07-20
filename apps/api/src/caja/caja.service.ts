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

  // usuarioId/rol: un cajero solo puede cerrar SU sesión; gerencia cierra cualquiera.
  async cerrar(sesionId: string, montoCierre: number, usuarioId?: string, rol?: string) {
    if (rol === 'cajero') {
      const { data: sesion } = await this.db
        .from('sesiones_caja')
        .select('usuario_id')
        .eq('id', sesionId)
        .maybeSingle();
      if (!sesion) throw new BadRequestException('No existe la sesión de caja');
      if (sesion.usuario_id !== usuarioId) {
        throw new BadRequestException('Solo podés cerrar tu propia caja (pedile a un supervisor para cerrar la de otro)');
      }
    }
    const { data, error } = await this.db.rpc('cerrar_sesion_caja', {
      p_sesion: sesionId,
      p_monto_cierre: montoCierre,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  // Ingresos/retiros de efectivo de la sesión (cambio, retiro a tesorería,
  // reintegro de devolución). Entran al arqueo de cerrar_sesion_caja.
  async registrarMovimiento(dto: { sesionId: string; tipo: 'ingreso' | 'egreso'; monto: number; motivo: string }, usuarioId?: string) {
    if (!['ingreso', 'egreso'].includes(dto.tipo)) throw new BadRequestException('Tipo inválido');
    if (!(Number(dto.monto) > 0)) throw new BadRequestException('El monto debe ser mayor a cero');
    if (!dto.motivo?.trim()) throw new BadRequestException('Indicá el motivo del movimiento');
    const { data: sesion } = await this.db.from('sesiones_caja').select('id, cerrada_en').eq('id', dto.sesionId).maybeSingle();
    if (!sesion) throw new BadRequestException('No existe la sesión de caja');
    if (sesion.cerrada_en) throw new BadRequestException('La sesión ya está cerrada');
    const { data, error } = await this.db
      .from('caja_movimientos')
      .insert({ sesion_id: dto.sesionId, tipo: dto.tipo, monto: Number(dto.monto), motivo: dto.motivo.trim(), usuario_id: usuarioId ?? null })
      .select('id')
      .single();
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { id: data.id };
  }

  async movimientos(sesionId: string) {
    const { data, error } = await this.db
      .from('caja_movimientos')
      .select('id, tipo, monto, motivo, creado_en, usuario:usuarios(nombre)')
      .eq('sesion_id', sesionId)
      .order('creado_en', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // PIN de supervisor (gerente/dueño): autoriza descuentos y devoluciones en caja.
  // Devuelve un token opaco de un solo uso (no el usuarioId): así el cajero no
  // puede reusar ni inventar una autorización sin volver a teclear el PIN.
  async autorizar(pin: string) {
    const { data, error } = await this.db.rpc('verificar_pin_supervisor', { p_pin: pin ?? '' }).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('PIN incorrecto');
    const s = data as any;
    const { data: fila, error: errorToken } = await this.db
      .from('autorizaciones_caja')
      .insert({ usuario_id: s.id, rol: s.rol })
      .select('id')
      .single();
    if (errorToken) throw new BadRequestException(errorToken.message);
    return { token: fila.id, nombre: s.nombre, rol: s.rol };
  }

  // Consume el token emitido por autorizar(): un solo uso, con vencimiento, y
  // atómico (el UPDATE con `usado_en is null` hace que una segunda consulta
  // concurrente con el mismo token ya no matchee ninguna fila). Nunca aceptar
  // un usuarioId de autorización que venga directo del cliente.
  async consumirAutorizacion(token?: string): Promise<{ usuarioId: string; nombre: string; rol: string } | null> {
    if (!token) return null;
    const { data, error } = await this.db
      .from('autorizaciones_caja')
      .update({ usado_en: new Date().toISOString() })
      .eq('id', token)
      .is('usado_en', null)
      .gt('expira_en', new Date().toISOString())
      .select('usuario_id, usuario:usuarios!autorizaciones_caja_usuario_id_fkey(nombre, rol)')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Autorización de supervisor inválida, vencida o ya utilizada');
    const fila = data as any;
    return { usuarioId: fila.usuario_id, nombre: fila.usuario?.nombre, rol: fila.usuario?.rol };
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
