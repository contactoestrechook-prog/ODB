import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

const ART_OFFSET_H = 3; // Argentina = UTC-3. Sin librería de timezone: alcanza para "hoy/ayer en ART".

// Límites (en UTC real) del día que empezó hace `diasAtras` días, medido en
// hora de Argentina. diasAtras=1 → "ayer".
function limitesDiaArt(diasAtras: number) {
  const ahoraArt = new Date(Date.now() - ART_OFFSET_H * 3_600_000);
  const y = ahoraArt.getUTCFullYear();
  const m = ahoraArt.getUTCMonth();
  const d = ahoraArt.getUTCDate() - diasAtras;
  const desdeArt = new Date(Date.UTC(y, m, d, 0, 0, 0));
  const hastaArt = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  return {
    desde: new Date(desdeArt.getTime() + ART_OFFSET_H * 3_600_000),
    hasta: new Date(hastaArt.getTime() + ART_OFFSET_H * 3_600_000),
    fecha: desdeArt.toISOString().slice(0, 10),
  };
}

function promedio(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;
}

export type MetricasDia = {
  ciclosCerrados: number;
  tiempoMesaProm: number | null; // minutos
  tiempoMuertoProm: number | null; // minutos (pagó -> se liberó)
  ticketProm: number | null;
  ingresoTotal: number;
  cubiertosTotal: number;
  revPash: number | null;
  tasaSatisfaccion: number | null;
};

@Injectable()
export class AnalistaService {
  private readonly logger = new Logger('Analista');

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // El pulso del turno en curso: lo primero que ve el dueño al abrir el
  // panel. Todo sale de mesa_ciclos de hoy — nada de cachés, es "ahora".
  async ahora() {
    const { desde } = limitesDiaArt(0);
    const [mesasRes, activosRes, cerradosHoyRes] = await Promise.all([
      this.db.from('mesas').select('id', { count: 'exact', head: true }).eq('activa', true),
      this.db.from('mesa_ciclos').select('estado_desde, estado, llamado_mozo_en, cubiertos').neq('estado', 'libre'),
      this.db
        .from('mesa_ciclos')
        .select('monto, cubiertos')
        .eq('estado', 'libre')
        .gte('libre_en', desde.toISOString()),
    ]);

    const activos = activosRes.data ?? [];
    const cerrados = cerradosHoyRes.data ?? [];
    const totalMesas = mesasRes.count ?? 0;
    const ahora = Date.now();

    // Mismos umbrales de rojo que el Piso Vivo importaría duplicar; acá
    // alcanza el proxy operativo: llamado sin atender o >20 min sin avanzar.
    const enRiesgo = activos.filter((c: any) => {
      const minutos = (ahora - new Date(c.estado_desde).getTime()) / 60_000;
      return c.llamado_mozo_en != null || minutos >= 20;
    }).length;

    const cobradoHoy = cerrados.reduce((s: number, c: any) => s + (c.monto != null ? Number(c.monto) : 0), 0);

    return {
      ocupadas: activos.length,
      totalMesas,
      ocupacionPct: totalMesas ? Math.round((activos.length / totalMesas) * 100) : 0,
      llamadosPendientes: activos.filter((c: any) => c.llamado_mozo_en != null).length,
      mesasEnRiesgo: enRiesgo,
      cubiertosHoy:
        cerrados.reduce((s: number, c: any) => s + (c.cubiertos ?? 0), 0) +
        activos.reduce((s: number, c: any) => s + (c.cubiertos ?? 0), 0),
      cobradoHoy: Math.round(cobradoHoy),
      mesasCerradasHoy: cerrados.length,
    };
  }

  async resumenDeAyer() {
    const { desde, hasta, fecha } = limitesDiaArt(1);

    const { data: cache } = await this.db.from('analista_insights').select('*').eq('fecha', fecha).maybeSingle();
    if (cache) return { fecha, metricas: cache.metricas as MetricasDia, insight: cache.texto };

    const [metricas, metricasAnterior] = await Promise.all([
      this.calcularMetricas(desde, hasta),
      this.calcularMetricas(limitesDiaArt(2).desde, limitesDiaArt(2).hasta),
    ]);

    const insight = await this.generarInsight(fecha, metricas, metricasAnterior);
    await this.db.from('analista_insights').insert({ fecha, metricas, texto: insight });
    return { fecha, metricas, insight };
  }

