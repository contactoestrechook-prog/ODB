import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { fetchConTimeout } from '../comun/http';
import { CuentaMP, cuentasMP } from './mp-cuentas';
import { leerReporteLiberaciones } from './reporte-liberaciones';

// La plata real de Mercado Pago (Leandro, 5/11/2026): el reporte de liberaciones
// de cada cuenta, pedido, bajado y guardado solo en mp_movimientos.
// Cada 10 minutos, por cuenta:
//   1. lee los reportes pedidos que MP ya generó (y da por perdido el que
//      pasadas 6 horas no aparece);
//   2. si todavía no está el de ayer, pide los últimos 3 días hasta hoy 0 h;
//   3. si no, completa la historia hacia atrás, un mes por vez, hasta el
//      1/10/2025 (la cuenta de ODB arranca el 5/10/2025).
// Nunca hay más de un reporte pedido sin leer por cuenta. Solo lee de MP.
const MP = 'https://api.mercadopago.com';
const HISTORIA_DESDE = Date.parse('2025-10-01T03:00:00Z');
const DIA = 86400_000;

@Injectable()
export class MpReportesService {
  private readonly log = new Logger('MpReportes');
  private ocupado = false;
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Interval(10 * 60_000)
  async turno() {
    if (this.ocupado || process.env.MP_REPORTES === '0') return;
    this.ocupado = true;
    try {
      for (const cuenta of await cuentasMP(this.db)) {
        try { await this.cuenta(cuenta); } catch (e: any) { this.log.warn(`${cuenta.slug}: ${e?.message ?? e}`); }
      }
    } finally {
      this.ocupado = false;
    }
  }

  private async cuenta(c: CuentaMP) {
    const h = { Authorization: `Bearer ${c.token}` };
    const { data: pedidos } = await this.db.from('mp_reportes').select('id, desde, hasta, pedido_en').eq('cuenta', c.slug).eq('estado', 'pedido');
    if (pedidos?.length) {
      const r = await fetchConTimeout(`${MP}/v1/account/release_report/list`, { headers: h });
      if (!r.ok) throw new Error(`lista de reportes ${r.status}`);
      const lista: any[] = await r.json();
      for (const p of pedidos) {
        const mp = lista.find((x) => String(x.id) === String(p.id));
        if (mp?.file_name) await this.leer(c, p.id, mp.file_name);
        else if (Date.now() - Date.parse(p.pedido_en) > 6 * 3600_000) {
          await this.db.from('mp_reportes').update({ estado: 'error', error: 'MP no lo generó en 6 horas' }).eq('id', p.id);
        }
      }
      return; // un paso por turno
    }
    const hoy0 = medianocheArgentina(Date.now());
    const { data: leidos } = await this.db.from('mp_reportes').select('desde, hasta').eq('cuenta', c.slug).eq('estado', 'leido');
    const ultimo = Math.max(0, ...(leidos ?? []).map((x: any) => Date.parse(x.hasta)));
    const primero = Math.min(Infinity, ...(leidos ?? []).map((x: any) => Date.parse(x.desde)));
    if (ultimo < hoy0 - 1000) return this.pedir(c, hoy0 - 3 * DIA, hoy0);
    if (primero > HISTORIA_DESDE) {
      const desde = Math.max(HISTORIA_DESDE, inicioMesAnterior(primero));
      return this.pedir(c, desde, primero);
    }
  }

