// Cálculos PUROS de cuenta corriente y resumen de comprobantes (sin DB ni red), testeables.

export const GRUPO: Record<string, string> = {
  FA: 'facturas', FB: 'facturas', FC: 'facturas',
  NCA: 'notasCredito', NCB: 'notasCredito', NCC: 'notasCredito',
  NDA: 'notasDebito', NDB: 'notasDebito', NDC: 'notasDebito',
  REM: 'remitos', REC: 'recibos', ANT: 'recibos', SIN: 'internos',
};

export type MovCta = { cliente_id: string; debe: number | string; haber: number | string; cliente?: any };

// Saldo (debe − haber) por cliente, ordenado de mayor deuda a menor.
export function saldosPorCliente(movimientos: MovCta[]) {
  const porCliente = new Map<string, { cliente: any; saldo: number }>();
  for (const m of movimientos ?? []) {
    const acc = porCliente.get(m.cliente_id) ?? { cliente: m.cliente, saldo: 0 };
    acc.saldo += Number(m.debe) - Number(m.haber);
    porCliente.set(m.cliente_id, acc);
  }
  return [...porCliente.values()]
    .map((c) => ({ ...c, saldo: Math.round(c.saldo * 100) / 100 }))
    .sort((a, b) => b.saldo - a.saldo);
}

export type FilaComprobante = { tipo: string; total: number | string; iva?: number | string; estado?: string; emitido_en: string };

// Agrega los comprobantes del mes por grupo + facturado de hoy + IVA débito del mes.
export function agruparResumen(filas: FilaComprobante[], hoy: string) {
  const grupos: Record<string, { cantidad: number; total: number; iva: number }> = {};
  let facturadoHoy = 0;
  let ivaMes = 0;
  for (const c of filas ?? []) {
    if (c.estado === 'anulado') continue;
    const g = GRUPO[c.tipo] ?? 'internos';
    const acc = (grupos[g] ??= { cantidad: 0, total: 0, iva: 0 });
    acc.cantidad += 1;
    acc.total += Number(c.total);
    acc.iva += Number(c.iva ?? 0);
    if (g === 'facturas') {
      ivaMes += Number(c.iva ?? 0);
      if (String(c.emitido_en).slice(0, 10) === hoy) facturadoHoy += Number(c.total);
    }
  }
  const r = (n: number) => Math.round(n);
  return {
    facturadoHoy: r(facturadoHoy),
    ivaMes: r(ivaMes),
    grupos: Object.fromEntries(Object.entries(grupos).map(([k, v]) => [k, { cantidad: v.cantidad, total: r(v.total), iva: r(v.iva) }])),
  };
}

// Numeración linda estilo AFIP: 0001-00000123
export function numeroLindo(c: { punto_venta: number; numero: number | bigint }) {
  return `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;
}
