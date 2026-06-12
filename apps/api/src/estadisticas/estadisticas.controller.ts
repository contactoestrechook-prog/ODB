import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { AnalistaService } from '../analista/analista.service';

@Controller('estadisticas')
export class EstadisticasController {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly analista: AnalistaService,
  ) {}

  // El cálculo recorre ~20k filas: caché de 60 s (es un tablero, no un ticker)
  private cache: { data: any; ts: number } | null = null;

  @Get()
  async resumen() {
    if (this.cache && Date.now() - this.cache.ts < 60_000) return this.cache.data;
    const data = await this.calcular();
    this.cache = { data, ts: Date.now() };
    return data;
  }

  // PostgREST corta en 1000 filas por request: se pagina todo
  private async todas(crear: (d: number, h: number) => PromiseLike<{ data: any; error: any }>) {
    const filas: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await crear(desde, desde + 999);
      if (error) throw new BadRequestException(error.message ?? String(error));
      filas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return filas;
  }

  private async calcular() {
    const hace30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [ventas, items, pagos] = await Promise.all([
      this.todas((d, h) =>
        this.db
          .from('ventas')
          .select('total, descuento, canal, vendida_en')
          .eq('estado', 'completada')
          .gte('vendida_en', hace30)
          .range(d, h),
      ),
      this.todas((d, h) =>
        this.db
          .from('ventas_items')
          .select('cantidad, precio_unitario, costo_unitario, producto:productos(sku, nombre), venta:ventas!inner(vendida_en, estado)')
          .gte('venta.vendida_en', hace30)
          .eq('venta.estado', 'completada')
          .range(d, h),
      ),
      this.todas((d, h) =>
        this.db
          .from('pagos')
          .select('medio, monto, venta:ventas!inner(vendida_en, estado)')
          .gte('venta.vendida_en', hace30)
          .eq('venta.estado', 'completada')
          .range(d, h),
      ),
    ]);

    // serie diaria (30 días)
    const porDia = new Map<string, { total: number; tickets: number }>();
    for (let d = 29; d >= 0; d--) {
      const fecha = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
      porDia.set(fecha, { total: 0, tickets: 0 });
    }
    for (const v of ventas) {
      const fecha = v.vendida_en.slice(0, 10);
      const acc = porDia.get(fecha);
      if (acc) {
        acc.total += Number(v.total);
        acc.tickets += 1;
      }
    }

    // ranking por producto (con ventana 7 días para detectar momentum)
    const hace7 = new Date(Date.now() - 7 * 86400_000).toISOString();
    const porProducto = new Map<string, any>();
    for (const i of items) {
      const sku = i.producto?.sku ?? '?';
      const acc = porProducto.get(sku) ?? {
        sku,
        nombre: i.producto?.nombre ?? '?',
        unidades: 0,
        unidades7: 0,
        facturado: 0,
        margen: 0,
      };
      const cantidad = Number(i.cantidad);
      acc.unidades += cantidad;
      if (i.venta.vendida_en >= hace7) acc.unidades7 += cantidad;
      acc.facturado += cantidad * Number(i.precio_unitario);
      acc.margen += cantidad * (Number(i.precio_unitario) - Number(i.costo_unitario ?? 0));
      porProducto.set(sku, acc);
    }
    const ranking = [...porProducto.values()].map((r) => ({
      ...r,
      unidades: Math.round(r.unidades),
      unidades7: Math.round(r.unidades7),
      facturado: Math.round(r.facturado),
      margen: Math.round(r.margen),
    }));

    // ganadores: aceleran su ritmo (última semana vs promedio del mes) con volumen real
    const ganadores = ranking
      .map((r) => {
        const vd30 = r.unidades / 30;
        const vd7 = r.unidades7 / 7;
        return { ...r, crecimientoPct: vd30 > 0 ? Math.round((vd7 / vd30 - 1) * 100) : 0 };
      })
      .filter((r) => r.unidades7 >= 10 && r.crecimientoPct >= 10)
      .sort((a, b) => b.crecimientoPct - a.crecimientoPct)
      .slice(0, 8);

    // medios de pago y canales
    const porMedio = new Map<string, number>();
    for (const p of pagos) porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + Number(p.monto));
    const porCanal = new Map<string, number>();
    for (const v of ventas) porCanal.set(v.canal, (porCanal.get(v.canal) ?? 0) + Number(v.total));

    const facturado = ventas.reduce((s, v) => s + Number(v.total), 0);
    return {
      periodo: '30 días',
      totales: {
        facturado: Math.round(facturado),
        tickets: ventas.length,
        ticketPromedio: ventas.length ? Math.round(facturado / ventas.length) : 0,
        descuentos: Math.round(ventas.reduce((s, v) => s + Number(v.descuento), 0)),
      },
      ventasPorDia: [...porDia.entries()].map(([fecha, v]) => ({
        fecha,
        total: Math.round(v.total),
        tickets: v.tickets,
      })),
      topUnidades: [...ranking].sort((a, b) => b.unidades - a.unidades).slice(0, 10),
      topFacturacion: [...ranking].sort((a, b) => b.facturado - a.facturado).slice(0, 10),
      topMargen: [...ranking].sort((a, b) => b.margen - a.margen).slice(0, 10),
      peores: [...ranking].sort((a, b) => a.unidades - b.unidades).slice(0, 10),
      ganadores,
      promocionables: await this.promocionables(),
      porMedio: [...porMedio.entries()].map(([medio, total]) => ({ medio, total: Math.round(total) })),
      porCanal: [...porCanal.entries()].map(([canal, total]) => ({ canal, total: Math.round(total) })),
    };
  }

  // Candidatos ideales para promocionar: hay que mover stock (sobrestock, sin
  // rotación o vencimiento cercano) y el margen banca el descuento
  private async promocionables() {
    const [filas, lotesR] = await Promise.all([
      this.analista.metricas(),
      this.db
        .from('lotes')
        .select('vencimiento, cantidad, producto:productos(sku)')
        .gt('cantidad', 0),
    ]);

    const porVencer = new Map<string, number>();
    const hoy = new Date().setHours(0, 0, 0, 0);
    for (const l of (lotesR.data ?? []) as any[]) {
      const dias = Math.round((new Date(l.vencimiento).getTime() - hoy) / 86400_000);
      const sku = l.producto?.sku;
      if (sku && dias >= 0 && dias <= 20) {
        porVencer.set(sku, Math.min(porVencer.get(sku) ?? 999, dias));
      }
    }

    const porSku = new Map<string, any>();
    for (const f of filas) {
      const previo = porSku.get(f.sku);
      const motivos: string[] = previo?.motivos ?? [];
      if (f.estado === 'sobrestock' && !motivos.includes('sobrestock'))
        motivos.push('sobrestock');
      if (f.estado === 'muerto' && !motivos.includes('sin rotación'))
        motivos.push('sin rotación');
      porSku.set(f.sku, {
        sku: f.sku,
        nombre: f.producto,
        margenPct: Math.max(previo?.margenPct ?? 0, f.margenPct ?? 0),
        stockTotal: (previo?.stockTotal ?? 0) + f.stock,
        capital: (previo?.capital ?? 0) + Math.round(f.stock * Number(f.costo ?? 0)),
        motivos,
      });
    }
    for (const [sku, dias] of porVencer) {
      const r = porSku.get(sku);
      if (r) r.motivos.push(`vence en ${dias} días`);
    }

    return [...porSku.values()]
      .filter((r) => r.motivos.length > 0 && r.margenPct >= 25)
      .map((r) => ({
        ...r,
        descuentoSugerido: r.motivos.some((m: string) => m.startsWith('vence'))
          ? 30
          : Math.min(Math.round(r.margenPct / 2), 25),
      }))
      .sort((a, b) => b.capital - a.capital)
      .slice(0, 12);
  }
}
