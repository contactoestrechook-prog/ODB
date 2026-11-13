import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { AnalistaService } from '../analista/analista.service';
import { diaDeSemana, fechaArt, limitesDeFecha, linkWhatsapp, minutosEntre, promedio, sumarDias } from '../lib/fechas';
import { leerTodo } from '../lib/leer-todo';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const pesos = (n: number | null | undefined) => (n == null ? '—' : `$ ${Math.round(n).toLocaleString('es-AR')}`);

// Puerto Iguazú, para el clima del pronóstico (Open-Meteo: gratis y sin clave).
const LAT = -25.5991;
const LON = -54.5736;

type ClaseMenu = 'estrella' | 'vende_deja_poco' | 'deja_vende_poco' | 'ni_vende_ni_deja' | 'sin_costo';
const CONSEJO: Record<ClaseMenu, string> = {
  estrella: 'Cuidarlo: no tocar el precio ni la porción.',
  vende_deja_poco: 'Subirle el precio de a poco o bajarle el costo.',
  deja_vende_poco: 'Empujarlo: foto, mejor lugar en la carta y que el mozo lo recomiende.',
  ni_vende_ni_deja: 'Pensar en sacarlo o rehacerlo.',
  sin_costo: 'Cargale el costo en Carta para poder ubicarlo.',
};