  private async calcularMetricas(desde: Date, hasta: Date): Promise<MetricasDia> {
    const { data: config } = await this.db.from('configuracion').select('capacidad_asientos, horas_servicio_dia').eq('id', true).single();

    const { data: ciclos } = await this.db
      .from('mesa_ciclos')
      .select('sentada_en, pago_en, libre_en, monto, cubiertos')
      .eq('estado', 'libre')
      .gte('libre_en', desde.toISOString())
      .lte('libre_en', hasta.toISOString());

    const filas = ciclos ?? [];
    const minutos = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

    const tiemposMesa = filas.map((c: any) => minutos(c.sentada_en, c.libre_en));
    const tiemposMuertos = filas.filter((c: any) => c.pago_en).map((c: any) => minutos(c.pago_en, c.libre_en));
    const montos = filas.filter((c: any) => c.monto != null).map((c: any) => Number(c.monto));
    const ingresoTotal = montos.reduce((s, n) => s + n, 0);
    const cubiertosTotal = filas.reduce((s: number, c: any) => s + (c.cubiertos ?? 0), 0);

    const { data: opiniones } = await this.db
      .from('opiniones')
      .select('sentimiento')
      .gte('creado_en', desde.toISOString())
      .lte('creado_en', hasta.toISOString());
    const totalOpiniones = opiniones?.length ?? 0;
    const contentos = (opiniones ?? []).filter((o: any) => o.sentimiento === 'contento').length;

    const capacidad = config?.capacidad_asientos ?? null;
    const horas = config?.horas_servicio_dia ?? null;
    const revPash = capacidad && horas ? Math.round((ingresoTotal / (capacidad * horas)) * 100) / 100 : null;

    return {
      ciclosCerrados: filas.length,
      tiempoMesaProm: promedio(tiemposMesa),
      tiempoMuertoProm: promedio(tiemposMuertos),
      ticketProm: montos.length ? Math.round(promedio(montos)!) : null,
      ingresoTotal: Math.round(ingresoTotal),
      cubiertosTotal,
      revPash,
      tasaSatisfaccion: totalOpiniones ? Math.round((contentos / totalOpiniones) * 100) : null,
    };
  }

  private async generarInsight(fecha: string, hoy: MetricasDia, ayer: MetricasDia): Promise<string> {
    if (hoy.ciclosCerrados === 0) {
      return 'Todavía no hay mesas cerradas registradas en el Piso Vivo para este día — en cuanto el mozo empiece a usar "Sentar mesa" / avanzar los estados, acá aparece el resumen real.';
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return `Ayer: ${hoy.ciclosCerrados} mesas, tiempo de mesa promedio ${hoy.tiempoMesaProm ?? '—'} min. (Configurá ANTHROPIC_API_KEY para que la IA explique el porqué.)`;
    }
    try {
      const claude = new Anthropic();
      const respuesta = await claude.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 250,
        system:
          'Sos el Analista de NÚCLEO Gastro para Gran Caminito, un asador en Puerto Iguazú. Te doy los números de ayer y de anteayer. Escribí 2-3 oraciones en español rioplatense, directas, sin adornos, señalando UN hallazgo accionable — algo que mejoró, empeoró, o una acción concreta a tomar. Mencioná al menos un número. No inventes datos que no te di.',
        messages: [
          {
            role: 'user',
            content: `Fecha: ${fecha}\nAYER: ${JSON.stringify(hoy)}\nANTEAYER: ${JSON.stringify(ayer)}`,
          },
        ],
      });
      const bloque = respuesta.content.find((b) => b.type === 'text');
      return bloque && 'text' in bloque ? bloque.text.trim() : '';
    } catch (e: any) {
      this.logger.error(`Falló la generación del insight del ${fecha}: ${e.message}`);
      return `Ayer: ${hoy.ciclosCerrados} mesas, tiempo de mesa promedio ${hoy.tiempoMesaProm ?? '—'} min.`;
    }
  }
}
