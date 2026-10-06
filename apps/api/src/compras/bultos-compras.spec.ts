// Las tres salidas de un renglón con «×N» en la carga de facturas del panel
// (apps/admin/app/lib/bultos-compras.ts). Se prueba acá porque la API es la que
// tiene los tests.
//
// Caso real (Ana, 6/10/2026): MARINA MAPACA "DORITOS QUESO 200GX14"
// 28 × $4.899,65 = $137.190,20. Eran 28 unidades; el único botón de la pantalla
// multiplicaba y los dejaba en 392 a $350.
import {
  alCambiarVinculo, conversionBajaDeMas, dejarEnCajas, estadoDelBulto, opcionesDelBulto, pasarAUnidades,
  variacionDeCosto, volverABulto, volverAPendiente, yaEnUnidades,
} from '../../../admin/app/lib/bultos-compras';

const DORITOS = {
  descripcion: 'DORITOS QUESO 200GX14', cantidad: 28, precio: 4899.65, importe: 137190.2,
  unidadesPorBulto: 14, bultoAplicado: null, bultoDescartado: null, costoCatalogo: 5714.29,
  razonBulto: null as any,
};

describe('las tres salidas de un renglón con «×N»', () => {
  it('pendiente hasta que alguien elige', () => {
    expect(estadoDelBulto(DORITOS)).toBe('pendiente');
  });

  it('«Ya vienen en unidades»: saca la marca y NO toca cantidad, precio ni importe', () => {
    const r = yaEnUnidades(DORITOS);
    expect(r).toMatchObject({ cantidad: 28, precio: 4899.65, importe: 137190.2, unidadesPorBulto: null, bultoDescartado: 14, bultoDescartadoComo: 'unidades' });
    expect(estadoDelBulto(r)).toBe('ya_en_unidades');
  });

  it('«Pasar a unidades»: × 14 la cantidad, ÷ 14 el precio (el importe no cambia)', () => {
    const r = pasarAUnidades(DORITOS);
    expect(r).toMatchObject({ cantidad: 392, precio: 349.98, importe: 137190.2, bultoAplicado: 14, unidadesPorBulto: null });
    expect(estadoDelBulto(r)).toBe('convertido');
    expect(volverABulto(r)).toMatchObject({ cantidad: 28, precio: 4899.72, unidadesPorBulto: 14, bultoAplicado: null });
  });

  it('«Dejar en cajas»: el producto es la caja; tampoco se multiplica', () => {
    const r = dejarEnCajas(DORITOS);
    expect(r).toMatchObject({ cantidad: 28, precio: 4899.65, bultoDescartado: 14, bultoDescartadoComo: 'caja' });
    expect(estadoDelBulto(r)).toBe('caja');
  });

  it('deshacer vuelve a preguntar', () => {
    expect(volverAPendiente(yaEnUnidades(DORITOS))).toMatchObject({ unidadesPorBulto: 14, bultoDescartado: null, bultoDescartadoComo: null });
    expect(estadoDelBulto(volverAPendiente(dejarEnCajas(DORITOS)))).toBe('pendiente');
  });

  it('un renglón sin «×N» no se toca', () => {
    const suelto = { cantidad: 10, precio: 2066.12, unidadesPorBulto: null };
    expect(yaEnUnidades(suelto)).toBe(suelto);
    expect(pasarAUnidades(suelto)).toBe(suelto);
    expect(estadoDelBulto(suelto)).toBeNull();
  });
});

describe('lo que muestra el renglón pendiente', () => {
  it('las dos cuentas, sin afirmar que son cajas', () => {
    expect(opcionesDelBulto(DORITOS)).toMatchObject({
      n: 14, talCual: { cantidad: 28, precio: 4899.65 }, convertido: { cantidad: 392, precio: 349.98 }, sugerida: null,
    });
  });
  it('con la sugerencia del lector y su porqué', () => {
    const o = opcionesDelBulto({ ...DORITOS, razonBulto: { sugerencia: 'convertir', evidencia: 'costo', motivo: '$55.000 ÷ 24 = …' } });
    expect(o).toMatchObject({ sugerida: 'convertir', motivo: '$55.000 ÷ 24 = …' });
  });
});

describe('cambiar el producto vinculado', () => {
  const decididoPorCosto = { ...yaEnUnidades(DORITOS), bultoAuto: true, razonBulto: { sugerencia: 'unidades', evidencia: 'costo', motivo: 'cuadra con el costo' } };
  it('lo que el lector decidió con el costo del producto anterior vuelve a preguntar', () => {
    const r = alCambiarVinculo(decididoPorCosto);
    expect(r).toMatchObject({ unidadesPorBulto: 14, bultoDescartado: null, razonBulto: null });
  });
  it('lo que probó el papel (la columna de bultos) no depende del producto', () => {
    const porColumna = { ...decididoPorCosto, razonBulto: { sugerencia: 'unidades', evidencia: 'columna', motivo: '2 × 14 = 28' } };
    expect(alCambiarVinculo(porColumna)).toBe(porColumna);
  });
  it('lo que eligió una persona se respeta; solo se borra la sugerencia vieja', () => {
    const aMano = { ...yaEnUnidades({ ...DORITOS, razonBulto: { sugerencia: 'unidades', evidencia: 'costo', motivo: 'x' } }) };
    expect(alCambiarVinculo(aMano)).toMatchObject({ bultoDescartado: 14, razonBulto: null });
  });
});

describe('variación del costo con la salida elegida', () => {
  // costo final del renglón: $4.899,65 × 1,29 (IVA y percepciones del pie de
  // esa factura: 629.465,94 / 487.958,09) = $6.320,70 contra $5.714,29
  const factor = 629465.94 / 487958.09;
  it('ya en unidades: +10,6%, no el "−93,9%" de antes', () => {
    expect(variacionDeCosto(4899.65 * factor, 5714.29)).toBeCloseTo(10.6, 1);
  });
  it('si alguien lo pasa a unidades por error, se ve: −92,1%', () => {
    expect(variacionDeCosto((4899.65 / 14) * factor, 5714.29)).toBeCloseTo(-92.1, 1);
  });
  it('sin costo de catálogo o sin cargo, no hay variación', () => {
    expect(variacionDeCosto(1000, null)).toBeNull();
    expect(variacionDeCosto(1000, 0)).toBeNull();
    expect(variacionDeCosto(0, 5714.29)).toBeNull();
  });
});

describe('pedir confirmación antes de una conversión que deja el costo por el piso', () => {
  const factor = 629465.94 / 487958.09;
  it('Doritos: $6.320,70 → $451,48 contra $5.714,29 → pregunta', () => {
    expect(conversionBajaDeMas(4899.65 * factor, 14, 5714.29)).toBe(true);
  });
  it('Coca de Noria (caja de 6 contra la lata): convertir acerca al costo → no pregunta', () => {
    expect(conversionBajaDeMas(8762.26 * 1.21, 6, 1663.52)).toBe(false);
  });
  it('sin costo de catálogo no pregunta', () => {
    expect(conversionBajaDeMas(6320.7, 14, null)).toBe(false);
  });
});
