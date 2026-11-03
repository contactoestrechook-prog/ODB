import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// El lector de los sensores QBIT (Bitronic) de las cámaras y heladeras
// (Leandro, 3/11/2026). La API de QBIT da la última medición de cada sensor y
// admite UNA consulta cada 40 s por cliente (todas las consultas juntas; antes
// de tiempo responde 429 y no reinicia la espera). Por eso hay un solo turno:
//   - cada minuto, la última medición de todos los equipos en UNA consulta;
//   - entre medio, si falta historia de los últimos 7 días, un día de un equipo
//     por vez con desde/hasta (QBIT lo da solo si lo habilitó; si dice 403, se
//     deja de pedir hasta el próximo reinicio).
// Sin QBIT_TOKEN en el entorno no consulta nada. Sin avisos por WhatsApp por
// ahora (Leandro, 3/11: «por ahora sin aviso por whatsapp»).
const URL_QBIT = 'https://services.bitronic.com.ar/api/sensores';
const ESPERA_MS = 42_000;          // 40 s de QBIT + margen
const CADA_MS = 60_000;            // una consulta de las últimas por minuto
const DIAS_HISTORIA = 7;

type Registro = { idequipo: string; datatime: string; data: string | string[] };
type Pendiente = { idequipo: string; dia: string };

export type EstadoLector = {
  token: boolean;
  ultimaConsulta: string | null;
  ultimoError: string | null;
  historia: 'sin_empezar' | 'completando' | 'completa' | 'no_habilitada';
  diasPendientes: number;
};

@Injectable()
export class FrioLector {
  private readonly log = new Logger('Frio');
  private ultimaLlamada = 0;
  private ultimaUltimas = 0;
  private ocupado = false;
  private pendientes: Pendiente[] | null = null;
  readonly estado: EstadoLector = {
    token: !!process.env.QBIT_TOKEN, ultimaConsulta: null, ultimoError: null, historia: 'sin_empezar', diasPendientes: 0,
  };

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Interval(5_000)
  async turno() {
    const token = process.env.QBIT_TOKEN;
    if (!token || this.ocupado) return;
    const ahora = Date.now();
    if (ahora - this.ultimaLlamada < ESPERA_MS) return;
    this.ocupado = true;
    try {
      const equipos = await this.equipos();
      if (!equipos.length) return;
      if (ahora - this.ultimaUltimas >= CADA_MS) {
        this.ultimaUltimas = ahora;
        await this.ultimas(token, equipos);
      } else {
        await this.unDiaDeHistoria(token, equipos);
      }
    } catch (e: any) {
      this.estado.ultimoError = String(e?.message ?? e);
      this.log.warn(`QBIT: ${this.estado.ultimoError}`);
    } finally {
      this.ocupado = false;
    }
  }

  private async equipos(): Promise<string[]> {
    const { data, error } = await this.db.from('frio_equipos').select('idequipo').eq('activo', true);
    if (error) throw new Error(`frio_equipos: ${error.message}`);
    return (data ?? []).map((e: any) => String(e.idequipo));
  }

  private async pedir(token: string, params: Record<string, string>) {
    this.ultimaLlamada = Date.now();
    const r = await fetch(`${URL_QBIT}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 204) return [] as Registro[];
    if (!r.ok) throw Object.assign(new Error(`QBIT respondió ${r.status}`), { status: r.status });
    const j: any = await r.json();
    const lista = j.records ?? j.record ?? [];
    return (Array.isArray(lista) ? lista : [lista]) as Registro[];
  }

  private async ultimas(token: string, equipos: string[]) {
    const regs = await this.pedir(token, { idequipo: equipos.join(',') });
    await this.guardar(regs);
    this.estado.ultimaConsulta = new Date().toISOString();
    this.estado.ultimoError = null;
  }

  private async unDiaDeHistoria(token: string, equipos: string[]) {
    if (this.estado.historia === 'no_habilitada' || this.estado.historia === 'completa') return;
    if (!this.pendientes) {
      this.pendientes = await this.diasQueFaltan(equipos);
      this.estado.historia = this.pendientes.length ? 'completando' : 'completa';
    }
    const p = this.pendientes.shift();
    this.estado.diasPendientes = this.pendientes.length;
    if (!p) { this.estado.historia = 'completa'; return; }
    try {
      const regs = await this.pedir(token, { idequipo: p.idequipo, desde: `${p.dia} 00:00:00`, hasta: `${p.dia} 23:59:59` });
      await this.guardar(regs);
      this.log.log(`QBIT: historia de ${p.idequipo} del ${p.dia}: ${regs.length} mediciones`);
    } catch (e: any) {
      if (e?.status === 403 || e?.status === 400) {
        this.estado.historia = 'no_habilitada';
        this.pendientes = [];
        this.log.warn(`QBIT no da la historia por fecha (${e.status}): solo se guarda desde ahora`);
        return;
      }
      this.pendientes.unshift(p);   // 429 o una caída: se vuelve a intentar en el próximo turno
      throw e;
    }
  }

  // Días de los últimos 7 con menos de la mitad de las mediciones (una por minuto)
  private async diasQueFaltan(equipos: string[]): Promise<Pendiente[]> {
    const out: Pendiente[] = [];
    const hoy = diaArgentina(new Date());
    for (const idequipo of equipos) {
      for (let k = DIAS_HISTORIA; k >= 1; k--) {
        const dia = sumarDias(hoy, -k);
        const { count } = await this.db.from('frio_mediciones').select('idequipo', { count: 'exact', head: true })
          .eq('idequipo', idequipo).gte('medido_en', `${dia}T00:00:00-03:00`).lte('medido_en', `${dia}T23:59:59-03:00`);
        if ((count ?? 0) < 720) out.push({ idequipo, dia });
      }
    }
    return out;
  }

  private async guardar(regs: Registro[]) {
    const filas = regs.map((r) => {
      const valor = Array.isArray(r.data) ? r.data[0] : r.data;
      const t = Number(String(valor).replace(',', '.'));
      return { idequipo: String(r.idequipo), medido_en: horaArgentina(r.datatime), temperatura: t };
    }).filter((f) => Number.isFinite(f.temperatura) && f.medido_en);
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await this.db.from('frio_mediciones')
        .upsert(filas.slice(i, i + 500), { onConflict: 'idequipo,medido_en', ignoreDuplicates: true });
      if (error) throw new Error(`frio_mediciones: ${error.message}`);
    }
  }
}

// QBIT manda «2026-11-03 17:52:30» en hora argentina
function horaArgentina(s: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s ?? ''));
  return m ? `${m[1]}T${m[2]}-03:00` : '';
}
function diaArgentina(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
