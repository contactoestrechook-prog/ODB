import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { TableroService } from '../tablero/tablero.service';
import { fechaArt, limitesDeFecha, sumarDias } from '../lib/fechas';
import { leerTodo } from '../lib/leer-todo';

// Cocina y carne: cuánto rinde cada corte (kilos que se compran contra kilos
// que llegan al plato) y cuánto hay que sacar para mañana.
@Injectable()
export class CarneService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly tablero: TableroService,
  ) {}

  async cortes() {
    const { data, error } = await this.db.from('cortes').select('*').order('nombre');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearCorte(nombre: string, rindeObjetivoPct = 80) {
    if (!nombre?.trim()) throw new BadRequestException('Poné el nombre del corte');
    if (!(rindeObjetivoPct > 0 && rindeObjetivoPct <= 100)) throw new BadRequestException('El rinde va entre 1 y 100 %');
    const { data, error } = await this.db.from('cortes').insert({ nombre: nombre.trim(), rinde_objetivo_pct: rindeObjetivoPct }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarCorte(id: string, patch: { nombre?: string; rindeObjetivoPct?: number; activo?: boolean }) {
    const fila: Record<string, any> = {};
    if (patch.nombre !== undefined) fila.nombre = patch.nombre.trim();
    if (patch.rindeObjetivoPct !== undefined) {
      if (!(patch.rindeObjetivoPct > 0 && patch.rindeObjetivoPct <= 100)) throw new BadRequestException('El rinde va entre 1 y 100 %');
      fila.rinde_objetivo_pct = patch.rindeObjetivoPct;
    }
    if (patch.activo !== undefined) fila.activo = patch.activo;
    const { data, error } = await this.db.from('cortes').update(fila).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese corte');
    return data;
  }

  // Anota a qué corte corresponde un renglón de una compra y cuántos kilos son.
  async marcarCompra(itemId: string, corteId: string | null, kilos: number | null) {
    const { data, error } = await this.db
      .from('compra_items')
      .update({ corte_id: corteId || null, kilos: kilos ? Number(kilos) : null })
      .eq('id', itemId)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese renglón de compra');
    return data;
  }

  private porcionesVendidas(desde: string) {
    return leerTodo<any>(() =>
      this.db
        .from('comanda_items')
        .select('item_id, cantidad, enviado_en')
        .gte('enviado_en', desde)
        .order('enviado_en'),
    );
  }

  // Rinde = kilos servidos ÷ kilos comprados en el período.
  // Ojo: no descuenta lo que había en la cámara al empezar ni lo que quedó al
  // terminar. En 30 días se compensa bastante; en 7 días puede engañar.
  async rendimiento(dias = 30) {
    const fechaDesde = sumarDias(fechaArt(), -dias);
    const desde = limitesDeFecha(fechaDesde).desde.toISOString();
    const [cortes, compras, vendidos, items] = await Promise.all([
      this.db.from('cortes').select('*').eq('activo', true).order('nombre'),
      leerTodo<any>(() =>
        this.db
          .from('compra_items')
          .select('id, corte_id, kilos, total, compra:compras(fecha)')
          .not('corte_id', 'is', null)
          .order('id'),
      ),
      this.porcionesVendidas(desde),
      this.db.from('carta_items').select('id, nombre, corte_id, gramos_porcion'),
    ]);
    if (cortes.error) throw new BadRequestException(cortes.error.message);
    if (items.error) throw new BadRequestException(items.error.message);

    const porItem = new Map<string, any>((items.data ?? []).map((i: any) => [i.id, i]));
    const filas = (cortes.data ?? []).map((c: any) => {
      const comp = compras.filter((x) => x.corte_id === c.id && x.kilos != null && x.compra?.fecha >= fechaDesde);
      const kilosComprados = comp.reduce((s, x) => s + Number(x.kilos), 0);
      const gastado = comp.reduce((s, x) => s + Number(x.total ?? 0), 0);
      let porciones = 0;
      let kilosServidos = 0;
      for (const v of vendidos) {
        const it = porItem.get(v.item_id);
        if (!it || it.corte_id !== c.id || !it.gramos_porcion) continue;
        porciones += v.cantidad;
        kilosServidos += (v.cantidad * it.gramos_porcion) / 1000;
      }
      const objetivo = Number(c.rinde_objetivo_pct);
      const rinde = kilosComprados ? Math.round((kilosServidos / kilosComprados) * 1000) / 10 : null;
      const precioKilo = kilosComprados ? gastado / kilosComprados : null;
      // lo que se pierde por rendir menos que el objetivo, en kilos y en plata
      const kilosDeMas = rinde != null && rinde < objetivo ? kilosComprados - kilosServidos / (objetivo / 100) : 0;
      return {
        id: c.id, nombre: c.nombre, objetivoPct: objetivo,
        kilosComprados: Math.round(kilosComprados * 10) / 10,
        kilosServidos: Math.round(kilosServidos * 10) / 10,
        porciones, rindePct: rinde,
        diferencia: rinde != null ? Math.round((rinde - objetivo) * 10) / 10 : null,
        precioKilo: precioKilo != null ? Math.round(precioKilo) : null,
        kilosDeMas: Math.round(kilosDeMas * 10) / 10,
        plataDeMas: precioKilo != null ? Math.round(kilosDeMas * precioKilo) : 0,
      };
    });
    return {
      dias,
      cortes: filas,
      plataDeMas: filas.reduce((s, f) => s + f.plataDeMas, 0),
      platosSinCorte: (items.data ?? []).filter((i: any) => i.corte_id && !i.gramos_porcion).map((i: any) => i.nombre),
    };
  }

  // Qué sacar para mañana: la gente que se espera (pronóstico) por lo que pide
  // cada persona en promedio (últimos 30 días), pasado a kilos en crudo con el
  // rinde objetivo de cada corte.
  async miseEnPlace() {
    const desde = limitesDeFecha(sumarDias(fechaArt(), -30)).desde.toISOString();
    const [pron, vendidos, visitas, items, cortes] = await Promise.all([
      this.tablero.pronostico(),
      this.porcionesVendidas(desde),
      leerTodo<any>(() =>
        this.db.from('mesa_ciclos').select('id, cubiertos, libre_en').eq('estado', 'libre').gte('libre_en', desde).order('libre_en'),
      ),
      this.db.from('carta_items').select('id, nombre, corte_id, gramos_porcion, tiempo_coccion_min, activo, agotado'),
      this.db.from('cortes').select('id, nombre, rinde_objetivo_pct'),
    ]);
    if (items.error) throw new BadRequestException(items.error.message);
    if (cortes.error) throw new BadRequestException(cortes.error.message);

    const manana = pron.dias[1];
    const cubiertosHistoricos = visitas.reduce((s, v) => s + (v.cubiertos ?? 0), 0);
    const esperados = manana?.esperados ?? null;
    const unidades = new Map<string, number>();
    for (const v of vendidos) if (v.item_id) unidades.set(v.item_id, (unidades.get(v.item_id) ?? 0) + v.cantidad);

    const platos = (items.data ?? [])
      .filter((i: any) => i.activo && i.corte_id && i.gramos_porcion)
      .map((i: any) => {
        const porPersona = cubiertosHistoricos ? (unidades.get(i.id) ?? 0) / cubiertosHistoricos : 0;
        return {
          id: i.id, nombre: i.nombre, corteId: i.corte_id, gramos: i.gramos_porcion,
          cadaCienPersonas: Math.round(porPersona * 100),
          porciones: esperados != null ? Math.ceil(porPersona * esperados) : null,
        };
      })
      .sort((a, b) => (b.porciones ?? 0) - (a.porciones ?? 0));

    const porCorte = (cortes.data ?? [])
      .map((c: any) => {
        const suyos = platos.filter((p) => p.corteId === c.id);
        const kilosLimpios = suyos.reduce((s, p) => s + ((p.porciones ?? 0) * p.gramos) / 1000, 0);
        return {
          id: c.id, nombre: c.nombre, porciones: suyos.reduce((s, p) => s + (p.porciones ?? 0), 0),
          kilosLimpios: Math.round(kilosLimpios * 10) / 10,
          kilosEnCrudo: Math.round((kilosLimpios / (Number(c.rinde_objetivo_pct) / 100)) * 10) / 10,
        };
      })
      .filter((c) => c.porciones > 0)
      .sort((a, b) => b.kilosEnCrudo - a.kilosEnCrudo);

    return {
      manana: manana ? { fecha: manana.fecha, dia: manana.dia, esperados, feriados: manana.feriados, reservados: manana.reservados } : null,
      platos,
      porCorte,
      agotados: (items.data ?? []).filter((i: any) => i.activo && i.agotado).map((i: any) => ({ id: i.id, nombre: i.nombre })),
    };
  }
}
