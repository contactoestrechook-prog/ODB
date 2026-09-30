import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

type Alarma = 'verde' | 'amarillo' | 'rojo';

function minutosDesde(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

// Umbral de "esperando que lo empiecen a cocinar" (backlog de cocina, no es
// la misma alarma que el punto de cocción).
const ESPERA_AMARILLO_MIN = 8;

function alarmaDeItem(item: any): { minutos: number; objetivo: number | null; color: Alarma } {
  if (item.estado === 'pendiente') {
    const minutos = minutosDesde(item.enviado_en);
    return { minutos, objetivo: item.tiempo_coccion_min ?? null, color: minutos >= ESPERA_AMARILLO_MIN ? 'amarillo' : 'verde' };
  }
  const minutos = minutosDesde(item.en_coccion_desde);
  const objetivo = item.tiempo_coccion_min as number | null;
  if (!objetivo) return { minutos, objetivo: null, color: 'verde' };
  const pct = minutos / objetivo;
  const color: Alarma = pct >= 1 ? 'rojo' : pct >= 0.8 ? 'amarillo' : 'verde';
  return { minutos, objetivo, color };
}

@Injectable()
export class CocinaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // El mozo toma la comanda: elige platos de la carta (sin escribir nada,
  // solo tocar) y eso a la vez avanza el reloj de la mesa a "comanda_tomada".
  async tomarComanda(mesaId: string, items: { itemId: string; cantidad: number }[]) {
    if (!items?.length) throw new BadRequestException('La comanda no puede estar vacía');

    const { data: ciclo, error: errCiclo } = await this.db
      .from('mesa_ciclos')
      .select('*')
      .eq('mesa_id', mesaId)
      .neq('estado', 'libre')
      .maybeSingle();
    if (errCiclo) throw new BadRequestException(errCiclo.message);
    if (!ciclo) throw new NotFoundException('Esta mesa no tiene un ciclo activo — abrila primero');
    if (!['sentada', 'vio_carta'].includes(ciclo.estado)) {
      throw new BadRequestException('La comanda ya fue tomada para esta mesa');
    }

    const { data: cartaItems, error: errCarta } = await this.db
      .from('carta_items')
      .select('id, nombre, tiempo_coccion_min')
      .in('id', items.map((i) => i.itemId));
    if (errCarta) throw new BadRequestException(errCarta.message);
    const porId = new Map((cartaItems ?? []).map((c: any) => [c.id, c]));

    const filas = items.map((i) => {
      const info = porId.get(i.itemId);
      return {
        ciclo_id: ciclo.id,
        item_id: i.itemId,
        nombre: info?.nombre ?? 'Ítem',
        cantidad: i.cantidad,
        tiempo_coccion_min: info?.tiempo_coccion_min ?? null,
      };
    });
    const { error: errInsert } = await this.db.from('comanda_items').insert(filas);
    if (errInsert) throw new BadRequestException(errInsert.message);

    const ahora = new Date().toISOString();
    const patch: Record<string, any> = { estado: 'comanda_tomada', estado_desde: ahora, comanda_tomada_en: ahora };
    if (!ciclo.vio_carta_en) patch.vio_carta_en = ahora;
    const { data, error: errUpd } = await this.db.from('mesa_ciclos').update(patch).eq('id', ciclo.id).select().single();
    if (errUpd) throw new BadRequestException(errUpd.message);
    return data;
  }

  async tablero() {
    const { data: activos, error: errActivos } = await this.db
      .from('comanda_items')
      .select('*, ciclo:mesa_ciclos(mesa:mesas(numero, sector))')
      .in('estado', ['pendiente', 'en_coccion'])
      .not('tiempo_coccion_min', 'is', null)
      .order('enviado_en');
    if (errActivos) throw new BadRequestException(errActivos.message);

    const desde = new Date(Date.now() - 20 * 60_000).toISOString();
    const { data: listos, error: errListos } = await this.db
      .from('comanda_items')
      .select('*, ciclo:mesa_ciclos(mesa:mesas(numero, sector))')
      .eq('estado', 'listo')
      .gte('listo_en', desde)
      .order('listo_en');
    if (errListos) throw new BadRequestException(errListos.message);

    const mapear = (it: any) => ({
      id: it.id,
      nombre: it.nombre,
      cantidad: it.cantidad,
      estado: it.estado,
      mesaNumero: it.ciclo?.mesa?.numero ?? null,
      sector: it.ciclo?.mesa?.sector ?? null,
      ...alarmaDeItem(it),
    });

    return { pendientes: (activos ?? []).map(mapear), listos: (listos ?? []).map(mapear) };
  }

  private async cambiarEstado(id: string, desde: string[], hacia: string, columnaFecha: string) {
    const { data, error } = await this.db
      .from('comanda_items')
      .update({ estado: hacia, [columnaFecha]: new Date().toISOString() })
      .eq('id', id)
      .in('estado', desde)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('El plato no está en el estado esperado (¿ya lo actualizó otra persona?)');
    return data;
  }

  empezar(id: string) {
    return this.cambiarEstado(id, ['pendiente'], 'en_coccion', 'en_coccion_desde');
  }

  listo(id: string) {
    return this.cambiarEstado(id, ['pendiente', 'en_coccion'], 'listo', 'listo_en');
  }

  // Al entregar el ÚLTIMO plato de la mesa, el reloj de la mesa avanza solo a
  // "plato_servido": un toque menos para el mozo y un timestamp más honesto
  // (lo pone la cocina real, no la memoria del mozo).
  async entregado(id: string) {
    const item = await this.cambiarEstado(id, ['listo'], 'entregado', 'entregado_en');

    const { data: hermanos } = await this.db
      .from('comanda_items')
      .select('id')
      .eq('ciclo_id', item.ciclo_id)
      .in('estado', ['pendiente', 'en_coccion', 'listo'])
      .limit(1);
    if (!hermanos?.length) {
      const ahora = new Date().toISOString();
      await this.db
        .from('mesa_ciclos')
        .update({ estado: 'plato_servido', estado_desde: ahora, plato_servido_en: ahora })
        .eq('id', item.ciclo_id)
        .eq('estado', 'comanda_tomada');
    }
    return item;
  }

  // Producción real de los últimos 30 días: cuánto tarda de verdad cada plato
  // contra su objetivo. De acá salen dos decisiones: corregir el objetivo (si
  // el default era irreal) o corregir la parrilla (si el desvío es operativo).
  async metricas() {
    const desde = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { data, error } = await this.db
      .from('comanda_items')
      .select('nombre, tiempo_coccion_min, enviado_en, en_coccion_desde, listo_en')
      .in('estado', ['listo', 'entregado'])
      .gte('enviado_en', desde)
      .not('listo_en', 'is', null);
    if (error) throw new BadRequestException(error.message);

    const minutos = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
    type Grupo = { objetivo: number | null; cocciones: number[]; esperas: number[] };
    const porPlato = new Map<string, Grupo>();

    for (const it of (data ?? []) as any[]) {
      const g: Grupo = porPlato.get(it.nombre) ?? { objetivo: it.tiempo_coccion_min, cocciones: [], esperas: [] };
      if (it.en_coccion_desde) {
        g.cocciones.push(minutos(it.en_coccion_desde, it.listo_en));
        g.esperas.push(minutos(it.enviado_en, it.en_coccion_desde));
      }
      porPlato.set(it.nombre, g);
    }

    const prom = (ns: number[]) => (ns.length ? Math.round((ns.reduce((s, n) => s + n, 0) / ns.length) * 10) / 10 : null);

    return Array.from(porPlato.entries())
      .map(([nombre, g]) => {
        const real = prom(g.cocciones);
        return {
          nombre,
          platos: g.cocciones.length,
          objetivoMin: g.objetivo,
          realMin: real,
          esperaMin: prom(g.esperas),
          desvioMin: real != null && g.objetivo != null ? Math.round((real - g.objetivo) * 10) / 10 : null,
        };
      })
      .sort((a, b) => (b.desvioMin ?? -99) - (a.desvioMin ?? -99));
  }
}
