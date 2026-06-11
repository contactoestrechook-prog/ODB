import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Controller('estadisticas')
export class EstadisticasController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get()
  async resumen() {
    const hace30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [ventasR, itemsR, pagosR] = await Promise.all([
      this.db
        .from('ventas')
        .select('total, descuento, canal, vendida_en')
        .eq('estado', 'completada')
        .gte('vendida_en', hace30)
        .limit(20000),
      this.db
        .from('ventas_items')
        .select('cantidad, precio_unitario, costo_unitario, producto:productos(sku, nombre), venta:ventas!inner(vendida_en, estado)')
        .gte('venta.vendida_en', hace30)
        .eq('venta.estado', 'completada')
        .limit(20000),
      this.db
        .from('pagos')
        .select('medio, monto, venta:ventas!inner(vendida_en, estado)')
        .gte('venta.vendida_en', hace30)
        .eq('venta.estado', 'completada')
        .limit(20000),
    ]);
    if (ventasR.error) throw new BadRequestException(ventasR.error.message);

    const ventas = (ventasR.data ?? []) as any[];
    const items = (itemsR.data ?? []) as any[];
    const pagos = (pagosR.data ?? []) as any[];

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

    // ranking por producto
    const porProducto = new Map<string, any>();
    for (const i of items) {
      const sku = i.producto?.sku ?? '?';
      const acc = porProducto.get(sku) ?? {
        sku,
        nombre: i.producto?.nombre ?? '?',
        unidades: 0,
        facturado: 0,
        margen: 0,
      };
      const cantidad = Number(i.cantidad);
      acc.unidades += cantidad;
      acc.facturado += cantidad * Number(i.precio_unitario);
      acc.margen += cantidad * (Number(i.precio_unitario) - Number(i.costo_unitario ?? 0));
      porProducto.set(sku, acc);
    }
    const ranking = [...porProducto.values()].map((r) => ({
      ...r,
      unidades: Math.round(r.unidades),
      facturado: Math.round(r.facturado),
      margen: Math.round(r.margen),
    }));

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
      porMedio: [...porMedio.entries()].map(([medio, total]) => ({ medio, total: Math.round(total) })),
      porCanal: [...porCanal.entries()].map(([canal, total]) => ({ canal, total: Math.round(total) })),
    };
  }
}
