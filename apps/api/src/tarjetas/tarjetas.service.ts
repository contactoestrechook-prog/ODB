import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Panel de cobros con tarjeta (Getnet y Clover), espejo del de Mercado Pago:
// cuánto se cobró con cada posnet, qué falta acreditar y cuándo entra.
// La comisión REAL se completa al conciliar la liquidación de cada procesador
// (o por API cuando Getnet/Clover habiliten la integración).
@Injectable()
export class TarjetasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private async filas(dias: number) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data, error } = await this.db
      .from('acreditaciones')
      .select(
        'id, bruto, comision_real, neto_real, neto_estimado, fecha_estimada, fecha_real, estado, creado_en, pago:pagos!inner(terminal), venta:ventas(vendida_en, sucursal:sucursales(nombre))',
      )
      .eq('medio', 'tarjeta')
      .gte('creado_en', desde)
      .order('creado_en', { ascending: false })
      .limit(5000);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as any[];
  }

  async resumen(dias = 30) {
    const filas = await this.filas(dias);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const porTerminal = new Map<string, any>();
    for (const f of filas) {
      const t = (f.pago as any)?.terminal ?? 'sin identificar';
      const acc = porTerminal.get(t) ?? { terminal: t, cobros: 0, bruto: 0, porAcreditar: 0, acreditado: 0, comisionReal: 0 };
      acc.cobros++;
      acc.bruto += Number(f.bruto);
      if (f.estado === 'acreditada') {
        acc.acreditado += Number(f.neto_real ?? 0);
        acc.comisionReal += Number(f.comision_real ?? 0);
      } else {
        acc.porAcreditar += Number(f.bruto);
      }
      porTerminal.set(t, acc);
    }

    const pendientes = filas.filter((f) => f.estado !== 'acreditada');
    const proximas = pendientes
      .filter((f) => f.fecha_estimada)
      .reduce((m: Map<string, number>, f) => {
        const dia = String(f.fecha_estimada).slice(0, 10);
        m.set(dia, (m.get(dia) ?? 0) + Number(f.bruto));
        return m;
      }, new Map<string, number>());

    const bruto = filas.reduce((s, f) => s + Number(f.bruto), 0);
    const comision = filas.reduce((s, f) => s + Number(f.comision_real ?? 0), 0);
    const brutoAcreditado = filas.filter((f) => f.estado === 'acreditada').reduce((s, f) => s + Number(f.bruto), 0);
    return {
      periodo: `${dias} días`,
      cobros: filas.length,
      bruto: r2(bruto),
      porAcreditar: r2(pendientes.reduce((s, f) => s + Number(f.bruto), 0)),
      acreditado: r2(filas.filter((f) => f.estado === 'acreditada').reduce((s, f) => s + Number(f.neto_real ?? 0), 0)),
      comisionReal: r2(comision),
      comisionPromedioPct: brutoAcreditado > 0 ? Math.round((comision / brutoAcreditado) * 1000) / 10 : null,
      porTerminal: [...porTerminal.values()].map((t) => ({
        ...t,
        bruto: r2(t.bruto),
        porAcreditar: r2(t.porAcreditar),
        acreditado: r2(t.acreditado),
        comisionReal: r2(t.comisionReal),
      })),
      proximasAcreditaciones: [...proximas.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(0, 10)
        .map(([fecha, monto]) => ({ fecha, bruto: r2(monto) })),
    };
  }

  async pagos(dias = 30) {
    const filas = await this.filas(dias);
    return filas.slice(0, 300).map((f) => ({
      id: f.id,
      fecha: (f.venta as any)?.vendida_en ?? f.creado_en,
      terminal: (f.pago as any)?.terminal ?? null,
      sucursal: (f.venta as any)?.sucursal?.nombre ?? null,
      bruto: Number(f.bruto),
      estado: f.estado,
      fechaEstimada: f.fecha_estimada,
      fechaReal: f.fecha_real,
      netoReal: f.neto_real != null ? Number(f.neto_real) : null,
      comisionReal: f.comision_real != null ? Number(f.comision_real) : null,
    }));
  }
}
