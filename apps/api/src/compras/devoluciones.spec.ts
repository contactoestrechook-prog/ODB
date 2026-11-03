// DEVOLUCIONES AL PROVEEDOR (3/11/2026). Leandro: «no estamos logrando leer las
// facturas, ítems de devoluciones y descuentos». Hasta hoy todo renglón en
// negativo era un descuento: la devolución rebajaba el costo del renglón de
// arriba y lo devuelto nunca salía del stock.
import { esRenglonDeDescuento, esRenglonDeDevolucion } from './bultos';
import { ComprasService } from './compras.service';
import { aplicarCambiosIA, marcarComoDevolucion, papelDeLectura, tablaParaIA } from '../../../admin/app/lib/tabla-factura';
import { atribuirDescuentos, esRenglonDescuento } from '../../../admin/app/lib/descuentos-compras';
import { repartirIva } from '../../../admin/app/lib/iva-compras';

describe('qué es una devolución y qué es un descuento', () => {
  it('la cantidad en negativo es mercadería que vuelve', () => {
    const r = { descripcion: 'COCA COLA 2.25L X6', cantidad: -2, precio: 9000, importe: -18000 };
    expect(esRenglonDeDevolucion(r)).toBe(true);
    expect(esRenglonDeDescuento(r)).toBe(false);
  });

  it('lo dice el texto: «DEV.», «Devolución», «Rechazo»', () => {
    expect(esRenglonDeDevolucion({ descripcion: 'DEV. FERNET BRANCA 750', cantidad: 1, precio: -12500 })).toBe(true);
    expect(esRenglonDeDevolucion({ descripcion: 'Devolución yogur vencido', cantidad: 3, importe: -4500 })).toBe(true);
    expect(esRenglonDeDevolucion({ descripcion: 'RECHAZO QUESO CREMOSO', cantidad: 1, precio: -8000 })).toBe(true);
  });

  it('una rebaja sigue siendo rebaja: «Desc.», «Bonif.» o un %', () => {
    expect(esRenglonDeDevolucion({ descripcion: 'Desc. 42.86% - MANOS NEGRAS Malbec CJ x6', cantidad: 1, precio: -22630 })).toBe(false);
    expect(esRenglonDeDevolucion({ descripcion: 'Px mágico $12.000 MP = 17.2%', cantidad: -1, precio: 12000 })).toBe(false);
    expect(esRenglonDeDevolucion({ descripcion: 'Bonificación s/ item 4', cantidad: 1, precio: -500 })).toBe(false);
    expect(esRenglonDeDescuento({ descripcion: 'Descuento', precio: -500 })).toBe(true);
  });

  it('sin nada en negativo no hay devolución, aunque el texto diga DEV', () => {
    expect(esRenglonDeDevolucion({ descripcion: 'DEV. FERNET BRANCA 750', cantidad: 1, precio: 12500, importe: 12500 })).toBe(false);
    // y un negativo sin la palabra ni la cantidad en negativo sigue siendo descuento
    expect(esRenglonDeDevolucion({ descripcion: 'Ajuste comercial', cantidad: 1, precio: -300 })).toBe(false);
  });
});

