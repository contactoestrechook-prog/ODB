// Libro IVA — lógica de negocio PURA (sin DB ni UI), por eso es testeable (libro-iva.spec.ts).
// Ventas: se arma desde los comprobantes fiscales (las NC restan).
// Compras: desde las facturas de proveedor (neto/IVA reales si se cargaron; si no, se estima 21%).

export type ComprobanteVenta = {
  tipo: string;
  puntoVenta: number;
  numero: number | string;
  fecha: string;
  receptor?: { nombre?: string; doc_tipo?: string; doc_numero?: string } | null;
  neto: number;
  iva: number;
  total: number;
  ivaDetalle?: { alicuota: number; base: number; monto: number }[];
  estado?: string;
};

export type FacturaCompra = {
  numero: string;
  fecha: string;
  proveedor?: string | null;
  cuit?: string | null;
  monto: number;
  neto?: number | null;
  iva?: number | null;
};

const FISCAL_VENTA = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'];
const NOTA_CREDITO = ['NCA', 'NCB', 'NCC'];

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const numeroLindo = (pv: number, nro: number | string) =>
  `${String(pv).padStart(4, '0')}-${String(nro).padStart(8, '0')}`;

export function libroIvaVentas(comprobantes: ComprobanteVenta[]) {
  const porAlicuota = new Map<number, { neto: number; iva: number }>();
  const filas: any[] = [];
  let neto = 0, iva = 0, total = 0;

  for (const c of comprobantes) {
    if (!FISCAL_VENTA.includes(c.tipo) || c.estado === 'anulado') continue;
    const signo = NOTA_CREDITO.includes(c.tipo) ? -1 : 1; // las NC restan del débito fiscal
    const fNeto = r2(signo * Number(c.neto || 0));
    const fIva = r2(signo * Number(c.iva || 0));
    const fTotal = r2(signo * Number(c.total || 0));
    for (const d of c.ivaDetalle ?? []) {
      const acc = porAlicuota.get(d.alicuota) ?? { neto: 0, iva: 0 };
      acc.neto += signo * Number(d.base || 0);
      acc.iva += signo * Number(d.monto || 0);
      porAlicuota.set(d.alicuota, acc);
    }
    neto += fNeto; iva += fIva; total += fTotal;
    filas.push({
      tipo: c.tipo,
      comprobante: numeroLindo(c.puntoVenta, c.numero),
      fecha: c.fecha,
      receptor: c.receptor?.nombre ?? 'Consumidor final',
      docNumero: c.receptor?.doc_numero ?? null,
      neto: fNeto, iva: fIva, total: fTotal,
    });
  }

  return {
    filas,
    porAlicuota: [...porAlicuota.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([alicuota, v]) => ({ alicuota, neto: r2(v.neto), iva: r2(v.iva) })),
    totales: { neto: r2(neto), iva: r2(iva), total: r2(total) },
    cantidad: filas.length,
  };
}

export function libroIvaCompras(facturas: FacturaCompra[]) {
  const filas: any[] = [];
  let neto = 0, iva = 0, total = 0, estimadas = 0;

  for (const f of facturas) {
    const fTotal = Number(f.monto || 0);
    let fNeto: number, fIva: number, estimado: boolean;
    if (f.neto != null && f.iva != null) {
      fNeto = Number(f.neto); fIva = Number(f.iva); estimado = false;
    } else {
      fNeto = r2(fTotal / 1.21); fIva = r2(fTotal - fNeto); estimado = true; estimadas += 1; // asume 21% incluido
    }
    neto += fNeto; iva += fIva; total += fTotal;
    filas.push({
      comprobante: f.numero,
      fecha: f.fecha,
      proveedor: f.proveedor ?? '—',
      cuit: f.cuit ?? null,
      neto: r2(fNeto), iva: r2(fIva), total: r2(fTotal), estimado,
    });
  }

  return {
    filas,
    totales: { neto: r2(neto), iva: r2(iva), total: r2(total) },
    cantidad: filas.length,
    estimadas, // cuántas filas tienen IVA estimado (sin neto/iva cargado) → el libro no es exacto
  };
}

// IVA débito (ventas) − IVA crédito (compras). saldo > 0 = a pagar a la AFIP.
export function resumenIva(
  ventas: { totales: { iva: number } },
  compras: { totales: { iva: number } },
) {
  const ivaDebito = r2(ventas.totales.iva);
  const ivaCredito = r2(compras.totales.iva);
  return { ivaDebito, ivaCredito, saldo: r2(ivaDebito - ivaCredito) };
}
