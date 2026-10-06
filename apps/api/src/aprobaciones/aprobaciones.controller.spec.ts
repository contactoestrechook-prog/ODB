import { AprobacionesController } from './aprobaciones.controller';
import { CobranzasController } from '../clientes/cobranzas.controller';

// La bandeja de Aprobaciones (6/10/2026):
//  - las órdenes de pago nacen 'pendiente_aprobacion' y la bandeja las buscaba
//    como 'pendiente': no aparecía ninguna, ni en la lista ni en el contador;
//  - un cobro a cuenta aprobado o rechazado le avisa a quien lo cargó, desde
//    la bandeja y desde Clientes → Cobros a ingresar (antes solo el rechazo de
//    Cobranzas avisaba).

type Resp = { data?: any; error?: any };

function dbFalsa(opts: { tablas?: Record<string, Resp>; rpc?: Record<string, Resp> } = {}) {
  const ops: any[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla, accion: 'select', filtros: [] as any[] };
      ops.push(op);
      const r = (modo: 'uno' | 'lista') => {
        const t = opts.tablas ?? {};
        const v = t[`${tabla}:${op.accion}`] ?? t[`${tabla}:${modo}`] ?? t[tabla];
        return Promise.resolve({ data: v?.data ?? (modo === 'lista' ? [] : null), error: v?.error ?? null });
      };
      const q: any = {
        select: (s?: string) => { if (op.accion === 'select') op.select = s; return q; },
        insert: (v: any) => { op.accion = 'insert'; op.valores = v; return q; },
        update: (v: any) => { op.accion = 'update'; op.valores = v; return q; },
        eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
        in: (c: string, v: any) => { op.filtros.push(['in', c, v]); return q; },
        order: () => q, limit: () => q,
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
  const avisos = () => ops.filter((o) => o.tabla === 'alertas_internas' && o.accion === 'insert').map((o) => o.valores);
  return { db, ops, avisos };
}

const servicios = () => ({
  compras: { aprobarOrdenPago: jest.fn().mockResolvedValue({ aprobada: true }), rechazarOrdenPago: jest.fn().mockResolvedValue({ rechazada: true }) } as any,
  mesa: {} as any,
  ventas: { devolucionesPendientes: jest.fn().mockResolvedValue([]) } as any,
  pedidos: {} as any,
});

const controlador = (db: any, s = servicios()) => new AprobacionesController(db, s.compras, s.mesa, s.ventas, s.pedidos);
const req = { usuario: { sub: 'u-jp', rol: 'dueno' } };

describe('bandeja de aprobaciones: órdenes de pago', () => {
  it('busca las OP en pendiente_aprobacion (como nacen) y las cuenta', async () => {
    const { db, ops } = dbFalsa({
      tablas: {
        ordenes_pago: { data: [{ id: 'op-1', numero: 12, total: 50000, medio_pago: 'transferencia', vencimiento: null, creado_en: new Date().toISOString(), proveedor: { razon_social: 'Sur' }, autor: { nombre: 'Mara' } }] },
      },
    });
    const r = await controlador(db).pendientes();
    const consulta = ops.find((o) => o.tabla === 'ordenes_pago');
    expect(consulta.filtros).toContainEqual(['eq', 'estado', 'pendiente_aprobacion']);
    expect(consulta.filtros).not.toContainEqual(['eq', 'estado', 'pendiente']);
    expect(r.items).toEqual([expect.objectContaining({ tipo: 'orden_pago', id: 'op-1', titulo: 'OP #12 · Sur', monto: 50000, pidio: 'Mara' })]);
    expect(r.porTipo).toEqual({ orden_pago: 1 });
    expect(r.total).toBe(1);
  });

  it('firmar y rechazar una OP desde la bandeja van al circuito de compras con el firmante del token', async () => {
    const { db } = dbFalsa();
    const s = servicios();
    const c = controlador(db, s);
    await c.resolver('orden_pago', 'op-1', 'aprobar', {}, req);
    expect(s.compras.aprobarOrdenPago).toHaveBeenCalledWith('op-1', { usuarioId: 'u-jp' });
    await c.resolver('orden_pago', 'op-1', 'rechazar', { motivo: ' duplicada ' }, req);
    expect(s.compras.rechazarOrdenPago).toHaveBeenCalledWith('op-1', { usuarioId: 'u-jp', motivo: 'duplicada' });
  });
});

describe('cobro a cuenta: aviso a quien lo cargó, en los dos caminos', () => {
  const cobro = { estado: 'pendiente', cargada_por: 'u-caja', monto: 15000, cliente_id: 'c-1', cliente: { nombre: 'Pérez', razon_social: null } };

  const rechazoDb = () =>
    dbFalsa({
      tablas: {
        'cobranzas_pendientes:uno': { data: cobro },
        'cobranzas_pendientes:update': { data: [{ id: 'cob-1' }] },
      },
    });
  const aprobacionDb = () =>
    dbFalsa({
      tablas: { 'cobranzas_pendientes:uno': { data: { ...cobro, estado: 'aprobada' } } },
      rpc: { aprobar_cobranza: { data: { monto: 15000, saldoNuevo: 5000 } } },
    });

  it('bandeja → rechazar: valida pendiente, rechaza y avisa', async () => {
    const { db, ops, avisos } = rechazoDb();
    await controlador(db).resolver('cobranza', 'cob-1', 'rechazar', { motivo: 'no llegó la transferencia' }, req);
    const upd = ops.find((o) => o.tabla === 'cobranzas_pendientes' && o.accion === 'update');
    expect(upd.valores).toMatchObject({ estado: 'rechazada', resuelta_por: 'u-jp', respuesta: 'no llegó la transferencia' });
    expect(upd.filtros).toContainEqual(['eq', 'estado', 'pendiente']);
    expect(avisos()).toEqual([expect.objectContaining({
      para_usuario: 'u-caja', tipo: 'cobranza', titulo: 'Cobro rechazado: Pérez',
      detalle: expect.stringContaining('Motivo: no llegó la transferencia'),
    })]);
  });

  it('bandeja → aprobar: aplica, emite el recibo y avisa "Cobro aprobado"', async () => {
    const { db, ops, avisos } = aprobacionDb();
    await controlador(db).resolver('cobranza', 'cob-1', 'aprobar', {}, req);
    expect(ops).toContainEqual({ rpc: 'aprobar_cobranza', args: { p_id: 'cob-1', p_usuario: 'u-jp', p_respuesta: null } });
    expect(ops.some((o) => o.rpc === 'emitir_documento')).toBe(true);
    expect(avisos()).toEqual([expect.objectContaining({
      para_usuario: 'u-caja', tipo: 'cobranza', titulo: 'Cobro aprobado: Pérez · $15.000',
      detalle: expect.stringContaining('saldo nuevo $5.000'),
    })]);
  });

  it('Clientes → Cobros a ingresar avisa igual al aprobar y al rechazar', async () => {
    const a = aprobacionDb();
    await new CobranzasController(a.db).aprobar('cob-1', {}, req);
    expect(a.avisos()).toEqual([expect.objectContaining({ para_usuario: 'u-caja', titulo: expect.stringMatching(/^Cobro aprobado/) })]);

    const r = rechazoDb();
    await expect(new CobranzasController(r.db).rechazar('cob-1', { respuesta: 'no' }, req)).resolves.toEqual({ ok: true });
    expect(r.avisos()).toEqual([expect.objectContaining({ para_usuario: 'u-caja', titulo: 'Cobro rechazado: Pérez' })]);
  });

  it('no se avisa a sí mismo el que cargó y firmó su propio cobro', async () => {
    const { db, avisos } = dbFalsa({
      tablas: { 'cobranzas_pendientes:uno': { data: { ...cobro, cargada_por: 'u-jp' } }, 'cobranzas_pendientes:update': { data: [{ id: 'cob-1' }] } },
    });
    await controlador(db).resolver('cobranza', 'cob-1', 'rechazar', {}, req);
    expect(avisos()).toEqual([]);
  });

  it('un cobro ya resuelto no se rechaza de nuevo', async () => {
    const { db, avisos } = dbFalsa({ tablas: { 'cobranzas_pendientes:uno': { data: { ...cobro, estado: 'aprobada' } } } });
    await expect(controlador(db).resolver('cobranza', 'cob-1', 'rechazar', {}, req)).rejects.toThrow(/ya fue aprobada/);
    expect(avisos()).toEqual([]);
  });

  it('si otra persona lo resolvió en el medio, se avisa en vez de pisarlo', async () => {
    const { db, avisos } = dbFalsa({
      tablas: { 'cobranzas_pendientes:uno': { data: cobro }, 'cobranzas_pendientes:update': { data: [] } },
    });
    await expect(controlador(db).resolver('cobranza', 'cob-1', 'rechazar', {}, req)).rejects.toThrow(/otra persona/);
    expect(avisos()).toEqual([]);
  });
});