// El tablero del dueño. Todo sale de datos que ya se cargan trabajando
// (mesas, comandas, cobros): nadie llena una planilla aparte.
@Injectable()
export class TableroService {
  private readonly logger = new Logger('Tablero');

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly analista: AnalistaService,
  ) {}

  private desdeHace(dias: number) {
    return limitesDeFecha(sumarDias(fechaArt(), -dias)).desde.toISOString();
  }

  private visitasCerradas(desde: string) {
    return leerTodo<any>(() =>
      this.db
        .from('mesa_ciclos')
        .select('id, mozo_id, monto, cubiertos, sentada_en, comanda_tomada_en, libre_en')
        .eq('estado', 'libre')
        .gte('libre_en', desde)
        .order('libre_en'),
    );
  }

  private comandas(desde: string) {
    return leerTodo<any>(() =>
      this.db
        .from('comanda_items')
        .select('ciclo_id, item_id, cantidad, precio_unitario, enviado_en')
        .gte('enviado_en', desde)
        .order('enviado_en'),
    );
  }

  // ── cada mozo, con sus números ──
  async mozos(dias = 30) {
    const desde = this.desdeHace(dias);
    const [visitas, comandas, mozos, items] = await Promise.all([
      this.visitasCerradas(desde),
      this.comandas(desde),
      this.db.from('mozos').select('id, nombre, activo'),
      this.db.from('carta_items').select('id, categoria:carta_categorias(nombre)'),
    ]);
    if (mozos.error) throw new BadRequestException(mozos.error.message);
    if (items.error) throw new BadRequestException(items.error.message);

    const postres = new Set((items.data ?? []).filter((i: any) => /postre/i.test(i.categoria?.nombre ?? '')).map((i: any) => i.id));
    const conPostre = new Set(comandas.filter((c) => postres.has(c.item_id)).map((c) => c.ciclo_id));

    const filas = (mozos.data ?? [])
      .map((m: any) => {
        const suyas = visitas.filter((v) => v.mozo_id === m.id);
        const ventas = suyas.reduce((s, v) => s + Number(v.monto ?? 0), 0);
        const cubiertos = suyas.reduce((s, v) => s + (v.cubiertos ?? 0), 0);
        return {
          id: m.id, nombre: m.nombre, activo: m.activo,
          mesas: suyas.length, cubiertos, ventas,
          ticketPorCubierto: cubiertos ? Math.round(ventas / cubiertos) : null,
          atencionMin: promedio(suyas.filter((v) => v.comanda_tomada_en).map((v) => minutosEntre(v.sentada_en, v.comanda_tomada_en))),
          tiempoMesaMin: promedio(suyas.map((v) => minutosEntre(v.sentada_en, v.libre_en)), 0),
          tasaPostre: suyas.length ? Math.round((suyas.filter((v) => conPostre.has(v.id)).length / suyas.length) * 100) : null,
        };
      })
      .filter((f) => f.mesas > 0 || f.activo)
      .sort((a, b) => b.ventas - a.ventas);

    const totalCub = visitas.reduce((s, v) => s + (v.cubiertos ?? 0), 0);
    const totalVentas = visitas.reduce((s, v) => s + Number(v.monto ?? 0), 0);
    return {
      dias,
      mozos: filas,
      salon: {
        mesas: visitas.length,
        ticketPorCubierto: totalCub ? Math.round(totalVentas / totalCub) : null,
        atencionMin: promedio(visitas.filter((v) => v.comanda_tomada_en).map((v) => minutosEntre(v.sentada_en, v.comanda_tomada_en))),
        tasaPostre: visitas.length ? Math.round((visitas.filter((v) => conPostre.has(v.id)).length / visitas.length) * 100) : null,
      },
    };
  }

  // ── la carta, plato por plato: cuánto se vende y cuánto deja ──
  // Regla clásica de ingeniería de menú: un plato "se vende" si llega al 70 %
  // de la parte que le tocaría si todos se vendieran igual; "deja" si su
  // margen por unidad supera el margen promedio de lo vendido.
  async menu(dias = 30) {
    const desde = this.desdeHace(dias);
    const [comandas, items] = await Promise.all([
      this.comandas(desde),
      this.db.from('carta_items').select('id, nombre, precio, costo, activo, categoria:carta_categorias(nombre)'),
    ]);
    if (items.error) throw new BadRequestException(items.error.message);

    const vendidos = new Map<string, { unidades: number; ingreso: number }>();
    for (const c of comandas) {
      if (!c.item_id) continue;
      const v = vendidos.get(c.item_id) ?? { unidades: 0, ingreso: 0 };
      v.unidades += c.cantidad;
      v.ingreso += c.cantidad * Number(c.precio_unitario ?? 0);
      vendidos.set(c.item_id, v);
    }

    const platos = (items.data ?? [])
      .filter((i: any) => i.activo)
      .map((i: any) => {
        const v = vendidos.get(i.id) ?? { unidades: 0, ingreso: 0 };
        const precio = Number(i.precio);
        const costo = i.costo != null ? Number(i.costo) : null;
        const margenUnidad = costo != null ? precio - costo : null;
        return {
          id: i.id, nombre: i.nombre, categoria: i.categoria?.nombre ?? '', precio, costo,
          unidades: v.unidades, ingreso: v.ingreso, margenUnidad,
          margenPct: costo != null && precio ? Math.round(((precio - costo) / precio) * 100) : null,
          margenTotal: margenUnidad != null ? margenUnidad * v.unidades : null,
          clase: 'sin_costo' as ClaseMenu, consejo: '',
        };
      });

    const conCosto = platos.filter((p) => p.margenUnidad != null);
    const unidadesTot = conCosto.reduce((s, p) => s + p.unidades, 0);
    const margenTot = conCosto.reduce((s, p) => s + (p.margenTotal ?? 0), 0);
    const pisoUnidades = conCosto.length ? (unidadesTot / conCosto.length) * 0.7 : 0;
    const margenMedio = unidadesTot ? margenTot / unidadesTot : 0;
    for (const p of platos) {
      if (p.margenUnidad != null) {
        const seVende = p.unidades >= pisoUnidades;
        const deja = p.margenUnidad >= margenMedio;
        p.clase = seVende && deja ? 'estrella' : seVende ? 'vende_deja_poco' : deja ? 'deja_vende_poco' : 'ni_vende_ni_deja';
      }
      p.consejo = CONSEJO[p.clase];
    }

    return {
      dias,
      platos: platos.sort((a, b) => (b.margenTotal ?? -1) - (a.margenTotal ?? -1)),
      vara: { pisoUnidades: Math.round(pisoUnidades), margenMedio: Math.round(margenMedio) },
      total: {
        ingreso: platos.reduce((s, p) => s + p.ingreso, 0),
        margen: Math.round(margenTot),
        sinCosto: platos.filter((p) => p.clase === 'sin_costo').length,
      },
    };
  }

  // ── cuánta gente viene los próximos 7 días ──
  // Base: el promedio de cubiertos de ese día de la semana en las últimas seis
  // semanas. Si es feriado en Argentina o en Brasil, se multiplica por el
  // factor de feriado (un SUPUESTO que carga el dueño). El clima y las
  // reservas se muestran al lado: informan, no cambian la cuenta.
  async pronostico() {
    const hoy = fechaArt();
    const [visitas, feriados, cfg, reservas, clima] = await Promise.all([
      this.visitasCerradas(this.desdeHace(42)),
      this.db.from('feriados').select('fecha, pais, nombre').gte('fecha', hoy).lte('fecha', sumarDias(hoy, 6)),
      this.db.from('configuracion').select('factor_feriado').eq('id', true).single(),
      this.db
        .from('reservas')
        .select('fecha_hora, personas, estado')
        .gte('fecha_hora', limitesDeFecha(hoy).desde.toISOString())
        .lte('fecha_hora', limitesDeFecha(sumarDias(hoy, 6)).hasta.toISOString()),
      this.clima(),
    ]);
    if (feriados.error) throw new BadRequestException(feriados.error.message);

    const porFecha = new Map<string, number>();
    for (const v of visitas) {
      const f = fechaArt(v.libre_en);
      if (f >= hoy) continue; // el día en curso no está completo
      porFecha.set(f, (porFecha.get(f) ?? 0) + (v.cubiertos ?? 0));
    }
    const porDiaSemana: number[][] = Array.from({ length: 7 }, () => []);
    for (const [f, cub] of porFecha) porDiaSemana[diaDeSemana(f)].push(cub);

    const factor = Number(cfg.data?.factor_feriado ?? 1.25);
    const dias = Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDias(hoy, i);
      const ds = diaDeSemana(fecha);
      const base = promedio(porDiaSemana[ds], 0);
      const fer = (feriados.data ?? []).filter((x: any) => x.fecha === fecha);
      const delDia = (reservas.data ?? []).filter((r: any) => fechaArt(r.fecha_hora) === fecha && ['pendiente', 'confirmada'].includes(r.estado));
      return {
        fecha,
        dia: DIAS[ds],
        base,
        semanas: porDiaSemana[ds].length,
        feriados: fer.map((x: any) => ({ pais: x.pais, nombre: x.nombre })),
        esperados: base == null ? null : Math.round(base * (fer.length ? factor : 1)),
        reservados: delDia.reduce((s: number, r: any) => s + r.personas, 0),
        clima: clima?.[fecha] ?? null,
      };
    });
    return { dias, factorFeriado: factor, hayClima: !!clima };
  }

  private async clima(): Promise<Record<string, { maxima: number; lluviaPct: number }> | null> {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
        `&daily=temperature_2m_max,precipitation_probability_max&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=7`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const json: any = await res.json();
      const out: Record<string, { maxima: number; lluviaPct: number }> = {};
      (json.daily?.time ?? []).forEach((f: string, i: number) => {
        out[f] = { maxima: Math.round(json.daily.temperature_2m_max[i]), lluviaPct: json.daily.precipitation_probability_max[i] ?? 0 };
      });
      return out;
    } catch (e: any) {
      this.logger.warn(`Sin clima para el pronóstico: ${e.message}`);
      return null;
    }
  }

  async feriados() {
    const { data, error } = await this.db.from('feriados').select('*').gte('fecha', fechaArt()).order('fecha').limit(60);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async agregarFeriado(fecha: string, pais: 'AR' | 'BR', nombre: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) throw new BadRequestException('Elegí la fecha');
    if (!['AR', 'BR'].includes(pais)) throw new BadRequestException('Elegí el país');
    if (!nombre?.trim()) throw new BadRequestException('Poné el nombre del feriado');
    const { data, error } = await this.db.from('feriados').insert({ fecha, pais, nombre: nombre.trim() }).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'Ese feriado ya está cargado' : error.message);
    return data;
  }

  async quitarFeriado(id: string) {
    const { error } = await this.db.from('feriados').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── por dónde entró la plata: medio de pago y moneda ──
  async cobros(dias = 30) {
    const pagos = await leerTodo<any>(() =>
      this.db
        .from('pagos')
        .select('metodo, moneda, monto, monto_ars, creado_en')
        .eq('estado', 'confirmado')
        .gte('creado_en', this.desdeHace(dias))
        .order('creado_en'),
    );
    const total = pagos.reduce((s, p) => s + Number(p.monto_ars), 0);
    const grupos = new Map<string, { metodo: string; moneda: string; cobros: number; monto: number; montoArs: number }>();
    for (const p of pagos) {
      const clave = `${p.metodo}|${p.moneda}`;
      const g = grupos.get(clave) ?? { metodo: p.metodo, moneda: p.moneda, cobros: 0, monto: 0, montoArs: 0 };
      g.cobros++;
      g.monto += Number(p.monto);
      g.montoArs += Number(p.monto_ars);
      grupos.set(clave, g);
    }
    return {
      dias,
      totalArs: total,
      cobros: pagos.length,
      porMedio: [...grupos.values()]
        .sort((a, b) => b.montoArs - a.montoArs)
        .map((g) => ({ ...g, monto: Math.round(g.monto * 100) / 100, partePct: total ? Math.round((g.montoArs / total) * 100) : 0 })),
    };
  }

  // ── el resumen de ayer para mandar al WhatsApp del dueño ──
  async resumenWhatsapp() {
    const [{ fecha, metricas, insight }, cfg] = await Promise.all([
      this.analista.resumenDeAyer(),
      this.db.from('configuracion').select('whatsapp_dueno, nombre_restaurante').eq('id', true).single(),
    ]);
    const dia = DIAS[diaDeSemana(fecha)];
    const mensaje =
      `${cfg.data?.nombre_restaurante ?? 'Gran Caminito'} · ayer ${dia} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}\n` +
      `• Mesas: ${metricas.ciclosCerrados} · ${metricas.cubiertosTotal} personas\n` +
      `• Entró: ${pesos(metricas.ingresoTotal)} · ticket por mesa ${pesos(metricas.ticketProm)}\n` +
      `• Tiempo de mesa: ${metricas.tiempoMesaProm ?? '—'} min · tiempo muerto ${metricas.tiempoMuertoProm ?? '—'} min\n` +
      `• Cada asiento rindió ${pesos(metricas.revPash)} por hora\n` +
      `• Clientes contentos: ${metricas.tasaSatisfaccion != null ? `${metricas.tasaSatisfaccion} %` : 'sin opiniones'}\n` +
      `Para hoy: ${insight}`;
    return {
      fecha,
      mensaje,
      whatsappDueno: cfg.data?.whatsapp_dueno ?? null,
      waLink: cfg.data?.whatsapp_dueno ? linkWhatsapp(cfg.data.whatsapp_dueno, mensaje) : null,
    };
  }
}
