import { conDescuentoEfectivo, tieneDescuentoEfectivo } from './descuento-efectivo';

describe('descuento en efectivo o transferencia (30/9/2026)', () => {
  it('entran vinos, destilados, aperitivos, estuchería y espumantes', () => {
    for (const c of ['Vinos Tintos Malbec', 'Vinos Blancos Chardonnay', 'Vinos Rosados', 'Vinos Importados', 'Añadas Antiguas',
      'Whisky', 'Whiskies', 'Gin', 'vodka', 'Ron', 'Tequila', 'Destilados', 'Aperitivos', 'ESTUCHERIA',
      'Espumantes Extra Brut', 'Espumante Importado', 'Espumante Dulce']) expect(tieneDescuentoEfectivo(c)).toBe(true);
  });
  it('no entran los demás rubros ni los dudosos sin confirmar', () => {
    for (const c of ['Cervezas Importadas', 'Gaseosas', 'Snacks', 'Accesorios para Vinos y Cocteleria', 'Licores', 'Sidra', 'CAVAS', 'Alcohol', null, ''])
      expect(tieneDescuentoEfectivo(c)).toBe(false);
  });
  it('calcula el 10% redondeado', () => {
    expect(conDescuentoEfectivo(59400)).toBe(53460);
    expect(conDescuentoEfectivo(20500)).toBe(18450);
  });
  it('en 0 se apaga', () => {
    const antes = process.env.DESCUENTO_EFECTIVO;
    process.env.DESCUENTO_EFECTIVO = '0';
    expect(tieneDescuentoEfectivo('Whisky')).toBe(false);
    process.env.DESCUENTO_EFECTIVO = antes;
    if (antes === undefined) delete process.env.DESCUENTO_EFECTIVO;
  });
});
