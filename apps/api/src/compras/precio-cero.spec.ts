import { BadRequestException } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { pendientesPrecioCero, separarValorizaciones, type OcCandidata } from './precio-cero';
import { diferenciaPrecioCero, elegirPendientes, textoPrecioCero } from '../../../admin/app/lib/precio-cero';

// Facturas que ponen precio a lo que entró a $0 (10/10/2026). Caso real: La
// Serenísima entra los quesos a $0 y a la semana manda otra factura con los
// precios; cargada como compra normal, duplicaba el stock.

const SERENISIMA = 'prov-sere';
const HOY = new Date('2026-10-10T15:00:00Z');

const oc = (id: string, creado: string, items: OcCandidata['items'], proveedor = SERENISIMA, numero = 100): OcCandidata => ({
  id, numero, proveedor_id: proveedor, creado_en: creado, items,
});
const QUESO = { producto_id: 'p-queso', cantidad_recibida: 4.2, costo_unitario: 0, producto: { sku: 'Q1', nombre: 'Queso cremoso' } };
const LECHE = { producto_id: 'p-leche', cantidad_recibida: 24, costo_unitario: 950, producto: { sku: 'L1', nombre: 'Leche entera' } };

describe('qué entradas a $0 esperan precio', () => {
  it('solo las de ESE proveedor, con costo 0, de los últimos 45 días', () => {
    const r = pendientesPrecioCero({
      proveedorId: SERENISIMA,
      hoy: HOY,
      ocs: [
        oc('oc-1', '2026-10-03T12:00:00Z', [QUESO, LECHE]),
        oc('oc-vieja', '2026-08-20T12:00:00Z', [{ ...QUESO, producto_id: 'p-q2', producto: { sku: 'Q2', nombre: 'Queso de máquina' } }]), // 51 días
        oc('oc-otro', '2026-10-05T12:00:00Z', [{ ...QUESO, producto_id: 'p-q3', producto: { sku: 'Q3', nombre: 'Queso azul' } }], 'prov-otro'),
      ],
      remitos: [{ oc_id: 'oc-1', numero: '0001-00012345', creado_en: '2026-10-03T12:05:00Z' }],
    });
    expect(r).toEqual([{
      ocId: 'oc-1', ocNumero: 100, productoId: 'p-queso', sku: 'Q1', nombre: 'Queso cremoso', cantidad: 4.2,
      fecha: '2026-10-03', comprobante: { tipo: 'remito', numero: '0001-00012345' },
    }]);
  });

  it('el día 45 todavía entra; el 46 ya no', () => {
    const base = { proveedorId: SERENISIMA, hoy: HOY };
    expect(pendientesPrecioCero({ ...base, ocs: [oc('a', '2026-08-26T16:00:00Z', [QUESO])] })).toHaveLength(1);
    expect(pendientesPrecioCero({ ...base, ocs: [oc('b', '2026-08-25T14:00:00Z', [QUESO])] })).toHaveLength(0);
  });

  it('la fecha que cuenta es la del remito (cuándo entró), no la de la orden', () => {
    const r = pendientesPrecioCero({
      proveedorId: SERENISIMA, hoy: HOY,
      ocs: [oc('oc-1', '2026-08-01T12:00:00Z', [QUESO])],
      remitos: [{ oc_id: 'oc-1', numero: null, creado_en: '2026-10-01T09:00:00Z' }],
    });
    expect(r[0]).toMatchObject({ fecha: '2026-10-01', comprobante: { tipo: 'orden', numero: '100' } });
  });

  it('si la entrada tiene factura, se nombra la factura', () => {
    const r = pendientesPrecioCero({
      proveedorId: SERENISIMA, hoy: HOY,
      ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [QUESO])],
      remitos: [{ oc_id: 'oc-1', numero: '0001-1', creado_en: '2026-10-03T12:00:00Z' }],
      facturas: [{ oc_id: 'oc-1', numero: '0001-1', estado: 'pendiente' }],
    });
    expect(r[0].comprobante).toEqual({ tipo: 'factura', numero: '0001-1' });
  });

  it('una entrada ya valorizada no vuelve a aparecer', () => {
    const base = { proveedorId: SERENISIMA, hoy: HOY, ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [QUESO])] };
    expect(pendientesPrecioCero(base)).toHaveLength(1);
    expect(pendientesPrecioCero({ ...base, valorizadas: [{ oc_id: 'oc-1', producto_id: 'p-queso' }] })).toHaveLength(0);
    // y la valorización le deja costo: tampoco aparece por el costo
    expect(pendientesPrecioCero({ ...base, ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [{ ...QUESO, costo_unitario: 8500 }])] })).toHaveLength(0);
  });

  it('un regalo (el papel traía precio y vino sin cargo) no espera precio', () => {
    const r = pendientesPrecioCero({
      proveedorId: SERENISIMA, hoy: HOY,
      ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [QUESO])],
      remitos: [{ oc_id: 'oc-1', numero: '0001-7', creado_en: '2026-10-03T12:00:00Z' }],
      historial: [{ numero: '0001-7', producto_id: 'p-queso', precio: 9100 }],
    });
    expect(r).toHaveLength(0);
    // con precio 0 en el papel, sí
    expect(pendientesPrecioCero({
      proveedorId: SERENISIMA, hoy: HOY,
      ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [QUESO])],
      remitos: [{ oc_id: 'oc-1', numero: '0001-7', creado_en: '2026-10-03T12:00:00Z' }],
      historial: [{ numero: '0001-7', producto_id: 'p-queso', precio: 0 }],
    })).toHaveLength(1);
  });

  it('nada recibido no espera precio', () => {
    expect(pendientesPrecioCero({ proveedorId: SERENISIMA, hoy: HOY, ocs: [oc('oc-1', '2026-10-03T12:00:00Z', [{ ...QUESO, cantidad_recibida: 0 }])] })).toHaveLength(0);
  });
});

