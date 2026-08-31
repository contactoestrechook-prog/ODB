import { unidadesPorBulto, esRenglonDeDescuento, fusionarRenglonesPorSku, porcentajeDeDescuento, descuentoEsDelRenglon, puedeVendersePorPeso, corregirRenglonQueNoCierra, resolverCantidadYBulto, interpretarRenglon } from './bultos';

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

describe('puedeVendersePorPeso — la bebida nunca', () => {
  // Los casos reales que entraron como kilos: latas de cerveza.
  it.each([
    'KAISERDOM HEFE - WEISSBIER NATURTRÜB LATA 1000ML',
    'ESTRELLA DAMM LATA 500ML',
    'SCHOFFERHOFER LATA 24X500ML (TRIGO)',
    'V. Corte A cc x 4 2019',
    'Tomero Malbec cc x 6 2024',
    'Coca Cola 2,25L',
    'Fernet Branca 750cc',
    'PACK 3 SCHOFFERHOFER BOTELLA 500ML + VASO',
  ])('no es por peso: %s', (t) => {
    expect(puedeVendersePorPeso(t)).toBe(false);
  });

  it.each([
    'JAMON COCIDO FRACCIONADO',
    'QUESO CREMOSO HORMA',
    'Salame Milan x kg',
    'Mortadela con pistacho',
    'MUZZARELLA BARRA 5 KG',
    'Bondiola braseada al peso',
  ])('sí puede ser por peso: %s', (t) => {
    expect(puedeVendersePorPeso(t)).toBe(true);
  });

  // Sin evidencia, la respuesta es NO: cargar kilos donde van unidades es el
  // error caro; el error al revés lo arregla una persona con un botón.
  it('sin evidencia, no', () => {
    expect(puedeVendersePorPeso('ARTICULO VARIOS 123')).toBe(false);
    expect(puedeVendersePorPeso('')).toBe(false);
  });
});

describe('vinos sin volumen en la descripción', () => {
  it.each(['Gran Revancha Blend de', 'Primera Revancha Chenin', 'Vistalba Bonarda Reserva'])(
    'tampoco es por peso: %s',
    (t) => { expect(puedeVendersePorPeso(t)).toBe(false); },
  );
});

describe('corregirRenglonQueNoCierra — la factura siempre cierra, el que lee no', () => {
  it('no dice nada cuando el renglón cierra', () => {
    expect(corregirRenglonQueNoCierra({ cantidad: 24, precio: 3636.36, importe: 87272.64 })).toBeNull();
  });

  // Los dos renglones reales de Borravino: el lector cruzó las cantidades entre
  // filas. importe ÷ precio da entero exacto, así que la cantidad es esa.
  it('corrige la CANTIDAD cuando el importe da un entero exacto', () => {
    expect(corregirRenglonQueNoCierra({ cantidad: 12, precio: 3677.69, importe: 88264.56 }))
      .toEqual({ campo: 'cantidad', valor: 24, seguro: true });
    expect(corregirRenglonQueNoCierra({ cantidad: 24, precio: 4008.26, importe: 48099.12 }))
      .toEqual({ campo: 'cantidad', valor: 12, seguro: true });
  });

  it('propone el PRECIO, sin certeza, cuando no da entero', () => {
    const r = corregirRenglonQueNoCierra({ cantidad: 7, precio: 1000, importe: 8500 });
    expect(r).toEqual({ campo: 'precio', valor: 1214.29, seguro: false });
  });

  it('tolera el redondeo del proveedor', () => {
    expect(corregirRenglonQueNoCierra({ cantidad: 12, precio: 4297.52, importe: 51570 })).toBeNull();
  });

  it('no opina sin los tres números', () => {
    expect(corregirRenglonQueNoCierra({ cantidad: 12, precio: 4297.52, importe: null })).toBeNull();
    expect(corregirRenglonQueNoCierra({ cantidad: 3, precio: 165000, importe: 0 })).toBeNull();
  });
});

