import { PedidosService } from './pedidos.service';
import { cuentaParaEntregar } from './entregar-cta-cte';

// «Agregar que fue cuenta corriente para que lo facture pero lo deje en cuenta del cliente»
// (Juan Pablo, por Leandro, 25/11/2026, con la ventana «Entregar DOM-577DE6293359»).

const GRILLER = { id: 'aaaaaaaa-1111-4111-8111-111111111111', nombre: 'Griller', razon_social: null, cuit: '30711111119', condicion_iva: 'responsable_inscripto', cta_cte_habilitada: true, limite_credito: 0, saldo_cta_cte: 95040 };
const DEBO = { id: 'bbbbbbbb-2222-4222-8222-222222222222', nombre: 'Debo St 258', razon_social: null, cuit: null, condicion_iva: 'consumidor_final', cta_cte_habilitada: true, limite_credito: 100000, saldo_cta_cte: 50000 };

describe('entregar a cuenta corriente: lo que se revisa', () => {
  it('cuenta abierta: factura A si es responsable inscripto con CUIT, B si no', () => {
    expect(cuentaParaEntregar(GRILLER, 70500, null)).toEqual({ clienteId: 'aaaaaaaa-1111-4111-8111-111111111111', nombre: 'Griller', tipo: 'FA' });
    expect(cuentaParaEntregar(DEBO, 20000, 50000)).toEqual({ clienteId: 'bbbbbbbb-2222-4222-8222-222222222222', nombre: 'Debo St 258', tipo: 'FB' });
  });

  it('sin cuenta abierta o pasado del tope, no', () => {
    expect(cuentaParaEntregar({ ...DEBO, cta_cte_habilitada: false }, 1000, 0)).toContain('no tiene cuenta corriente abierta');
    expect(cuentaParaEntregar(DEBO, 70500, 50000)).toContain('Se pasa del tope de Debo St 258');
    expect(cuentaParaEntregar(null, 1, 0)).toBe('No existe ese cliente');
  });
});

