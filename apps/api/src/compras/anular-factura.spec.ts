// ANULAR FACTURA (9/11/2026): «agregale un botón que diga anular factura,
// siempre». Anular devuelve el stock que la factura sumó; antes solo cambiaba
// el estado (La Serenísima 06376-00001075, cargada dos veces: 466 unidades).
import { ComprasService } from './compras.service';

function dbFalsa(o: { estado?: string; pagos?: number[]; origen?: string; otras?: number; movs?: any[] }) {
  const rpcs: any[] = [];
  const updates: any[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla };
      const datos = () => {
        if (tabla === 'facturas_proveedor_pagos') return (o.pagos ?? []).map((monto) => ({ monto }));
        if (tabla === 'facturas_proveedor' && op.lista) return Array.from({ length: o.otras ?? 0 }, (_, k) => ({ id: `otra-${k}` }));
        if (tabla === 'movimientos_stock') return o.movs ?? [];
        return [];
      };
      const q: any = {
        select: () => { op.lista = true; return q; },
        update: (v: any) => { updates.push({ tabla, v }); return q; },
        insert: () => q, eq: () => q, neq: () => q, in: () => q,
        maybeSingle: () => {
          if (tabla === 'facturas_proveedor') return Promise.resolve({ data: { id: 'f2', estado: o.estado ?? 'pagada', numero: '06376-00001075', oc_id: 'oc-2', proveedor_id: 'ls' }, error: null });
          if (tabla === 'ordenes_compra') return Promise.resolve({ data: { numero: 77, origen: o.origen ?? 'directa' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (ok: any, mal: any) => Promise.resolve({ data: datos(), error: null }).then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => { rpcs.push({ nombre, args }); return Promise.resolve({ data: 1, error: null }); }),
  };
  return { db, rpcs, updates };
}
const MOVS = [
  { producto_id: 'q1', sucursal_id: 's1', cantidad: 24, referencia_tipo: 'compra_directa', producto: { nombre: 'Queso port salut' } },
  { producto_id: 'q1', sucursal_id: 's1', cantidad: 12, referencia_tipo: 'compra_directa', producto: { nombre: 'Queso port salut' } },
  { producto_id: 'l1', sucursal_id: 's1', cantidad: 48, referencia_tipo: 'compra_directa', producto: { nombre: 'Leche 1L' } },
  { producto_id: 'l1', sucursal_id: 's1', cantidad: -6, referencia_tipo: 'devolucion_proveedor', producto: { nombre: 'Leche 1L' } },
];

describe('anular una factura', () => {
  it('la «pagada» de contado sin pagos se anula y lo que sumó sale del stock, neto por producto', async () => {
    const { db, rpcs, updates } = dbFalsa({ movs: MOVS });
    const r: any = await new ComprasService(db).anularFactura('f2', 'cargada dos veces', 'u-ana');
    expect(rpcs.map((x) => [x.args.p_producto_id, x.args.p_cantidad, x.args.p_tipo])).toEqual([['q1', -36, 'ajuste'], ['l1', -42, 'ajuste']]);
    expect(rpcs[0].args).toMatchObject({ p_referencia_tipo: 'anulacion_factura', p_referencia_id: 'f2', p_motivo: 'Anulación de la factura 06376-00001075: cargada dos veces' });
    expect(updates).toContainEqual({ tabla: 'facturas_proveedor', v: { estado: 'anulada', monto_pagado: 0 } });
    expect(r.stock.restadas).toHaveLength(2);
  });
  it('con pagos cargados no se anula: primero el pago', async () => {
    const { db, rpcs } = dbFalsa({ pagos: [500000] });
    await expect(new ComprasService(db).anularFactura('f2', 'x')).rejects.toThrow(/primero anulá el pago/);
    expect(rpcs).toEqual([]);
  });
  it('en una orden de pago no se anula', async () => {
    const { db } = dbFalsa({ estado: 'en_pago' });
    await expect(new ComprasService(db).anularFactura('f2', 'x')).rejects.toThrow(/orden de pago/);
  });
  it('si la mercadería entró por un pedido, no adivina: avisa y no toca el stock', async () => {
    const { db, rpcs } = dbFalsa({ origen: 'manual', movs: MOVS });
    const r: any = await new ComprasService(db).anularFactura('f2', 'x');
    expect(rpcs).toEqual([]);
    expect(r.stock.aviso).toMatch(/orden de compra #77/);
  });
});
