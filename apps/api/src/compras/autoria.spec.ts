import { BadRequestException } from '@nestjs/common';
import { ComprasService } from './compras.service';

// Autoría de los circuitos de compras (6/10/2026):
//  - el rechazo de una OC o una OP queda con su propio autor (rechazada_por /
//    rechazada_en, vía RPC) y no en las columnas de la aprobación;
//  - la OP solo se rechaza pendiente (lo valida la RPC) y deja auditoría;
//  - la pistola puede recibir CONTRA una orden enviada en vez de crear otra.

type Resp = { data?: any; error?: any };

function dbFalsa(opts: { tablas?: Record<string, Resp>; rpc?: Record<string, Resp> } = {}) {
  const ops: any[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla, accion: 'select', filtros: [] as any[] };
      ops.push(op);
      // 'uno' = maybeSingle/single; 'lista' = await directo
      const r = (modo: 'uno' | 'lista') => {
        const t = opts.tablas ?? {};
        const v = t[`${tabla}:${modo}`] ?? t[`${tabla}:${op.accion}`] ?? t[tabla];
        return Promise.resolve({ data: v?.data ?? (modo === 'lista' ? [] : null), error: v?.error ?? null });
      };
      const q: any = {
        select: (s?: string) => { if (op.accion === 'select') op.select = s; return q; },
        insert: (v: any) => { op.accion = 'insert'; op.valores = v; return q; },
        update: (v: any) => { op.accion = 'update'; op.valores = v; return q; },
        upsert: (v: any) => { op.accion = 'upsert'; op.valores = v; return q; },
        eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
        in: (c: string, v: any) => { op.filtros.push(['in', c, v]); return q; },
        is: (c: string, v: any) => { op.filtros.push(['is', c, v]); return q; },
        gt: () => q, gte: () => q, order: () => q, limit: () => q,
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

describe('rechazo de una orden de compra', () => {
  it('va por rechazar_oc_panel con quién rechaza y el motivo, sin tocar las columnas de la aprobación', async () => {
    const { db, ops } = dbFalsa();
    const svc = new ComprasService(db);
    await expect(svc.rechazar('oc-1', { usuarioId: 'u-jp', motivo: '  precio viejo ' })).resolves.toEqual({ rechazada: true });
    expect(ops).toContainEqual({ rpc: 'rechazar_oc_panel', args: { p_oc: 'oc-1', p_usuario: 'u-jp', p_motivo: 'precio viejo' } });
    // nada de update directo con aprobada_por / aprobada_en
    expect(ops.some((o) => o.accion === 'update' && ('aprobada_por' in (o.valores ?? {}) || 'aprobada_en' in (o.valores ?? {})))).toBe(false);
  });

  it('sin quién rechaza no hay rechazo', async () => {
    const { db } = dbFalsa();
    await expect(new ComprasService(db).rechazar('oc-1', { motivo: 'x' })).rejects.toThrow(BadRequestException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('si la orden ya no está a aprobar, el error de la base llega entero', async () => {
    const { db } = dbFalsa({ rpc: { rechazar_oc_panel: { error: { message: 'No se puede rechazar una orden "enviada"' } } } });
    await expect(new ComprasService(db).rechazar('oc-1', { usuarioId: 'u-jp' })).rejects.toThrow(/"enviada"/);
  });
});

describe('rechazo de una orden de pago', () => {
  it('va por rechazar_op_panel (valida pendiente, libera facturas y audita) con el autor real', async () => {
    const { db, ops } = dbFalsa({ rpc: { rechazar_op_panel: { data: { numero: 12, facturas: 2 } } } });
    const r = await new ComprasService(db).rechazarOrdenPago('op-1', { usuarioId: 'u-jp', motivo: 'duplicada' });
    expect(r).toEqual({ rechazada: true, facturasLiberadas: 2 });
    expect(ops).toContainEqual({ rpc: 'rechazar_op_panel', args: { p_op: 'op-1', p_usuario: 'u-jp', p_motivo: 'duplicada' } });
    expect(ops.some((o) => o.tabla === 'ordenes_pago' && o.accion === 'update')).toBe(false);
  });

  it('una OP ya aprobada no se rechaza: se ve el motivo', async () => {
    const { db } = dbFalsa({ rpc: { rechazar_op_panel: { error: { message: 'La OP #12 está "aprobada": solo se rechaza una orden pendiente de aprobación' } } } });
    await expect(new ComprasService(db).rechazarOrdenPago('op-1', { usuarioId: 'u-jp' })).rejects.toThrow(/solo se rechaza una orden pendiente/);
  });

  it('sin quién rechaza no hay rechazo', async () => {
    const { db } = dbFalsa();
    await expect(new ComprasService(db).rechazarOrdenPago('op-1', {})).rejects.toThrow(BadRequestException);
  });
});

describe('recepción con pistola contra una orden', () => {
  const productos = { 'productos:uno': { data: { id: 'prod-x' } } };

  it('con ocId cierra ESA orden (recibir_oc_pistola) y no crea otra directa', async () => {
    const { db, ops } = dbFalsa({
      tablas: productos,
      rpc: { recibir_oc_pistola: { data: { oc_id: 'oc-9', numero: 9, estado: 'recibida', remito_id: 'rem-1' } } },
    });
    const r = await new ComprasService(db).recepcionPistola({
      proveedorId: 'prov-1', sucursalId: 's-1', ocId: 'oc-9', numeroRemito: ' R-55 ',
      items: [{ sku: 'A', cantidad: 2 }, { sku: 'A', cantidad: 1 }],
      usuarioId: 'u-dep',
    });
    expect(r).toEqual({ ok: true, remitoId: 'rem-1', ocId: 'oc-9', numeroOc: 9, estadoOc: 'recibida' });
    const llamada = ops.find((o) => o.rpc === 'recibir_oc_pistola');
    expect(llamada.args).toEqual({
      p_oc: 'oc-9', p_proveedor: 'prov-1', p_numero_remito: 'R-55', p_usuario: 'u-dep',
      // el mismo producto escaneado dos veces va en un solo renglón
      p_items: [{ producto_id: 'prod-x', cantidad: 3 }],
    });
    expect(ops.some((o) => o.rpc === 'recibir_compra_directa')).toBe(false);
  });

  it('lo que no coincide con la orden lo explica la base y no entra nada', async () => {
    const { db } = dbFalsa({
      tablas: productos,
      rpc: { recibir_oc_pistola: { error: { message: 'No coincide con la orden #9: Fernet 750 no está en la orden.' } } },
    });
    await expect(
      new ComprasService(db).recepcionPistola({ proveedorId: 'prov-1', sucursalId: 's-1', ocId: 'oc-9', items: [{ sku: 'A', cantidad: 1 }], usuarioId: 'u-dep' }),
    ).rejects.toThrow(/no está en la orden/);
  });

  it('sin quién recibe o con cantidades inválidas no se llama a la base', async () => {
    const { db } = dbFalsa({ tablas: productos });
    const svc = new ComprasService(db);
    await expect(svc.recepcionPistola({ proveedorId: 'p', sucursalId: 's', ocId: 'oc', items: [{ sku: 'A', cantidad: 1 }] })).rejects.toThrow(/quién recibe/);
    await expect(svc.recepcionPistola({ proveedorId: 'p', sucursalId: 's', ocId: 'oc', items: [{ sku: 'A', cantidad: 0 }], usuarioId: 'u' })).rejects.toThrow(/cantidad inválida/);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('sin ocId sigue siendo la entrada sin orden de siempre', async () => {
    const { db, ops } = dbFalsa({
      tablas: productos,
      rpc: { recibir_compra_directa: { data: { oc_id: 'oc-dir', remito_id: 'rem-dir' } } },
    });
    const r = await new ComprasService(db).recepcionPistola({ proveedorId: 'prov-1', sucursalId: 's-1', items: [{ sku: 'A', cantidad: 1 }], usuarioId: 'u-dep' });
    expect(r).toEqual({ ok: true, remitoId: 'rem-dir', ocId: 'oc-dir' });
    expect(ops.some((o) => o.rpc === 'recibir_oc_pistola')).toBe(false);
  });

  it('ordenesParaRecibir: solo las que esperan mercadería, con lo que falta de cada renglón', async () => {
    const { db, ops } = dbFalsa({
      tablas: {
        ordenes_compra: {
          data: [
            { id: 'oc-1', numero: 1, estado: 'enviada', creado_en: '2026-10-01', enviada_en: '2026-10-01', sucursal_id: 's-1', sucursal: { nombre: 'Saint Thomas' },
              items: [{ cantidad: 10, cantidad_recibida: 4, producto: { sku: 'A', nombre: 'Fernet' } }, { cantidad: 6, cantidad_recibida: 6, producto: { sku: 'B', nombre: 'Coca' } }] },
            // ya llegó todo: no se ofrece
            { id: 'oc-2', numero: 2, estado: 'recibida_parcial', creado_en: '2026-09-20', sucursal_id: 's-1', sucursal: null,
              items: [{ cantidad: 3, cantidad_recibida: 3, producto: { sku: 'C', nombre: 'Gin' } }] },
          ],
        },
      },
    });
    const r = await new ComprasService(db).ordenesParaRecibir('prov-1');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'oc-1', numero: 1, sucursalId: 's-1', sucursal: 'Saint Thomas' });
    expect(r[0].items).toEqual([
      { sku: 'A', nombre: 'Fernet', pedido: 10, recibido: 4, falta: 6 },
      { sku: 'B', nombre: 'Coca', pedido: 6, recibido: 6, falta: 0 },
    ]);
    const consulta = ops.find((o) => o.tabla === 'ordenes_compra');
    expect(consulta.filtros).toContainEqual(['eq', 'proveedor_id', 'prov-1']);
    expect(consulta.filtros).toContainEqual(['in', 'estado', ['enviada', 'aprobada', 'recibida_parcial']]);
  });
});