/** Base falsa: el pedido listo, los clientes y lo que se llama. */
function armar(o: { cliente?: any; emitirFalla?: boolean; pagado?: boolean } = {}) {
  const llamadas: { rpc: string; args: any }[] = [];
  const updates: { tabla: string; fila: any }[] = [];
  const alertas: any[] = [];
  const pedido = { id: 'P-1', estado: 'listo', canal: 'pickup', sucursal_id: 'S-1', qr_retiro: 'PICKUP-AAA', total: 70500, cliente_id: null, pagado_en: o.pagado ? '2026-11-25T10:00:00Z' : null, items: [], cliente: null, origen: 'charla', repartidor_id: null, forma_pago: null };
  const db: any = {
    from: (tabla: string) => {
      const q: any = {
        select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q, limit: () => q, or: () => q,
        single: () => Promise.resolve({ data: pedido, error: null }),
        maybeSingle: () => Promise.resolve({ data: tabla === 'clientes' ? o.cliente ?? null : tabla === 'pedidos' ? pedido : null, error: null }),
        update: (fila: any) => { updates.push({ tabla, fila }); return q; },
        insert: (fila: any) => { if (tabla === 'alertas_internas') alertas.push(fila); return Promise.resolve({ error: null }); },
        then: (ok: any) => Promise.resolve({ data: tabla === 'pedidos' ? [{ id: pedido.id }] : [], error: null }).then(ok),
      };
      return q;
    },
    rpc: (rpc: string, args: any) => {
      llamadas.push({ rpc, args });
      if (rpc === 'faltantes_pedido') return Promise.resolve({ data: [], error: null });
      if (rpc === 'entregar_pedido') return Promise.resolve({ data: { venta_id: 'V-1', medio: args.p_medio }, error: null });
      if (rpc === 'saldo_cuenta') return Promise.resolve({ data: Number(o.cliente?.saldo_cta_cte ?? 0), error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const facturacion = { emitir: jest.fn(async () => { if (o.emitirFalla) throw new Error('sin numeración'); return { numero: 1234, punto_venta: 2 }; }) };
  const svc = new PedidosService(db, { aCliente: jest.fn() } as any, facturacion as any);
  return { svc, llamadas, updates, alertas, facturacion };
}

describe('entregar a cuenta corriente: el recorrido', () => {
  it('entrega como cta_cte, deja el pedido a nombre del cliente y factura con condición cuenta corriente', async () => {
    const { svc, llamadas, updates, facturacion } = armar({ cliente: GRILLER });
    const r: any = await svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', { clienteCtaCte: 'aaaaaaaa-1111-4111-8111-111111111111' });
    expect(llamadas.find((l) => l.rpc === 'entregar_pedido')?.args).toMatchObject({ p_medio: 'cta_cte' });
    expect(updates).toEqual(expect.arrayContaining([{ tabla: 'pedidos', fila: { cliente_id: 'aaaaaaaa-1111-4111-8111-111111111111' } }]));
    expect(facturacion.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'FA', clienteId: 'aaaaaaaa-1111-4111-8111-111111111111', ventaId: 'V-1', condicionPago: 'cta_cte', moverStock: false }), 'U-JP');
    // la cola de ARCA pasa a factura A
    expect(updates).toEqual(expect.arrayContaining([{ tabla: 'comprobantes_arca', fila: { tipo: 'FA' } }]));
    expect(r.venta.ctaCte).toMatchObject({ ok: true, cliente: 'Griller', comprobante: { tipo: 'FA', numero: 1234 } });
  });

  it('sin elegir cliente, con la cuenta cerrada o un pedido ya pagado: no se entrega', async () => {
    let x = armar({ cliente: GRILLER });
    await expect(x.svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', {})).rejects.toThrow('Elegí el cliente');
    expect(x.llamadas.some((l) => l.rpc === 'entregar_pedido')).toBe(false);
    x = armar({ cliente: { ...GRILLER, cta_cte_habilitada: false } });
    await expect(x.svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', { clienteCtaCte: 'aaaaaaaa-1111-4111-8111-111111111111' })).rejects.toThrow('no tiene cuenta corriente abierta');
    expect(x.llamadas.some((l) => l.rpc === 'entregar_pedido')).toBe(false);
    x = armar({ cliente: GRILLER, pagado: true });
    await expect(x.svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', { clienteCtaCte: 'aaaaaaaa-1111-4111-8111-111111111111' })).rejects.toThrow('ya está pagado');
  });

  it('pasado del tope: no se entrega', async () => {
    const { svc, llamadas } = armar({ cliente: DEBO });
    await expect(svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', { clienteCtaCte: 'bbbbbbbb-2222-4222-8222-222222222222' })).rejects.toThrow('Se pasa del tope');
    expect(llamadas.some((l) => l.rpc === 'entregar_pedido')).toBe(false);
  });

  it('si la factura no sale, el pedido queda entregado y salta un aviso para emitirla a mano', async () => {
    const { svc, alertas } = armar({ cliente: GRILLER, emitirFalla: true });
    const r: any = await svc.avanzar('P-1', 'entregado', 'U-JP', 'cta_cte', { clienteCtaCte: 'aaaaaaaa-1111-4111-8111-111111111111' });
    expect(r.venta.ctaCte).toMatchObject({ ok: false, error: 'sin numeración' });
    expect(alertas[0]).toMatchObject({ tipo: 'cta_cte_sin_factura', titulo: expect.stringContaining('PICKUP-AAA') });
  });

  it('los otros medios no tocan la facturación', async () => {
    const { svc, facturacion } = armar({ cliente: GRILLER });
    await svc.avanzar('P-1', 'entregado', 'U-JP', 'transferencia');
    expect(facturacion.emitir).not.toHaveBeenCalled();
  });
});