describe('en la pantalla: qué entrada le toca a cada producto de la factura', () => {
  const p = (ocId: string, sku: string, cantidad: number, fecha: string) => ({
    ocId, ocNumero: 1, productoId: `p-${sku}`, sku, nombre: sku, cantidad, fecha, comprobante: { tipo: 'remito' as const, numero: `R-${ocId}` },
  });

  it('una por producto: la de la misma cantidad; si no hay, la más vieja', () => {
    const pend = [p('b', 'Q1', 5, '2026-10-05'), p('a', 'Q1', 4.2, '2026-10-01'), p('c', 'Q1', 3, '2026-10-08')];
    expect(elegirPendientes([{ sku: 'Q1', cantidad: 3 }], pend).Q1.ocId).toBe('c');
    expect(elegirPendientes([{ sku: 'Q1', cantidad: 7 }], pend).Q1.ocId).toBe('a');
    // los renglones del mismo producto se suman antes de comparar
    expect(elegirPendientes([{ sku: 'Q1', cantidad: 2 }, { sku: 'Q1', cantidad: 3 }], pend).Q1.ocId).toBe('b');
  });

  it('un producto que no entró a $0 no se marca', () => {
    expect(elegirPendientes([{ sku: 'L1', cantidad: 24 }], [p('a', 'Q1', 4, '2026-10-01')])).toEqual({});
  });

  it('el texto del renglón y la diferencia de cantidad', () => {
    const x = p('a', 'Q1', 4.2, '2026-10-03');
    expect(textoPrecioCero(x)).toBe('Entró a $0 el 03/10 (remito N° R-a): solo precio, no suma stock');
    expect(diferenciaPrecioCero(x, 4.2)).toBeNull();
    expect(diferenciaPrecioCero(x, 4.35)).toMatch(/Entraron 4,2 y la factura dice 4,35: queda anotado, el stock no se toca/);
  });
});

// ---------- al guardar ----------

type Resp = { data?: any; error?: any };
function dbFalsa(opts: { tablas?: Record<string, Resp>; rpc?: Record<string, Resp> } = {}) {
  const ops: any[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla, accion: 'select', filtros: [] as any[] };
      ops.push(op);
      const r = (modo: 'uno' | 'lista') => {
        const t = opts.tablas ?? {};
        const v = t[`${tabla}:${op.accion}`] ?? t[tabla];
        const data = typeof v?.data === 'function' ? v.data(op) : v?.data;
        return Promise.resolve({ data: data ?? (modo === 'lista' ? [] : null), error: v?.error ?? null });
      };
      const q: any = {
        select: (s?: string) => { if (op.accion === 'select') op.select = s; return q; },
        insert: (v: any) => { op.accion = 'insert'; op.valores = v; return q; },
        update: (v: any) => { op.accion = 'update'; op.valores = v; return q; },
        upsert: (v: any) => { op.accion = 'upsert'; op.valores = v; return q; },
        eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
        in: (c: string, v: any) => { op.filtros.push(['in', c, v]); return q; },
        gte: (c: string, v: any) => { op.filtros.push(['gte', c, v]); return q; },
        is: () => q, gt: () => q, order: () => q, limit: () => q,
        maybeSingle: () => r('uno'), single: () => r('uno'),
        then: (ok: any, mal: any) => r('lista').then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      ops.push({ rpc: nombre, args });
      const v = opts.rpc?.[nombre];
      return Promise.resolve({ data: v?.data ?? null, error: v?.error ?? null });
    }),
  };
  return { db, ops };
}

