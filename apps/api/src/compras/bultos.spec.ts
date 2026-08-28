import { unidadesPorBulto, esRenglonDeDescuento } from './bultos';

describe('unidadesPorBulto — la forma, no la lista de proveedores', () => {
  it.each([
    ['MANOS NEGRAS Pinot Noir CJ x 6', 6],
    ['MANOS NEGRAS Malbec CJx6', 6],
    ['Deseado Torrontes Dulce 6x750', 6],
    ['CORONA 355 X 24B', 24],
    ['Agua Mineral PACK X 6', 6],
    ['Cerveza CAJA X 12', 12],
    ['Gaseosa 12 x 1000cc', 12],
    ['Vino BOX 6', 6],
    ['Lata x12u', 12],
    ['Display 24 unidades', 24],
  ])('%s → %s', (texto, esperado) => {
    expect(unidadesPorBulto(texto)).toBe(esperado);
  });

  // Lo que NO puede confundirse con un bulto: el tamaño del envase es el error
  // caro, porque multiplicaría el stock por 750.
  it.each([
    'Vino Malbec 750cc',
    '1310 Mts Chardonnay - Finca Ferrer 750cc',
    'Fernet Branca 1000',
    'Coca Cola 2,25L',
    'Agua Saint Thomas 500ml',
  ])('no inventa bulto en "%s"', (texto) => {
    expect(unidadesPorBulto(texto)).toBeNull();
  });

  it('ignora números fuera de lo que puede ser un bulto', () => {
    expect(unidadesPorBulto('Pack x 900')).toBeNull();
    expect(unidadesPorBulto('caja x 1')).toBeNull();
  });
});

describe('esRenglonDeDescuento — el signo manda', () => {
  it('un importe negativo nunca es mercadería, diga lo que diga el texto', () => {
    expect(esRenglonDeDescuento({ descripcion: 'MANOS NEGRAS Malbec CJ x6', precio: -18702.55 })).toBe(true);
  });

  it('reconoce el texto aunque el importe venga en positivo', () => {
    expect(esRenglonDeDescuento({ descripcion: 'Desc. 42.86% - MANOS NEGRAS Malbec', precio: 18702 })).toBe(true);
    expect(esRenglonDeDescuento({ descripcion: 'Bonificacion s/ item 4', precio: 100 })).toBe(true);
  });

  it('la mercadería sin cargo NO es un descuento: entra al stock', () => {
    expect(esRenglonDeDescuento({ descripcion: 'ZAHA Chardonnay CJ x 6', precio: 0 })).toBe(false);
  });
});