describe('en la pantalla: la devolución no rebaja a nadie y resta en el pie', () => {
  it('una devolución no es destino de un descuento: el regalo va a la mercadería de arriba', () => {
    const items = [
      { descripcion: 'FERNET 750', cantidad: 2, precio: 12000, importe: 24000 },
      { descripcion: 'COCA 2.25', cantidad: 1, precio: 3000, importe: 3000, esDevolucion: true },
      { descripcion: 'Bonificación', cantidad: 1, precio: -24000, importe: -24000, esDescuento: true },
    ];
    expect(esRenglonDescuento(items[1])).toBe(false);
    const a = atribuirDescuentos(items);
    expect(a.destinos.get(2)).toEqual({ renglon: 0, motivo: 'regalo' });
    expect(a.porIdx.has(1)).toBe(false);
  });

  it('la rebaja de una devolución la achica: la nombra, o viene en positivo justo debajo', () => {
    const fernet = { descripcion: 'FERNET 750', cantidad: 2, precio: 12000, importe: 24000 };
    const dev = { descripcion: 'DEV COCA 2.25', cantidad: 6, precio: 3000, importe: 18000, esDevolucion: true };
    // en positivo, justo debajo (el descuento sobre algo que resta, suma)
    const a = atribuirDescuentos([fernet, dev, { descripcion: 'Desc. 10%', cantidad: 1, precio: 1800, importe: 1800, esDescuento: true, descuentoPct: 10 }]);
    expect(a.destinos.get(2)).toEqual({ renglon: 1, motivo: 'devolucion' });
    expect(a.porIdx.get(1)).toBe(1800);
    expect(a.porIdx.has(0)).toBe(false);
    expect(a.sinAtribuir).toEqual([]);
    // la nombra, aunque venga impresa en negativo y con la mercadería en el medio
    const b = atribuirDescuentos([dev, fernet, { descripcion: 'Desc. 10% s/ DEV COCA 2.25', cantidad: 1, precio: -1800, importe: -1800, esDescuento: true, descuentoPct: 10 }]);
    expect(b.destinos.get(2)).toEqual({ renglon: 0, motivo: 'devolucion' });
    expect(b.porIdx.get(0)).toBe(1800);
    expect(b.porIdx.has(1)).toBe(false);
  });

  it('una rebaja en negativo debajo de la mercadería sigue yendo a la mercadería', () => {
    const dev = { descripcion: 'DEV COCA 2.25', cantidad: 6, precio: 3000, importe: 18000, esDevolucion: true };
    const a = atribuirDescuentos([dev, { descripcion: 'FERNET 750', cantidad: 2, precio: 12000, importe: 24000 }, { descripcion: 'Descuento', cantidad: 1, precio: -24000, importe: -24000, esDescuento: true }]);
    expect(a.destinos.get(2)).toEqual({ renglon: 1, motivo: 'regalo' });
    // una rebaja en positivo que no cierra con la devolución no se le pega
    const b = atribuirDescuentos([{ descripcion: 'FERNET 750', cantidad: 2, precio: 12000, importe: 24000 }, dev, { descripcion: 'Desc.', cantidad: 1, precio: 50000, importe: 50000, esDescuento: true }]);
    expect(b.destinos.has(2)).toBe(false);
  });

  it('el IVA cierra con la devolución adentro en negativo, y el costo de lo que entra no se infla', () => {
    // mercadería $10.000 al 21 %, devolución $2.000 al 21 %: el pie dice neto 8.000 e IVA 1.680
    const r = repartirIva(
      [{ neto: 10000, alicuotaImpresa: 21 }, { neto: -2000, alicuotaImpresa: 21 }],
      { neto: 8000, iva: 1680, percepcionesAlCosto: 0, impuestosInternos: 0 },
    );
    expect(r.estado).toBe('cierra');
    if (r.estado === 'cierra') expect(r.factorNeto).toBeCloseTo(1, 6);
  });

  it('marcar y desmarcar: vuelve exactamente a como estaba (era un descuento)', () => {
    const rebaja = { descripcion: 'DEV FERNET', cantidad: 1, precio: -12500, importe: -12500, esDescuento: true, sku: 'F1', incluir: false };
    const dev = marcarComoDevolucion(rebaja, true);
    expect(dev).toMatchObject({ esDevolucion: true, esDescuento: false, cantidad: 1, precio: 12500, importe: 12500, papel: null, incluir: true });
    const vuelta = marcarComoDevolucion(dev, false);
    expect(vuelta).toMatchObject({ esDevolucion: false, esDescuento: true, precio: -12500, importe: -12500, incluir: false });
    expect('_antesDeDevolucion' in vuelta).toBe(false);
  });

  it('una devolución sin producto vinculado no se resta (no hay qué restar)', () => {
    expect(marcarComoDevolucion({ descripcion: 'DEV ENVASES', cantidad: -12, precio: 150 }, true)).toMatchObject({ cantidad: 12, precio: 150, importe: 1800, incluir: false });
  });
});

describe('el chat de la factura y las devoluciones', () => {
  const items = [
    { descripcion: 'FERNET 750', cantidad: 2, precio: 12000, importe: 24000, sku: 'F1', incluir: true },
    { descripcion: 'DEV COCA 2.25', cantidad: 1, precio: -3000, importe: -3000, esDescuento: true, sku: 'C1', nombre: 'Coca 2,25', incluir: false },
  ];
  const esDesc = (f: any) => esRenglonDescuento(f);

  it('«esto es una devolución»: el chat la marca, y después cambia cuántas salen', () => {
    const r1 = aplicarCambiosIA(items, [{ renglon: 2, campo: 'esDevolucion', valor: true, motivo: 'el papel dice DEV' }], esDesc);
    expect(r1.items[1]).toMatchObject({ esDevolucion: true, incluir: true, precio: 3000 });
    expect(r1.registros).toEqual([{ renglon: 2, campo: 'esDevolucion', antes: false, despues: true, motivo: 'el papel dice DEV' }]);
    const r2 = aplicarCambiosIA(r1.items, [{ renglon: 2, campo: 'unidadesDevueltas', valor: 6, motivo: 'son 6 botellas' }, { renglon: 2, campo: 'precio', valor: 1 }], esDesc);
    expect(r2.items[1].cantidad).toBe(6);
    // la plata de una devolución no se toca desde el chat
    expect(r2.descartados).toEqual([{ renglon: 2, campo: 'precio', valor: 1 }]);
    const r3 = aplicarCambiosIA(r2.items, [{ renglon: 2, campo: 'ingresa', valor: false, motivo: 'no la llevamos todavía' }], esDesc);
    expect(r3.items[1].incluir).toBe(false);
  });

  it('la tabla que ve la IA la muestra como devolución', () => {
    const fila = marcarComoDevolucion(items[1], true);
    expect(tablaParaIA([items[0], fila].map((x: any) => (x.esDevolucion ? x : { ...x, papel: papelDeLectura(x) })), esDesc, () => null)[1])
      .toEqual({ renglon: 2, devolucion: true, codigo: null, descripcion: 'DEV COCA 2.25', producto: 'Coca 2,25', unidadesQueSalen: 1, precio: 3000, importeDevuelto: 3000, restaDelStock: true });
  });
});