  private async pedir(c: CuentaMP, desde: number, hasta: number) {
    const r = await fetchConTimeout(`${MP}/v1/account/release_report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ begin_date: new Date(desde).toISOString().replace('.000', ''), end_date: new Date(hasta - 1000).toISOString().replace('.000', '') }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.id) throw new Error(`pedir reporte ${r.status}: ${j?.message ?? ''}`);
    await this.db.from('mp_reportes').insert({ id: String(j.id), cuenta: c.slug, desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() });
    this.log.log(`${c.slug}: pedido el reporte ${new Date(desde).toISOString().slice(0, 10)} → ${new Date(hasta).toISOString().slice(0, 10)}`);
  }

  private async leer(c: CuentaMP, id: string, archivo: string) {
    const r = await fetchConTimeout(`${MP}/v1/account/release_report/${encodeURIComponent(archivo)}`, { headers: { Authorization: `Bearer ${c.token}` } }, 60_000);
    if (!r.ok) throw new Error(`bajar ${archivo}: ${r.status}`);
    const filas = leerReporteLiberaciones(c.slug, await r.text()).map((m) => ({ ...m, reporte_id: id }));
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await this.db.from('mp_movimientos').upsert(filas.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error(`mp_movimientos: ${error.message}`);
    }
    await this.db.from('mp_reportes').update({ estado: 'leido', archivo, lineas: filas.length, leido_en: new Date().toISOString() }).eq('id', id);
    this.log.log(`${c.slug}: leído ${archivo} (${filas.length} líneas)`);
  }

  // ── para la pantalla ──
  async movimientos(desde: string, hasta: string, cuenta?: string) {
    const [dias, saldos, rep] = await Promise.all([
      this.db.rpc('mp_movimientos_dias', { p_desde: desde, p_hasta: hasta, p_cuenta: cuenta ?? null }),
      Promise.all(['principal', 'santa_ines'].filter((c) => !cuenta || c === cuenta).map(async (c) => {
        const { data } = await this.db.from('mp_movimientos').select('fecha, saldo').eq('cuenta', c).not('saldo', 'is', null)
          .order('fecha', { ascending: false }).order('orden', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        return { cuenta: c, fecha: data?.fecha ?? null, saldo: data?.saldo != null ? Number(data.saldo) : null };
      })),
      this.db.from('mp_reportes').select('cuenta, desde, hasta, estado').order('hasta', { ascending: false }),
    ]);
    if (dias.error) throw new BadRequestException(`mp_movimientos_dias: ${dias.error.message}`);
    const cobertura = ['principal', 'santa_ines'].map((c) => {
      const l = (rep.data ?? []).filter((x: any) => x.cuenta === c && x.estado === 'leido');
      return { cuenta: c, desde: l.length ? l.map((x: any) => x.desde).sort()[0] : null, hasta: l.length ? l[0].hasta : null, pendientes: (rep.data ?? []).filter((x: any) => x.cuenta === c && x.estado === 'pedido').length };
    });
    return { desde, hasta, filas: dias.data ?? [], saldos, cobertura };
  }

  async movimientosDelDia(dia: string, cuenta?: string, descripcion?: string) {
    let q = this.db.from('mp_movimientos')
      .select('id, cuenta, fecha, source_id, descripcion, credito, debito, bruto, comision, impuestos, medio, saldo')
      .gte('fecha', `${dia}T00:00:00-03:00`).lte('fecha', `${dia}T23:59:59.999-03:00`)
      .not('descripcion', 'like', 'reserve_for_%').not('descripcion', 'in', '(initial_available_balance,total)')
      .order('fecha', { ascending: false }).order('orden', { ascending: false }).limit(2000);
    if (cuenta) q = q.eq('cuenta', cuenta);
    if (descripcion) q = q.eq('descripcion', descripcion);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}

// 0 h de hoy en Argentina (UTC−3), en milisegundos
export function medianocheArgentina(t: number): number {
  return Math.floor((t - 3 * 3600_000) / DIA) * DIA + 3 * 3600_000;
}
// hacia atrás: si t cae el día 1, el 1 del mes anterior; si no, el 1 de su mes (hora argentina)
export function inicioMesAnterior(t: number): number {
  const d = new Date(t - 3 * 3600_000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return d.getUTCDate() === 1 ? Date.UTC(y, m - 1, 1, 3) : Date.UTC(y, m, 1, 3);
}