// productos: el id sale del sku (productoIdPorSku usa .eq('sku', …))
const productos = {
  productos: { data: (op: any) => {
    const sku = op.filtros.find((f: any) => f[0] === 'eq' && f[1] === 'sku')?.[2];
    return sku ? { id: `p-${sku}` } : [];
  } },
};

describe('registrar una factura con renglones «solo precio»', () => {
  const base = { proveedorId: SERENISIMA, sucursalId: 's-1', numeroRemito: '0001-00099', usuarioId: 'u-ana' };

  it('los tildados no van a la entrada (no suman stock) y le ponen el costo a su entrada a $0', async () => {
    const { db, ops } = dbFalsa({
      tablas: { ...productos, 'facturas_proveedor:insert': { data: { id: 'fac-2' } } },
      rpc: { recibir_compra_valorizando: { data: { oc_id: 'oc-new', remito_id: 'rem-new', valorizados: 1, valorizacion_ids: ['v-1'] } } },
    });
    const r = await new ComprasService(db).entradaDirecta({
      ...base,
      items: [
        { sku: 'Q1', cantidad: 4.35, costo: 8500, valorizaOc: 'oc-1', descripcionLeida: 'QUESO CREMOSO' },
        { sku: 'L1', cantidad: 24, costo: 950 },
      ],
      factura: { numero: '0001-00099', total: 60000 },
    });
    expect(r.valorizados).toBe(1);
    const llamada = ops.find((o) => o.rpc === 'recibir_compra_valorizando');
    // a la entrada (stock) solo va la leche
    expect(llamada.args.p_items).toEqual([{ producto_id: 'p-L1', cantidad: 24, costo_unitario: 950, lote: null, vencimiento: null }]);
    // el queso le pone precio a la entrada del 03/10, con la cantidad de la factura (la diferencia la anota la base)
    expect(llamada.args.p_valorizar).toEqual([{ oc_id: 'oc-1', producto_id: 'p-Q1', cantidad: 4.35, costo_unitario: 8500 }]);
    // y remarca como una compra: el queso también va a la regla de oro
    expect(llamada.args.p_items_precio.map((x: any) => x.sku).sort()).toEqual(['L1', 'Q1']);
    expect(ops.some((o) => o.rpc === 'recibir_compra_directa')).toBe(false);
    // la factura se registra igual (libro IVA, deuda) y queda en la valorización
    expect(ops.find((o) => o.tabla === 'facturas_proveedor' && o.accion === 'insert').valores).toMatchObject({ numero: '0001-00099', monto: 60000, oc_id: 'oc-new' });
    const vinculo = ops.find((o) => o.tabla === 'valorizaciones_precio_cero' && o.accion === 'update');
    expect(vinculo.valores).toEqual({ factura_id: 'fac-2' });
    expect(vinculo.filtros).toContainEqual(['in', 'id', ['v-1']]);
  });

  it('toda la factura «solo precio»: no entra nada al stock', async () => {
    const { db, ops } = dbFalsa({ tablas: productos, rpc: { recibir_compra_valorizando: { data: { oc_id: 'oc-1', remito_id: 'rem-1' } } } });
    await new ComprasService(db).entradaDirecta({ ...base, items: [{ sku: 'Q1', cantidad: 4.2, costo: 8500, valorizaOc: 'oc-1' }] });
    const llamada = ops.find((o) => o.rpc === 'recibir_compra_valorizando');
    expect(llamada.args.p_items).toEqual([]);
    expect(llamada.args.p_valorizar).toHaveLength(1);
  });

  it('destildado entra como compra normal (la entrada de siempre, sin cambios)', async () => {
    const { db, ops } = dbFalsa({ tablas: productos, rpc: { recibir_compra_directa: { data: { oc_id: 'oc-new', remito_id: 'rem-new' } } } });
    await new ComprasService(db).entradaDirecta({ ...base, items: [{ sku: 'Q1', cantidad: 4.2, costo: 8500 }, { sku: 'L1', cantidad: 24, costo: 950 }] });
    expect(ops.some((o) => o.rpc === 'recibir_compra_valorizando')).toBe(false);
    const llamada = ops.find((o) => o.rpc === 'recibir_compra_directa');
    expect(Object.keys(llamada.args).sort()).toEqual(['p_items', 'p_items_precio', 'p_numero_remito', 'p_proveedor', 'p_sucursal', 'p_usuario']);
    expect(llamada.args.p_items.map((i: any) => i.producto_id)).toEqual(['p-Q1', 'p-L1']);
  });

  it('sin costo no se puede poner precio', async () => {
    const { db } = dbFalsa({ tablas: productos });
    await expect(new ComprasService(db).entradaDirecta({ ...base, items: [{ sku: 'Q1', cantidad: 4.2, costo: 0, valorizaOc: 'oc-1', descripcionLeida: 'QUESO' }] }))
      .rejects.toThrow(/QUESO: para ponerle precio a lo que entró a \$0 hace falta el costo/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('si la base dice que ya tiene precio, el error llega entero', async () => {
    const { db } = dbFalsa({ tablas: productos, rpc: { recibir_compra_valorizando: { error: { message: 'La entrada a $0 de Queso cremoso ya tiene precio: volvé a abrir la factura' } } } });
    await expect(new ComprasService(db).entradaDirecta({ ...base, items: [{ sku: 'Q1', cantidad: 4.2, costo: 8500, valorizaOc: 'oc-1' }] }))
      .rejects.toThrow(BadRequestException);
  });

  it('separarValorizaciones: solo los que traen la orden', () => {
    const { normales, valorizar } = separarValorizaciones([{ sku: 'A', valorizaOc: 'oc-1' }, { sku: 'B' }, { sku: 'C', valorizaOc: ' ' }]);
    expect(valorizar.map((x) => x.sku)).toEqual(['A']);
    expect(normales.map((x) => x.sku)).toEqual(['B', 'C']);
  });
});

describe('la consulta de pendientes', () => {
  it('filtra por proveedor y órdenes recibidas, y descarta lo ya valorizado', async () => {
    const { db, ops } = dbFalsa({
      tablas: {
        ordenes_compra: { data: [oc('oc-1', new Date(Date.now() - 3 * 86_400_000).toISOString(), [QUESO, { ...QUESO, producto_id: 'p-q2', producto: { sku: 'Q2', nombre: 'Otro' } }, LECHE])] },
        valorizaciones_precio_cero: { data: [{ oc_id: 'oc-1', producto_id: 'p-q2' }] },
      },
    });
    const r = await new ComprasService(db).pendientesPrecioCero('00000000-0000-0000-0000-00000000abcd');
    expect(r.map((x) => x.sku)).toEqual([]); // la orden es de La Serenísima, no de este proveedor
    const consulta = ops.find((o) => o.tabla === 'ordenes_compra');
    expect(consulta.filtros).toContainEqual(['eq', 'proveedor_id', '00000000-0000-0000-0000-00000000abcd']);
    expect(consulta.filtros).toContainEqual(['in', 'estado', ['recibida', 'recibida_parcial']]);

    const prov = '00000000-0000-0000-0000-000000005e5e';
    const { db: db2 } = dbFalsa({
      tablas: {
        ordenes_compra: { data: [oc('oc-1', new Date(Date.now() - 3 * 86_400_000).toISOString(), [QUESO, { ...QUESO, producto_id: 'p-q2', producto: { sku: 'Q2', nombre: 'Otro' } }, LECHE], prov)] },
        valorizaciones_precio_cero: { data: [{ oc_id: 'oc-1', producto_id: 'p-q2' }] },
      },
    });
    expect((await new ComprasService(db2).pendientesPrecioCero(prov)).map((x) => x.sku)).toEqual(['Q1']);
  });

  it('sin la migración aplicada no ofrece nada (la carga sigue como antes)', async () => {
    const prov = '00000000-0000-0000-0000-000000005e5e';
    const { db } = dbFalsa({
      tablas: {
        ordenes_compra: { data: [oc('oc-1', new Date().toISOString(), [QUESO], prov)] },
        valorizaciones_precio_cero: { error: { message: 'relation "valorizaciones_precio_cero" does not exist' } },
      },
    });
    await expect(new ComprasService(db).pendientesPrecioCero(prov)).resolves.toEqual([]);
  });
});
