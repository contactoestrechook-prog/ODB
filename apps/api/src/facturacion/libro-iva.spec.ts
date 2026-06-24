import { libroIvaVentas, libroIvaCompras, resumenIva } from './libro-iva';

const venta = (tipo: string, neto: number, iva: number, extra: any = {}) => ({
  tipo, puntoVenta: 2, numero: 1, fecha: '2026-06-10', neto, iva, total: neto + iva,
  ivaDetalle: [{ alicuota: 21, base: neto, monto: iva }], ...extra,
});

describe('libroIvaVentas', () => {
  it('suma facturas y RESTA las notas de crédito', () => {
    const r = libroIvaVentas([venta('FA', 100, 21), venta('FB', 200, 42), venta('NCA', 50, 10.5)]);
    expect(r.totales.neto).toBe(250);
    expect(r.totales.iva).toBe(52.5);
    expect(r.totales.total).toBe(302.5);
    expect(r.cantidad).toBe(3);
  });

  it('agrupa por alícuota (con el signo de la NC)', () => {
    const r = libroIvaVentas([venta('FA', 100, 21), venta('NCA', 50, 10.5)]);
    expect(r.porAlicuota).toEqual([{ alicuota: 21, neto: 50, iva: 10.5 }]);
  });

  it('excluye anulados y comprobantes no fiscales', () => {
    const r = libroIvaVentas([
      venta('FA', 100, 21),
      venta('FA', 999, 209.79, { estado: 'anulado' }),
      venta('REC', 500, 0),
    ]);
    expect(r.cantidad).toBe(1);
    expect(r.totales.neto).toBe(100);
  });
});

describe('libroIvaCompras', () => {
  it('usa neto/iva reales cuando están cargados', () => {
    const r = libroIvaCompras([{ numero: 'A-1', fecha: '2026-06-05', monto: 121, neto: 100, iva: 21 }]);
    expect(r.totales.neto).toBe(100);
    expect(r.totales.iva).toBe(21);
    expect(r.estimadas).toBe(0);
  });

  it('estima 21% cuando falta el desglose y lo marca', () => {
    const r = libroIvaCompras([{ numero: 'B-2', fecha: '2026-06-06', monto: 242 }]);
    expect(r.totales.neto).toBe(200);
    expect(r.totales.iva).toBe(42);
    expect(r.estimadas).toBe(1);
    expect(r.filas[0].estimado).toBe(true);
  });
});

describe('resumenIva', () => {
  it('IVA débito − IVA crédito (saldo a pagar / a favor)', () => {
    const v = libroIvaVentas([venta('FA', 100, 21), venta('FB', 200, 42)]); // débito 63
    const c = libroIvaCompras([{ numero: 'X', fecha: '2026-06-01', monto: 242 }]); // crédito 42
    expect(resumenIva(v, c)).toEqual({ ivaDebito: 63, ivaCredito: 42, saldo: 21 });
  });
});
