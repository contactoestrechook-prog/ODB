import { PedidosService } from './pedidos.service';

// Regresión del P0 encontrado en la auditoría (Codex, 2026-07-09): avanzar()
// liberaba una reserva de stock en TODO pedido que llegaba a entregado/cancelado,
// sin importar si esa reserva existió de verdad. Los pedidos "a pedido"
// (PedidosYa, Tienda Nube, WhatsApp manual — canal web/whatsapp) se crean sin
// reservar stock: liberar una reserva inexistente sumaba stock fantasma al
// cancelar, y neutralizaba el descuento real al entregar.

function dbFalsa(pedido: any) {
  const rpcCalls: { name: string; args: any }[] = [];
  const updates: any[] = [];
  const q: any = {
    select: () => q,
    eq: () => q,
    single: () => Promise.resolve({ data: pedido, error: null }),
    update: (v: any) => {
      updates.push(v);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  const db: any = {
    from: () => q,
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args });
      let res: any = { data: null, error: null };
      if (name === 'precio_vigente') res = { data: { precio_final: 100 }, error: null };
      if (name === 'registrar_venta') res = { data: { venta_id: 'v-1' }, error: null };
      return Object.assign(Promise.resolve(res), { maybeSingle: () => Promise.resolve(res) });
    },
  };
  return { db, rpcCalls, updates };
}

function pedidoBase(overrides: Partial<any> = {}) {
  return {
    id: 'p-1',
    estado: 'listo',
    canal: 'web',
    sucursal_id: 'suc-1',
    qr_retiro: 'PY-123',
    venta_id: null,
    reserva_stock: false,
    items: [{ producto_id: 'prod-1', cantidad: 2, producto: { nombre: 'Malbec' } }],
    cliente: { dni: '111', nombre: 'Cliente', telefono: null, tipo: null, verificado: false },
    ...overrides,
  };
}

describe('PedidosService.avanzar (reserva de stock: solo libera lo que realmente se reservó)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
  });

  it('reserva_stock=false + cancelado: NO libera stock (nunca se reservó — no sumar stock fantasma)', async () => {
    const { db, rpcCalls } = dbFalsa(pedidoBase({ estado: 'listo', reserva_stock: false }));
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    await svc.avanzar('p-1', 'cancelado');
    expect(rpcCalls.find((c) => c.name === 'registrar_movimiento')).toBeUndefined();
  });

  it('reserva_stock=true + cancelado: SÍ libera stock reservado', async () => {
    const { db, rpcCalls } = dbFalsa(pedidoBase({ estado: 'listo', reserva_stock: true }));
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    await svc.avanzar('p-1', 'cancelado');
    const mov = rpcCalls.find((c) => c.name === 'registrar_movimiento');
    expect(mov?.args).toMatchObject({ p_tipo: 'liberacion_reserva', p_cantidad: 2 });
  });

  it('reserva_stock=false + entregado: registra la venta pero NO libera reserva (nada que liberar)', async () => {
    const { db, rpcCalls } = dbFalsa(pedidoBase({ estado: 'listo', reserva_stock: false }));
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    await svc.avanzar('p-1', 'entregado');
    expect(rpcCalls.find((c) => c.name === 'registrar_movimiento')).toBeUndefined();
    expect(rpcCalls.find((c) => c.name === 'registrar_venta')).toBeDefined();
  });

  it('reserva_stock=true + entregado: libera la reserva Y registra la venta (neto = -cantidad del stock original)', async () => {
    const { db, rpcCalls } = dbFalsa(pedidoBase({ estado: 'listo', reserva_stock: true }));
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    await svc.avanzar('p-1', 'entregado');
    expect(rpcCalls.find((c) => c.name === 'registrar_movimiento' && c.args.p_tipo === 'liberacion_reserva')).toBeDefined();
    expect(rpcCalls.find((c) => c.name === 'registrar_venta')).toBeDefined();
  });

  it('reintento de avanzar a entregado reusa el mismo venta_id (idempotencia)', async () => {
    const { db, rpcCalls, updates } = dbFalsa(pedidoBase({ estado: 'listo', reserva_stock: false, venta_id: 'ya-reservado' }));
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    await svc.avanzar('p-1', 'entregado');
    // no debe reservar un venta_id nuevo si el pedido ya tenía uno persistido
    expect(updates.find((u) => 'venta_id' in u)).toBeUndefined();
    const venta = rpcCalls.find((c) => c.name === 'registrar_venta');
    expect(venta?.args.p_venta_id).toBe('ya-reservado');
  });
});
