import { calcularIva, RenglonInvalidoError } from './iva';

describe('calcularIva — motor de IVA (lógica pura)', () => {
  it('abre el IVA 21% de un precio final', () => {
    const r = calcularIva([{ descripcion: 'Vino', cantidad: 1, precioUnitario: 121, alicuota: 21 }]);
    expect(r.total).toBe(121);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
    expect(r.ivaDetalle).toEqual([{ alicuota: 21, base: 100, monto: 21 }]);
  });

  it('respeta cantidades y la alícuota 10,5%', () => {
    const r = calcularIva([{ descripcion: 'Agua', cantidad: 2, precioUnitario: 110.5, alicuota: 10.5 }]);
    expect(r.total).toBe(221);
    expect(r.neto).toBe(200);
    expect(r.iva).toBe(21);
  });

  it('separa el detalle por cada alícuota', () => {
    const r = calcularIva([
      { descripcion: 'a', cantidad: 1, precioUnitario: 121, alicuota: 21 },
      { descripcion: 'b', cantidad: 1, precioUnitario: 110.5, alicuota: 10.5 },
    ]);
    expect(r.total).toBe(231.5);
    expect(r.neto).toBe(200);
    expect(r.iva).toBe(31.5);
    expect(r.ivaDetalle).toHaveLength(2);
  });

  it('toma 21% por defecto si no se indica alícuota', () => {
    const r = calcularIva([{ descripcion: 'x', cantidad: 1, precioUnitario: 121 }]);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
  });

  it('remito (forzarSinIva): todo va a neto, IVA 0', () => {
    const r = calcularIva([{ descripcion: 'x', cantidad: 1, precioUnitario: 121, alicuota: 21 }], { forzarSinIva: true });
    expect(r.iva).toBe(0);
    expect(r.neto).toBe(121);
    expect(r.ivaDetalle).toEqual([]);
  });

  it('rechaza un renglón con cantidad 0', () => {
    expect(() => calcularIva([{ descripcion: 'mal', cantidad: 0, precioUnitario: 100 }])).toThrow(RenglonInvalidoError);
  });
});
