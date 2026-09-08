import { agruparPorMedio, etiquetaMedio } from './cierre';

describe('cierre de caja — cómo terminó cada medio', () => {
  it('agrupa por medio y separa las tarjetas por posnet', () => {
    const r = agruparPorMedio([
      { medio: 'efectivo', monto: 1000 }, { medio: 'efectivo', monto: 500 },
      { medio: 'tarjeta', monto: 3000, terminal: 'getnet' }, { medio: 'tarjeta', monto: 2000, terminal: 'clover' },
      { medio: 'mercadopago', monto: 4300 }, { medio: 'transferencia', monto: '700' },
    ]);
    expect(r.map((x) => [x.etiqueta, x.monto, x.pagos])).toEqual([
      ['Efectivo', 1500, 2],
      ['Mercado Pago (QR)', 4300, 1],
      ['Tarjeta · Getnet', 3000, 1],
      ['Tarjeta · Clover', 2000, 1],
      ['Transferencia', 700, 1],
    ]);
  });
  it('un medio desconocido no rompe: se muestra capitalizado', () => {
    expect(etiquetaMedio('vale_compra')).toBe('Vale compra');
    expect(agruparPorMedio([])).toEqual([]);
  });
});
