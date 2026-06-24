import { mapProductoATN, mapPedidoTN } from './mapeo';

describe('mapProductoATN', () => {
  it('arma el payload de TN (nombre localizado, precio string, variante con sku/stock)', () => {
    const r = mapProductoATN({ sku: 'L123', nombre: 'Vino Malbec', stock: 12 }, 1500);
    expect(r.name).toEqual({ es: 'Vino Malbec' });
    expect(r.published).toBe(true);
    expect(r.variants[0]).toMatchObject({ price: '1500', sku: 'L123', stock_management: true, stock: 12 });
  });

  it('stock nunca negativo y se redondea', () => {
    expect(mapProductoATN({ sku: 'X', nombre: 'A', stock: -5 }, 10).variants[0].stock).toBe(0);
    expect(mapProductoATN({ sku: 'X', nombre: 'A', stock: 3.7 }, 10).variants[0].stock).toBe(4);
  });
});

describe('mapPedidoTN', () => {
  const order = {
    id: 9001, number: 102, contact_name: 'Marta', contact_phone: '11-5555',
    payment_status: 'paid',
    customer: { name: 'Marta G', identification: '20.111.222' },
    products: [{ sku: 'L1', name: 'Fernet', quantity: 2 }, { sku: null, name: 'Coca 2.25', quantity: 1 }],
    note: 'dejar en portería',
  };
  it('normaliza referencia, ítems, cliente y estado de pago', () => {
    const m = mapPedidoTN(order);
    expect(m.referencia).toBe('TN-9001');
    expect(m.pagado).toBe(true);
    expect(m.clienteNombre).toBe('Marta');
    expect(m.clienteDni).toBe('20111222'); // sin puntos
    expect(m.items).toHaveLength(2);
    expect(m.items[0]).toEqual({ sku: 'L1', name: 'Fernet', quantity: 2 });
  });
  it('pagado=false si el pago está pendiente', () => {
    expect(mapPedidoTN({ ...order, payment_status: 'pending' }).pagado).toBe(false);
  });
});