describe('al registrar: lo devuelto sale del stock', () => {
  function dbFalsa(sinStock: string[] = []) {
    const ops: any[] = [];
    const db: any = {
      from: jest.fn((tabla: string) => {
        const op: any = { tabla, filtros: [] as any[] };
        ops.push(op);
        const r = () => {
          const sku = op.filtros.find((f: any) => f[1] === 'sku')?.[2];
          const data = tabla === 'productos' && sku ? { id: `p-${sku}` } : tabla === 'proveedores' ? { razon_social: 'DISTRI SUR' } : null;
          return Promise.resolve({ data, error: null });
        };
        const q: any = {
          select: () => q, insert: () => q, update: () => q, upsert: () => q,
          eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
          in: () => q, is: () => q, gt: () => q, gte: () => q, order: () => q, limit: () => q,
          maybeSingle: r, single: r,
          then: (ok: any, mal: any) => Promise.resolve({ data: [], error: null }).then(ok, mal),
        };
        return q;
      }),
      rpc: jest.fn((nombre: string, args: any) => {
        ops.push({ rpc: nombre, args });
        if (nombre === 'recibir_compra_directa') return Promise.resolve({ data: { oc_id: 'oc-9', remito_id: 'rem-9' }, error: null });
        if (nombre === 'registrar_movimiento' && sinStock.includes(args.p_producto_id)) {
          return Promise.resolve({ data: null, error: { message: 'Stock insuficiente: la operación dejaría -2 unidades' } });
        }
        return Promise.resolve({ data: 1, error: null });
      }),
    };
    return { db, ops };
  }
  const base = { proveedorId: 'prov-1', sucursalId: 's-1', numeroRemito: '0003-00012345', usuarioId: 'u-ana', items: [{ sku: 'F1', cantidad: 2, costo: 14520 }] };

  it('cada devolución es un ajuste en negativo con su motivo; la entrada va igual', async () => {
    const { db, ops } = dbFalsa();
    const r: any = await new ComprasService(db).entradaDirecta({ ...base, devoluciones: [{ sku: 'C1', cantidad: 6, descripcionLeida: 'DEV COCA' }, { sku: 'C1', cantidad: 1 }] });
    expect(ops.some((o) => o.rpc === 'recibir_compra_directa')).toBe(true);
    const movs = ops.filter((o) => o.rpc === 'registrar_movimiento');
    // el mismo producto en dos renglones sale una sola vez, sumado
    expect(movs).toHaveLength(1);
    expect(movs[0].args).toMatchObject({
      p_producto_id: 'p-C1', p_sucursal_id: 's-1', p_tipo: 'ajuste', p_cantidad: -7,
      p_motivo: 'Devolución al proveedor a DISTRI SUR · comprobante 0003-00012345',
      p_referencia_tipo: 'devolucion_proveedor', p_referencia_id: 'oc-9', p_usuario_id: 'u-ana',
    });
    expect(r.devoluciones).toEqual({ restadas: [{ sku: 'C1', cantidad: 7 }], sinRestar: [] });
  });

  it('sin stock suficiente: la entrada no se pierde y la devolución vuelve nombrada', async () => {
    const { db } = dbFalsa(['p-C1']);
    const r: any = await new ComprasService(db).entradaDirecta({ ...base, devoluciones: [{ sku: 'C1', cantidad: 3 }, { sku: 'Y1', cantidad: 1 }] });
    expect(r.devoluciones.restadas).toEqual([{ sku: 'Y1', cantidad: 1 }]);
    expect(r.devoluciones.sinRestar).toEqual([{ sku: 'C1', cantidad: 3, motivo: expect.stringMatching(/Stock insuficiente/) }]);
  });

  it('una devolución sin producto o sin unidades frena antes de tocar la base', async () => {
    const { db, ops } = dbFalsa();
    await expect(new ComprasService(db).entradaDirecta({ ...base, devoluciones: [{ sku: '', cantidad: 2, descripcionLeida: 'DEV ENVASES' }] }))
      .rejects.toThrow(/DEV ENVASES: falta elegir qué producto se devuelve/);
    await expect(new ComprasService(db).entradaDirecta({ ...base, devoluciones: [{ sku: 'C1', cantidad: 0 }] }))
      .rejects.toThrow(/las unidades devueltas tienen que ser un número mayor a cero/);
    expect(ops.some((o) => o.rpc)).toBe(false);
  });
});
