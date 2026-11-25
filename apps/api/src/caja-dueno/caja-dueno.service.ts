// CAJA DEL DUEÑO (25/11/2026). Leandro: «juampi quiere tener en el sistema un balance
// de lo que ingresa y egresa de la caja… no lo que se cobra a los clientes sino el
// como dueño lleva el control… ahora está usando un Excel»; con la captura: «armala
// lo más parecida a su Excel así sigue la misma línea».
//
// La hoja: cuadros de ingresos por origen (OTROS, REPARTO, CAJA ST THOMAS…), el
// cuadro de egresos y los totales. La ve y la carga solo quien tenga el permiso
// `caja_dueno` (hoy, Juan Pablo). Borrar un renglón no lo borra: queda marcado con
// quién y cuándo. Las cuentas están en caja-dueno.ts.

import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { tienePermiso } from '../auth/permiso-persona';
import { cambiosMovimiento, enOrden, movimientoNuevo, periodoValido, PERMISO_CAJA_DUENO, totalesCaja, type Cuadro, type Movimiento } from './caja-dueno';

const SIN_PERMISO = 'Esta caja la ve Juan Pablo o quien él diga.';

@Injectable()
export class CajaDuenoService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async puede(usuario: any): Promise<boolean> {
    return tienePermiso(this.db, usuario?.sub, PERMISO_CAJA_DUENO);
  }

  async exigir(usuario: any) {
    if (!(await this.puede(usuario))) throw new ForbiddenException(SIN_PERMISO);
  }

  private async cuadros(): Promise<Cuadro[]> {
    const { data, error } = await this.db.from('caja_dueno_cuadros').select('id, nombre, orden').eq('activo', true).order('orden').order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as any[]).map((c) => ({ id: String(c.id), nombre: String(c.nombre), orden: Number(c.orden ?? 0) }));
  }

  /** La hoja del período (o toda), con lo de antes como saldo anterior. */
  async hoja(q: { desde?: string; hasta?: string }) {
    const p = periodoValido(q);
    if (typeof p === 'string') throw new BadRequestException(p);
    const cuadros = await this.cuadros();
    const todos: any[] = [];
    for (let desdeFila = 0; ; desdeFila += 1000) {
      let consulta = this.db.from('caja_dueno_movimientos')
        .select('id, tipo, cuadro_id, fecha, motivo, monto, creado_en')
        .is('borrado_en', null);
      if (p.hasta) consulta = consulta.lte('fecha', p.hasta);
      const { data, error } = await consulta.order('fecha').order('creado_en').range(desdeFila, desdeFila + 999);
      if (error) throw new BadRequestException(error.message);
      todos.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const movimientos = enOrden(todos.map((m) => ({
      id: String(m.id), tipo: m.tipo, cuadroId: m.cuadro_id ? String(m.cuadro_id) : null,
      fecha: String(m.fecha), motivo: String(m.motivo ?? ''), monto: Number(m.monto), creadoEn: m.creado_en,
    })));
    const antes = p.desde ? movimientos.filter((m) => m.fecha < p.desde!) : [];
    const delPeriodo = p.desde ? movimientos.filter((m) => m.fecha >= p.desde!) : movimientos;
    const anterior = totalesCaja(cuadros, antes as Movimiento[]).total;
    return {
      periodo: p,
      cuadros,
      movimientos: delPeriodo.map(({ creadoEn: _c, ...m }) => m),
      ...totalesCaja(cuadros, delPeriodo as Movimiento[], anterior),
    };
  }

  async crear(dto: any, usuarioId?: string) {
    const m = movimientoNuevo(dto);
    if (typeof m === 'string') throw new BadRequestException(m);
    if (m.cuadroId) await this.cuadroActivo(m.cuadroId);
    const { data, error } = await this.db.from('caja_dueno_movimientos')
      .insert({ tipo: m.tipo, cuadro_id: m.cuadroId, fecha: m.fecha, motivo: m.motivo, monto: m.monto, creado_por: usuarioId ?? null })
      .select('id').single();
    if (error) throw new BadRequestException(error.message);
    return { id: String((data as any).id) };
  }

  async editar(id: string, dto: any, usuarioId?: string) {
    const cambios = cambiosMovimiento(dto);
    if (typeof cambios === 'string') throw new BadRequestException(cambios);
    const { data: actual } = await this.db.from('caja_dueno_movimientos').select('id, tipo').eq('id', id).is('borrado_en', null).maybeSingle();
    if (!actual) throw new BadRequestException('Ese renglón ya no está.');
    if (cambios.cuadroId !== undefined) {
      if ((actual as any).tipo !== 'ingreso') throw new BadRequestException('Un egreso no va en un cuadro de ingresos.');
      await this.cuadroActivo(cambios.cuadroId!);
    }
    const fila: Record<string, unknown> = { actualizado_por: usuarioId ?? null, actualizado_en: new Date().toISOString() };
    if (cambios.fecha !== undefined) fila.fecha = cambios.fecha;
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo;
    if (cambios.monto !== undefined) fila.monto = cambios.monto;
    if (cambios.cuadroId !== undefined) fila.cuadro_id = cambios.cuadroId;
    const { error } = await this.db.from('caja_dueno_movimientos').update(fila).eq('id', id).is('borrado_en', null);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async borrar(id: string, usuarioId?: string) {
    const { data, error } = await this.db.from('caja_dueno_movimientos')
      .update({ borrado_por: usuarioId ?? null, borrado_en: new Date().toISOString() })
      .eq('id', id).is('borrado_en', null).select('id');
    if (error) throw new BadRequestException(error.message);
    if (!(data ?? []).length) throw new BadRequestException('Ese renglón ya no está.');
    return { ok: true };
  }

  async crearCuadro(dto: any, usuarioId?: string) {
    const nombre = String(dto?.nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!nombre || nombre.length > 60) throw new BadRequestException('Poné el nombre del cuadro (hasta 60 letras).');
    const cuadros = await this.cuadros();
    if (cuadros.some((c) => c.nombre.toUpperCase() === nombre)) throw new BadRequestException('Ya hay un cuadro con ese nombre.');
    const orden = cuadros.reduce((max, c) => Math.max(max, c.orden), 0) + 1;
    const { data, error } = await this.db.from('caja_dueno_cuadros').insert({ nombre, orden, creado_por: usuarioId ?? null }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    return { id: String((data as any).id) };
  }

  async renombrarCuadro(id: string, dto: any) {
    const nombre = String(dto?.nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!nombre || nombre.length > 60) throw new BadRequestException('Poné el nombre del cuadro (hasta 60 letras).');
    const cuadros = await this.cuadros();
    if (!cuadros.some((c) => c.id === id)) throw new BadRequestException('Ese cuadro ya no está.');
    if (cuadros.some((c) => c.id !== id && c.nombre.toUpperCase() === nombre)) throw new BadRequestException('Ya hay un cuadro con ese nombre.');
    const { error } = await this.db.from('caja_dueno_cuadros').update({ nombre }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  /** Un cuadro sin renglones se puede sacar; con renglones, no (la plata no desaparece). */
  async quitarCuadro(id: string) {
    const { count, error: e1 } = await this.db.from('caja_dueno_movimientos').select('id', { count: 'exact', head: true }).eq('cuadro_id', id).is('borrado_en', null);
    if (e1) throw new BadRequestException(e1.message);
    if ((count ?? 0) > 0) throw new BadRequestException('El cuadro tiene renglones: borralos primero o pasalos a otro cuadro.');
    const { error } = await this.db.from('caja_dueno_cuadros').update({ activo: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  private async cuadroActivo(id: string) {
    const { data } = await this.db.from('caja_dueno_cuadros').select('id').eq('id', id).eq('activo', true).maybeSingle();
    if (!data) throw new BadRequestException('Ese cuadro ya no está.');
  }

}
