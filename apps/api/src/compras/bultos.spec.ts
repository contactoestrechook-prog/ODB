import { unidadesPorBulto, esRenglonDeDescuento, fusionarRenglonesPorSku, porcentajeDeDescuento, descuentoEsDelRenglon, precioQueImplicaElImporte } from './bultos';

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
    // Bodega Vistalba: mete su abreviatura antes de la x y el año después.
    // Enumerar abreviaturas es justo lo que se rompe con el proveedor nuevo.
    ['V. Corte A cc x 4 2019', 4],
    ['Gran Tomero Pinot Noir cc x 6 IG-VU 2025', 6],
    ['Gran Tomero Merlot SV x 6 cc IG-VDU 2023', 6],
    ['Tomero Malbec cc x 6 2024', 6],
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
    expect(unidadesPorBulto('Vino cosecha x 2019')).toBeNull();
  });

  it('una medida después de la x no es un bulto', () => {
    expect(unidadesPorBulto('Gaseosa x 750cc')).toBeNull();
    expect(unidadesPorBulto('Vino x 1000 ml')).toBeNull();
    expect(unidadesPorBulto('Gaseosa x 2 L')).toBeNull();
    expect(unidadesPorBulto('Vino x 1,5 lt')).toBeNull();
  });

  // Ninguna bebida se vende en seis centímetros cúbicos: ahí "cc" es la
  // abreviatura de la bodega, no una medida.
  it('un número chico con cc al lado sigue siendo un bulto', () => {
    expect(unidadesPorBulto('Gran Tomero Merlot SV x 6 cc IG-VDU 2023')).toBe(6);
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

describe('fusionarRenglonesPorSku — lo regalado abarata lo pagado', () => {
  it('20 pagas + 3 de regalo = 23 al costo de 20', () => {
    const [r] = fusionarRenglonesPorSku([
      { sku: 'A', cantidad: 20, costo: 1000 },
      { sku: 'A', cantidad: 3, costo: 0 },
    ]);
    expect(r.cantidad).toBe(23);
    expect(r.costo).toBeCloseTo(869.57, 2); // 20.000 / 23
  });

  it('12 pagas + 5 de regalo', () => {
    const [r] = fusionarRenglonesPorSku([
      { sku: 'B', cantidad: 12, costo: 100 },
      { sku: 'B', cantidad: 5, costo: 0 },
    ]);
    expect(r.cantidad).toBe(17);
    expect(r.costo).toBeCloseTo(70.59, 2); // 1.200 / 17
  });

  // El caso que rompía de verdad: la entrada fija el costo por SKU, así que el
  // renglón regalado (costo 0) pisaba al pagado y el producto quedaba en cero.
  it('nunca deja el producto con costo cero por el renglón regalado', () => {
    const [r] = fusionarRenglonesPorSku([
      { sku: 'C', cantidad: 3, costo: 380000 },
      { sku: 'C', cantidad: 1, costo: 0 },
    ]);
    expect(r.costo).toBeGreaterThan(0);
    expect(r.costo).toBeCloseTo(285000, 2); // 1.140.000 / 4
  });

  it('deja intactos los productos que vienen en un solo renglón', () => {
    const salida = fusionarRenglonesPorSku([
      { sku: 'D', cantidad: 5, costo: 200 },
      { sku: 'E', cantidad: 2, costo: 300 },
    ]);
    expect(salida).toHaveLength(2);
    expect(salida.map((x) => x.costo)).toEqual([200, 300]);
  });
});

describe('a qué renglón corresponde una rebaja', () => {
  it('lee el porcentaje que declara el papel', () => {
    expect(porcentajeDeDescuento('Desc. 42.86% - MANOS NEGRAS Malbec CJ x6')).toBeCloseTo(42.86, 2);
    expect(porcentajeDeDescuento('Px mágico $12.000 MP = 17,2%')).toBeCloseTo(17.2, 2);
    expect(porcentajeDeDescuento('Descuento general')).toBeNull();
  });

  // Aldo's: el descuento es de ese renglón y el porcentaje lo confirma.
  it('acepta la rebaja cuando el porcentaje cierra con el renglón', () => {
    expect(descuentoEsDelRenglon(130917.82, 305454.55, 42.86)).toBe(true);
  });

  // Sprite: "Px mágico = 17,2%" pero sobre ese renglón daría 117%. Es una
  // promoción de varios renglones, no de este.
  it('rechaza la rebaja cuando el porcentaje no cierra', () => {
    expect(descuentoEsDelRenglon(52963, 45055, 17.2)).toBe(false);
  });

  it('sin porcentaje declarado, una rebaja no puede superar al renglón', () => {
    expect(descuentoEsDelRenglon(5000, 45055, null)).toBe(true);
    expect(descuentoEsDelRenglon(52963, 45055, null)).toBe(false);
  });
});

describe('precioQueImplicaElImporte — el renglón se controla solo', () => {
  it('no dice nada cuando la cuenta cierra', () => {
    expect(precioQueImplicaElImporte({ cantidad: 12, precio: 4297.52, importe: 51570.24 })).toBeNull();
  });

  it('tolera el redondeo del proveedor', () => {
    expect(precioQueImplicaElImporte({ cantidad: 12, precio: 4297.52, importe: 51570 })).toBeNull();
  });

  // El caso real: el lector tomó el precio de la fila de al lado. 12 × 3.677,69
  // da 44.132,28, pero el renglón dice 110.082,60.
  it('avisa el precio correcto cuando tomó el número de otra fila', () => {
    expect(precioQueImplicaElImporte({ cantidad: 12, precio: 3677.69, importe: 110082.6 })).toBeCloseTo(9173.55, 2);
  });

  it('no opina si falta alguno de los tres números', () => {
    expect(precioQueImplicaElImporte({ cantidad: 12, precio: 4297.52, importe: null })).toBeNull();
    expect(precioQueImplicaElImporte({ cantidad: 0, precio: 4297.52, importe: 51570.24 })).toBeNull();
  });

  // Un renglón sin cargo tiene importe 0 a propósito: no es un error de lectura.
  it('no marca la mercadería sin cargo', () => {
    expect(precioQueImplicaElImporte({ cantidad: 3, precio: 165000, importe: 0 })).toBeNull();
  });
});
