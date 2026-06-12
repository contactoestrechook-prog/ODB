import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { AnalistaService } from '../analista/analista.service';

const TZ = 'America/Argentina/Buenos_Aires';

// fecha local (YYYY-MM-DD) de un instante, en horario argentino
const fechaLocal = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

@Injectable()
export class InformesService {
  private readonly log = new Logger('Informes');

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly analista: AnalistaService,
  ) {}

  // Todas las mañanas a las 7 queda listo el informe del día anterior
  @Cron('0 7 * * *', { timeZone: TZ })
  async informeProgramado() {
    try {
      await this.generar();
      this.log.log('Informe diario generado');
      // TODO: cuando haya credenciales de WhatsApp Business, enviarlo acá
    } catch (e) {
      this.log.error(`Informe diario falló: ${e}`);
    }
  }

  async listar() {
    const { data, error } = await this.db
      .from('informes')
      .select('fecha, datos, relato, creado_en')
      .order('fecha', { ascending: false })
      .limit(30);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Genera (o regenera) el informe de una fecha; por defecto, ayer
  async generar(fecha?: string) {
    const dia = fecha ?? fechaLocal(new Date(Date.now() - 86400_000));
    const datos = await this.recolectar(dia);
    const relato = await this.relatar(dia, datos);

    const { error } = await this.db
      .from('informes')
      .upsert({ fecha: dia, datos, relato }, { onConflict: 'fecha' });
    if (error) throw new BadRequestException(error.message);
    return { fecha: dia, datos, relato };
  }

  // ---- datos crudos del día ----

  private async recolectar(dia: string) {
    // límites del día en horario argentino (ART = UTC-3, sin horario de verano)
    const desde = new Date(`${dia}T00:00:00-03:00`).toISOString();
    const hasta = new Date(`${dia}T24:00:00-03:00`).toISOString();
    const desde30 = new Date(new Date(desde).getTime() - 30 * 86400_000).toISOString();

    const [ventas, items, pagos, ventas30, alertas, vencimientos] = await Promise.all([
      this.todas((d, h) =>
        this.db
          .from('ventas')
          .select('total, canal, vendida_en')
          .eq('estado', 'completada')
          .gte('vendida_en', desde)
          .lt('vendida_en', hasta)
          .range(d, h),
      ),
      this.todas((d, h) =>
        this.db
          .from('ventas_items')
          .select('cantidad, precio_unitario, costo_unitario, producto:productos(sku, nombre), venta:ventas!inner(vendida_en, estado)')
          .gte('venta.vendida_en', desde)
          .lt('venta.vendida_en', hasta)
          .eq('venta.estado', 'completada')
          .range(d, h),
      ),
      this.todas((d, h) =>
        this.db
          .from('pagos')
          .select('medio, monto, venta:ventas!inner(vendida_en, estado)')
          .gte('venta.vendida_en', desde)
          .lt('venta.vendida_en', hasta)
          .eq('venta.estado', 'completada')
          .range(d, h),
      ),
      this.todas((d, h) =>
        this.db
          .from('ventas')
          .select('total, vendida_en')
          .eq('estado', 'completada')
          .gte('vendida_en', desde30)
          .lt('vendida_en', desde)
          .range(d, h),
      ),
      this.analista.metricas(),
      this.db
        .from('lotes')
        .select('vencimiento, cantidad, producto:productos(sku, nombre)')
        .gt('cantidad', 0),
    ]);

    const facturado = ventas.reduce((s, v) => s + Number(v.total), 0);
    const tickets = ventas.length;

    // comparativa contra el promedio diario de los 30 días previos
    const dias30 = new Set(ventas30.map((v: any) => v.vendida_en.slice(0, 10))).size || 1;
    const promedioDiario30 = ventas30.reduce((s: number, v: any) => s + Number(v.total), 0) / dias30;

    const porMedio = new Map<string, number>();
    for (const p of pagos) porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + Number(p.monto));
    const porCanal = new Map<string, number>();
    for (const v of ventas) porCanal.set(v.canal, (porCanal.get(v.canal) ?? 0) + Number(v.total));

    const porProducto = new Map<string, any>();
    for (const i of items) {
      const sku = i.producto?.sku ?? '?';
      const acc = porProducto.get(sku) ?? { sku, nombre: i.producto?.nombre ?? '?', unidades: 0, facturado: 0, margen: 0 };
      const cantidad = Number(i.cantidad);
      acc.unidades += cantidad;
      acc.facturado += cantidad * Number(i.precio_unitario);
      acc.margen += cantidad * (Number(i.precio_unitario) - Number(i.costo_unitario ?? 0));
      porProducto.set(sku, acc);
    }
    const top = [...porProducto.values()]
      .sort((a, b) => b.facturado - a.facturado)
      .slice(0, 5)
      .map((r) => ({ ...r, unidades: Math.round(r.unidades), facturado: Math.round(r.facturado), margen: Math.round(r.margen) }));

    // alertas de abastecimiento (calculadas por el Analista)
    const quiebres = alertas.filter((f) => f.estado === 'quiebre_inminente');
    const reponer = alertas.filter((f) => f.estado === 'reponer');
    const muertos = alertas.filter((f) => f.estado === 'muerto');
    const capitalMuerto = muertos.reduce((s, f) => s + f.stock * Number(f.costo ?? 0), 0);

    const hoy0 = new Date(`${dia}T00:00:00-03:00`).getTime();
    const porVencer = ((vencimientos.data ?? []) as any[])
      .map((l) => ({
        sku: l.producto?.sku,
        nombre: l.producto?.nombre,
        cantidad: Number(l.cantidad),
        dias: Math.round((new Date(l.vencimiento).getTime() - hoy0) / 86400_000),
      }))
      .filter((l) => l.dias >= 0 && l.dias <= 15)
      .sort((a, b) => a.dias - b.dias)
      .slice(0, 10);

    return {
      facturado: Math.round(facturado),
      tickets,
      ticketPromedio: tickets ? Math.round(facturado / tickets) : 0,
      promedioDiario30: Math.round(promedioDiario30),
      variacionPct: promedioDiario30 > 0 ? Math.round((facturado / promedioDiario30 - 1) * 100) : 0,
      porMedio: [...porMedio.entries()].map(([medio, total]) => ({ medio, total: Math.round(total) })),
      porCanal: [...porCanal.entries()].map(([canal, total]) => ({ canal, total: Math.round(total) })),
      topProductos: top,
      abastecimiento: {
        quiebresInminentes: quiebres.length,
        aReponer: reponer.length,
        sinRotacion: muertos.length,
        capitalInmovilizado: Math.round(capitalMuerto),
        urgentes: quiebres.slice(0, 8).map((f) => ({
          sku: f.sku,
          producto: f.producto,
          sucursal: f.sucursal,
          stock: f.stock,
          diasDeStock: f.diasDeStock,
          sugerido: f.sugerido,
        })),
      },
      porVencer,
    };
  }

  // ---- relato ejecutivo (Analista ODB) ----

  private async relatar(dia: string, datos: any): Promise<string> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return '(Relato no disponible: falta la ANTHROPIC_API_KEY)';
    }
    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1000,
      system: `Sos el Analista ODB y escribís el parte matutino para el dueño de O.D.B Premium Market (outlet de bebidas, 2 sucursales, Argentina). Español rioplatense, texto plano sin markdown, máximo 150 palabras. Estructura: 1) cómo vino la venta de ayer (comparada con el promedio), 2) lo más urgente de hoy (quiebres, vencimientos), 3) una recomendación concreta. Trabajás SOLO con los números del JSON: no inventes nada. Montos en pesos argentinos redondeados (ej: $12,4M).`,
      messages: [
        {
          role: 'user',
          content: `Informe del ${dia}. Datos:\n${JSON.stringify(datos)}`,
        },
      ],
    });
    const texto = respuesta.content.find((b) => b.type === 'text');
    return texto && 'text' in texto ? texto.text : '';
  }

  // PostgREST corta en 1000 filas: paginación en tandas paralelas de 8
  private async todas(crear: (d: number, h: number) => PromiseLike<{ data: any; error: any }>) {
    const filas: any[] = [];
    for (let tanda = 0; ; tanda++) {
      const paginas = await Promise.all(
        Array.from({ length: 8 }, (_, i) => crear((tanda * 8 + i) * 1000, (tanda * 8 + i) * 1000 + 999)),
      );
      let corta = false;
      for (const { data, error } of paginas) {
        if (error) throw new BadRequestException(error.message ?? String(error));
        filas.push(...(data ?? []));
        if (!data || data.length < 1000) corta = true;
      }
      if (corta) break;
    }
    return filas;
  }
}
