// ANULAR, CORREGIR RENGLONES Y COMPRA EVENTUAL (18/11/2026).
// Leandro: «anular alguna factura cargada y que eso conlleve a retirar del stock, y la
// factura y en administración, todo lo que se ingresó […] modificar algún ítem de esa
// factura, retirarlo […] compra eventual […] que no me cambie ni el costo […] ni el precio».
// La anulación y la corrección son una transacción en la base (anular_factura_proveedor y
// corregir_renglones_factura, db/migracion-anular-factura-completa.sql, probadas contra
// facturas reales con la vuelta atrás); acá se prueba lo que hace la API alrededor.
import { ComprasService } from './compras.service';
import { precioDesdeCosto, margenAplicable } from './precio';

function dbFalsa(o: {
  rpc?: Record<string, { data?: any; error?: any }>;
  facturasPrevias?: number; // facturas «de las de siempre» del proveedor (para la compra eventual)
  factura?: any;
  margenes?: any[];
  rubros?: any[];
} = {}) {
  const rpcs: { nombre: string; args: any }[] = [];
  const inserts: { tabla: string; v: any }[] = [];
  const upserts: { tabla: string; v: any }[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla, head: false };
      const datos = () => {
        if (tabla === 'proveedor_productos') return o.margenes ?? [];
        if (tabla === 'productos') return o.rubros ?? [];
        return [];
      };
      const q: any = {
        select: (_c?: string, opts?: any) => { if (opts?.head) op.head = true; return q; },
        insert: (v: any) => { inserts.push({ tabla, v }); return q; },
        upsert: (v: any) => { upserts.push({ tabla, v }); return q; },
        update: () => q,
        eq: () => q, neq: () => q, in: () => q, is: () => q, gt: () => q, gte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => {
          if (tabla === 'productos') return Promise.resolve({ data: { id: 'p-1' }, error: null });
          if (tabla === 'facturas_proveedor') return Promise.resolve({ data: o.factura ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        single: () => Promise.resolve({ data: { id: 'f-nueva' }, error: null }),
        then: (ok: any, mal: any) => Promise.resolve(
          op.head ? { count: o.facturasPrevias ?? 0, error: null } : { data: datos(), error: null },
        ).then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      rpcs.push({ nombre, args });
      const r = o.rpc?.[nombre];
      if (r) return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      return Promise.resolve({ data: nombre === 'recibir_compra_directa' ? { oc_id: 'oc-1', remito_id: 'rem-1' } : 1, error: null });
    }),
  };
  return { db, rpcs, inserts, upserts };
}

describe('anular una factura', () => {
  it('lo hace la base, todo junto, y devuelve qué pasó con el stock, el costo y el precio', async () => {
    const stock = { restadas: [{ producto: 'Queso Cottage', cantidad: 6 }], sinRestar: [], sumadas: [], aviso: null };
    const costos = [{ producto_id: 'q1', costo: 'vuelto', precio: 'vuelto' }];
    const { db, rpcs } = dbFalsa({ rpc: { anular_factura_proveedor: { data: { ok: true, stock, costos, remitosLiberados: 0 } } } });
    const r: any = await new ComprasService(db).anularFactura('f2', 'cargada dos veces', 'u-juan');
    expect(rpcs).toEqual([{ nombre: 'anular_factura_proveedor', args: { p_factura: 'f2', p_motivo: 'cargada dos veces', p_usuario: 'u-juan' } }]);
    expect(r.stock).toEqual(stock);
    expect(r.costos).toEqual(costos);
  });
  it('si ya estaba anulada no hace nada y no falla', async () => {
    const { db } = dbFalsa({ rpc: { anular_factura_proveedor: { data: { ya_anulada: true } } } });
    const r: any = await new ComprasService(db).anularFactura('f2', '');
    expect(r).toMatchObject({ ok: true, stock: { restadas: [], sinRestar: [] } });
  });
  it('lo que frena la base (pagos cargados, orden de pago) llega como mensaje', async () => {
    const { db } = dbFalsa({ rpc: { anular_factura_proveedor: { error: { message: 'Tiene pagos cargados por $500.000,00: primero anulá el pago.' } } } });
    await expect(new ComprasService(db).anularFactura('f2', 'x')).rejects.toThrow(/primero anulá el pago/);
  });
});

describe('corregir renglones de una factura', () => {
  it('sin motivo no se corrige', async () => {
    const { db, rpcs } = dbFalsa({ factura: { proveedor_id: 'wapi', compra_eventual: false } });
    await expect(new ComprasService(db).corregirRenglonesFactura('f2', { renglones: [{ productoId: 'q1', cantidad: 5, costo: 100 }], motivo: ' ' })).rejects.toThrow(/por qué se corrige/);
    expect(rpcs).toEqual([]);
  });
  it('manda cantidad, costo y el precio de venta con la remarcación del proveedor', async () => {
    const { db, rpcs } = dbFalsa({
      factura: { proveedor_id: 'wapi', compra_eventual: false },
      margenes: [{ producto_id: 'q1', margen_pct: 50 }],
      rubros: [{ id: 'q1', categoria: { margen_sugerido: 40 } }, { id: 'q2', categoria: { margen_sugerido: 40 } }],
      rpc: { corregir_renglones_factura: { data: { ok: true } } },
    });
    await new ComprasService(db).corregirRenglonesFactura('f2', {
      renglones: [
        { productoId: 'q1', cantidad: 5, costo: 1000 },
        { productoId: 'q3', productoNuevoId: 'q2', cantidad: 12, costo: 600 },
        { productoId: 'q4', cantidad: 0, costo: 0 },
      ],
      motivo: 'eran 5',
    }, 'u-juan');
    const args = rpcs[0].args;
    expect(rpcs[0].nombre).toBe('corregir_renglones_factura');
    expect(args.p_motivo).toBe('eran 5');
    expect(args.p_renglones).toEqual([
      { producto_id: 'q1', producto_nuevo_id: null, cantidad: 5, costo: 1000, precio: precioDesdeCosto(1000, margenAplicable(50, 40)) },
      // el precio del producto correcto sale con SU remarcación (la del rubro: el proveedor no tiene una)
      { producto_id: 'q3', producto_nuevo_id: 'q2', cantidad: 12, costo: 600, precio: precioDesdeCosto(600, margenAplicable(null, 40)) },
      { producto_id: 'q4', producto_nuevo_id: null, cantidad: 0, costo: 0, precio: null },
    ]);
  });
  it('en una compra eventual no se calcula ningún precio de venta', async () => {
    const { db, rpcs } = dbFalsa({ factura: { proveedor_id: 'super', compra_eventual: true }, rpc: { corregir_renglones_factura: { data: { ok: true } } } });
    await new ComprasService(db).corregirRenglonesFactura('f9', { renglones: [{ productoId: 'coca', cantidad: 24, costo: 3500 }], motivo: 'eran 24' });
    expect(rpcs[0].args.p_renglones[0].precio).toBeNull();
  });
});

describe('compra eventual', () => {
  const entrada = {
    proveedorId: 'super-del-barrio', sucursalId: 's-1', usuarioId: 'u-ana',
    items: [{ sku: 'COCA', cantidad: 24, costo: 3500, descripcionLeida: 'COCA COLA 1.5' }],
    factura: { numero: '0001-00000123', total: 84000, compraEventual: true },
  };
  it('proveedor nuevo: entra al stock sin tocar costo ni precio, no aprende el proveedor y la factura queda marcada', async () => {
    const { db, rpcs, inserts, upserts } = dbFalsa({ facturasPrevias: 0 });
    const r: any = await new ComprasService(db).entradaDirecta(entrada as any);
    const recibir = rpcs.find((x) => x.nombre === 'recibir_compra_directa')!;
    expect(recibir.args.p_items_precio).toEqual([]);
    expect(recibir.args.p_items).toEqual([expect.objectContaining({ cantidad: 24, costo_unitario: 3500 })]);
    expect(upserts.filter((u) => u.tabla === 'proveedor_productos')).toEqual([]);
    expect(inserts.find((i) => i.tabla === 'facturas_proveedor')?.v).toMatchObject({ compra_eventual: true, monto: 84000 });
    expect(r.factura.compraEventual).toBe(true);
  });
  it('un proveedor que ya tiene facturas no puede: frena antes de tocar el stock', async () => {
    const { db, rpcs } = dbFalsa({ facturasPrevias: 3 });
    await expect(new ComprasService(db).entradaDirecta(entrada as any)).rejects.toThrow(/solo para un proveedor nuevo/);
    expect(rpcs.find((x) => x.nombre === 'recibir_compra_directa')).toBeUndefined();
  });
  it('sin tildar, la compra remarca como siempre', async () => {
    const { db, rpcs, inserts } = dbFalsa({ facturasPrevias: 0 });
    await new ComprasService(db).entradaDirecta({ ...entrada, factura: { ...entrada.factura, compraEventual: false } } as any);
    const recibir = rpcs.find((x) => x.nombre === 'recibir_compra_directa')!;
    expect(recibir.args.p_items_precio).toEqual([expect.objectContaining({ sku: 'COCA', costo: 3500 })]);
    expect(inserts.find((i) => i.tabla === 'facturas_proveedor')?.v).toMatchObject({ compra_eventual: false });
  });
  it('se ofrece solo si el proveedor no tiene facturas de las de siempre', async () => {
    expect(await new ComprasService(dbFalsa({ facturasPrevias: 0 }).db).primeraCompraProveedor('x')).toEqual({ primeraVez: true });
    expect(await new ComprasService(dbFalsa({ facturasPrevias: 2 }).db).primeraCompraProveedor('x')).toEqual({ primeraVez: false });
  });
});