describe('resolverCantidadYBulto — la corrección ES la conversión', () => {
  // Savora: 1 bulto de 24, precio por unidad. El importe resuelve todo junto.
  it('1 bulto de 24 con precio por unidad → 24 unidades, bulto consumido', () => {
    const r = resolverCantidadYBulto({ cantidad: 1, precio: 1766, importe: 42388, unidadesPorBulto: 24 });
    expect(r.cantidad).toBe(24);
    expect(r.unidadesPorBulto).toBeNull(); // NO queda nada más que convertir
    expect(r.bultoConsumido).toBe(24);
  });

  // Borravino: cantidades cruzadas entre filas, sin bulto de por medio.
  it('corrige la cantidad cruzada aunque no haya bulto', () => {
    const r = resolverCantidadYBulto({ cantidad: 12, precio: 3677.69, importe: 88264.56, unidadesPorBulto: null });
    expect(r.cantidad).toBe(24);
    expect(r.cantidadOriginal).toBe(12);
  });

  // Corona: 84 bultos con precio POR BULTO. La cuenta cierra tal cual, así que
  // el bulto sigue vivo y el botón "Pasar a unidad" corresponde.
  it('si el renglón cierra, el bulto queda para que decida el operador', () => {
    const r = resolverCantidadYBulto({ cantidad: 84, precio: 55000, importe: 4620000, unidadesPorBulto: 24 });
    expect(r.cantidad).toBe(84);
    expect(r.unidadesPorBulto).toBe(24);
    expect(r.cantidadOriginal).toBeNull();
  });

  it('sin importe no se toca nada', () => {
    const r = resolverCantidadYBulto({ cantidad: 1, precio: 1766, importe: null, unidadesPorBulto: 24 });
    expect(r.cantidad).toBe(1);
    expect(r.unidadesPorBulto).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// El intérprete único, contra TODOS los casos reales que pasaron por el local.
// Cada uno de estos renglones rompió algo alguna vez: son la memoria del bug.
// ---------------------------------------------------------------------------
describe('interpretarRenglon — la tabla de precedencia completa', () => {
  const leer = (x: Partial<import('./bultos').LecturaRenglon>) =>
    interpretarRenglon({
      descripcion: '', cantidad: 1, precio: 0, importe: null,
      unidadesPorBulto: null, bonificacionPct: null, esDescuento: false,
      kg: null, puedePorPeso: false, ...x,
    });

  // ---- 1. descuento ----
  it('Aldo\'s: "Desc. 42.86%" es rebaja, no mercadería, aunque nombre al vino', () => {
    const r = leer({ descripcion: 'Desc. 42.86% - MANOS NEGRAS Malbec CJ x6', cantidad: 7, precio: -18702.55, importe: -130917.82 });
    expect(r.decision).toBe('descuento');
  });

  // ---- 2. bonificado ----
  it('Vistalba: la caja sin cargo NO es medio kilo ni cantidad corregida', () => {
    const r = leer({ descripcion: 'Gran Tomero Semillón cc x 6 IG-VDU 2024', cantidad: 3, precio: 165000, importe: 0, bonificacionPct: 100, unidadesPorBulto: 6 });
    expect(r.decision).toBe('bonificado');
    expect(r.cantidad).toBe(3);
    expect(r.unidadesPorBulto).toBe(6); // la caja regalada sigue siendo caja
  });

  it('vino bonificado 50%: la mitad del importe no se lee como peso', () => {
    const r = leer({ descripcion: 'Gran Revancha Blend de', cantidad: 1, precio: 246000, importe: 123000, bonificacionPct: 50 });
    expect(r.decision).toBe('bonificado');
    expect(r.porPeso).toBe(false);
  });

  // ---- 3. peso con columna ----
  it('fiambre con columna KG que cierra: entra en kilos', () => {
    const r = leer({ descripcion: 'JAMON COCIDO FRACCIONADO', cantidad: 1, precio: 8000, importe: 43520, kg: 5.44, puedePorPeso: true });
    expect(r.decision).toBe('peso_columna');
    expect(r.cantidad).toBeCloseTo(5.44, 2);
    expect(r.porPeso).toBe(true);
  });

  it('columna KG que NO cierra con el importe: no se usa a ciegas', () => {
    const r = leer({ descripcion: 'QUESO CREMOSO HORMA', cantidad: 1, precio: 8000, importe: 43520, kg: 9.9, puedePorPeso: true });
    expect(r.decision).not.toBe('peso_columna');
  });

  // ---- 4. cierra / bulto pendiente ----
  it('Corona: 84 bultos con precio POR bulto cierran; el bulto queda pendiente del operador', () => {
    const r = leer({ descripcion: 'CORONA 355 X 24B', cantidad: 84, precio: 55000, importe: 4620000, unidadesPorBulto: 24 });
    expect(r.decision).toBe('bulto_pendiente');
    expect(r.cantidad).toBe(84);
    expect(r.unidadesPorBulto).toBe(24);
  });

  it('renglón simple que cierra: no se toca nada', () => {
    const r = leer({ descripcion: 'DAB LATA 500ML', cantidad: 12, precio: 4297.52, importe: 51570.24 });
    expect(r.decision).toBe('cierra');
    expect(r.cantidad).toBe(12);
  });

  // ---- 5. cantidad corregida (consume el bulto) ----
  it('Savora: 1 bulto de 24 con precio por unidad → 24 unidades, sin doble conversión', () => {
    const r = leer({ descripcion: 'SAVORA SQZ X200GRS', cantidad: 1, precio: 1766, importe: 42388, unidadesPorBulto: 24 });
    expect(r.decision).toBe('cantidad_corregida');
    expect(r.cantidad).toBe(24);
    expect(r.unidadesPorBulto).toBeNull();
    expect(r.bultoConsumido).toBe(24);
  });

  it('Borravino: cantidades cruzadas entre filas se corrigen a lo que dice el importe', () => {
    expect(leer({ descripcion: 'KAISERDOM HEFE - WEISSBIER NATURTRÜB LATA 1000ML', cantidad: 12, precio: 3677.69, importe: 88264.56 }).cantidad).toBe(24);
    expect(leer({ descripcion: 'ESTRELLA DAMM LATA 500ML', cantidad: 24, precio: 4008.26, importe: 48099.12 }).cantidad).toBe(12);
  });

  it('la cerveza con importe entero JAMÁS se interpreta como kilos', () => {
    const r = leer({ descripcion: 'KAISERDOM HEFE - WEISSBIER NATURTRÜB LATA 1000ML', cantidad: 12, precio: 3677.69, importe: 88264.56, puedePorPeso: false });
    expect(r.porPeso).toBe(false);
    expect(r.decision).toBe('cantidad_corregida');
  });

  // ---- 6. peso implícito ----
  it('queso sin columna KG pero con importe decimal: son kilos', () => {
    const r = leer({ descripcion: 'MUZZARELLA BARRA', cantidad: 1, precio: 6500, importe: 35392.5, puedePorPeso: true });
    expect(r.decision).toBe('peso_implicito');
    expect(r.cantidad).toBeCloseTo(5.445, 3);
    expect(r.porPeso).toBe(true);
  });

  it('el mismo descuadre decimal en una CERVEZA no es peso: queda para revisar', () => {
    const r = leer({ descripcion: 'ESTRELLA DAMM LATA 500ML', cantidad: 1, precio: 6500, importe: 35392.5, puedePorPeso: false });
    expect(r.decision).toBe('no_cierra');
    expect(r.porPeso).toBe(false);
  });

  // ---- 7. no cierra ----
  it('cuando no hay deducción posible, propone el unitario y no toca nada', () => {
    const r = leer({ descripcion: 'ARTICULO X', cantidad: 7, precio: 1000, importe: 8500 });
    expect(r.decision).toBe('no_cierra');
    expect(r.cantidad).toBe(7);
    expect(r.precioPropuesto).toBeCloseTo(1214.29, 2);
  });

  it('sin importe no hay ancla: se respeta lo leído', () => {
    const r = leer({ descripcion: 'CUALQUIERA', cantidad: 5, precio: 100, importe: null, unidadesPorBulto: 6 });
    expect(r.decision).toBe('bulto_pendiente');
    expect(r.cantidad).toBe(5);
  });
});
