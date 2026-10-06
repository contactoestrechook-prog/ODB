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

  it('«Multiplicar ×14»: × 14 la cantidad, ÷ 14 el precio (el importe no cambia)', () => {
    const r = pasarAUnidades(DORITOS);
    expect(r).toMatchObject({ cantidad: 392, precio: 349.98, importe: 137190.2, bultoAplicado: 14, unidadesPorBulto: null });
    expect(estadoDelBulto(r)).toBe('convertido');
    // deshacer devuelve el precio del papel tal cual (antes, 349,98 × 14 = 4.899,72)
    expect(volverABulto(r)).toMatchObject({ cantidad: 28, precio: 4899.65, unidadesPorBulto: 14, bultoAplicado: null });
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

// Revisión del 6/10/2026 (la misma tarde): lo que la tarjeta muestra y hace.
describe('las cuentas salen de lo que factura el renglón, no del precio del papel', () => {
  // Distri Sur: "Tostadas Gruesas Tosti Clásicas 12x200 Grs" 1 × $828,10 =
  // $9.639,07 (12 × 828,10 con 3% off). La API deja pendiente con "convertir"
  // (evidencia: el importe). Antes la tarjeta decía "12 a $69" y "1 a $828".
  const TOSTADAS = {
    descripcion: 'Tostadas Gruesas Tosti Clásicas 12x200 Grs', cantidad: 1, precio: 828.1, importe: 9639.07, bonificacionPct: 3,
    unidadesPorBulto: 12, bultoOrigen: 'texto', razonBulto: { sugerencia: 'convertir', evidencia: 'importe', motivo: 'el importe solo cierra contando las 12 de cada caja (con 3% de descuento)' },
  };

  it('tostadas: «Multiplicar» deja 12 a $803 y «Ya vienen en unidades» 1 a $9.639', () => {
    expect(opcionesDelBulto(TOSTADAS)).toMatchObject({
      sugerida: 'convertir', talCual: { cantidad: 1, precio: 9639.07 }, convertido: { cantidad: 12, precio: 803.26 },
    });
  });

  it('tostadas: multiplicar no divide un precio que ya era de la unidad, y deshacer vuelve igual', () => {
    const r = pasarAUnidades(TOSTADAS);
    expect(r).toMatchObject({ cantidad: 12, precio: 828.1, importe: 9639.07, bonificacionPct: 3, bultoAplicado: 12 });
    expect(volverABulto(r)).toMatchObject({ cantidad: 1, precio: 828.1, unidadesPorBulto: 12 });
  });

  it('Doritos: las cuentas no cambian (el importe es 28 × el precio)', () => {
    expect(opcionesDelBulto(DORITOS)).toMatchObject({ talCual: { cantidad: 28, precio: 4899.65 }, convertido: { cantidad: 392, precio: 349.98 } });
  });

  it('sin importe: el precio menos la bonificación', () => {
    expect(opcionesDelBulto({ cantidad: 3, precio: 55000, importe: null, bonificacionPct: 10, unidadesPorBulto: 24 })).toMatchObject({
      talCual: { cantidad: 3, precio: 49500 }, convertido: { cantidad: 72, precio: 2062.5 },
    });
  });
});

describe('la pregunta dice lo que dice el papel', () => {
  it('"la descripción dice" solo si el «×N» está en la descripción', () => {
    expect(opcionesDelBulto({ ...DORITOS, bultoOrigen: 'texto' })?.dice).toBe('La descripción dice');
    expect(opcionesDelBulto({ ...DORITOS, bultoOrigen: 'palabra' })?.dice).toBe('La descripción dice');
    // el 12 de una columna "U×B" (origen modelo) o de una lectura vieja
    expect(opcionesDelBulto({ ...DORITOS, bultoOrigen: 'modelo' })?.dice).toBe('El papel dice');
    expect(opcionesDelBulto(DORITOS)?.dice).toBe('El papel dice');
  });
  it('singular con 1, plural con más', () => {
    expect(opcionesDelBulto({ ...DORITOS, cantidad: 1, importe: 4899.65 })?.pregunta).toBe('¿El 1 del papel es una caja o una unidad?');
    expect(opcionesDelBulto(DORITOS)?.pregunta).toBe('¿Los 28 del papel son cajas o unidades?');
    expect(opcionesDelBulto({ ...DORITOS, cantidad: 1200, importe: 5879580 })?.pregunta).toBe('¿Los 1.200 del papel son cajas o unidades?');
  });
});

describe('«cambiar» lo que resolvió el lector', () => {
  const resueltoPorElLector = { ...yaEnUnidades(DORITOS), bultoAuto: true, razonBulto: { sugerencia: 'unidades', evidencia: 'costo', motivo: '$4.899,65 cuadra con el costo' } };
  it('vuelve a preguntar sin volver a sugerir en negrita lo que la persona acaba de negar', () => {
    const r = volverAPendiente(resueltoPorElLector);
    expect(estadoDelBulto(r)).toBe('pendiente');
    expect(r.razonBulto).toMatchObject({ sugerencia: null, rechazada: true, motivo: '$4.899,65 cuadra con el costo' });
    expect(opcionesDelBulto(r)).toMatchObject({ sugerida: null, rechazada: true });
  });
  it('lo que eligió una persona se deshace sin tocar la sugerencia', () => {
    const aMano = yaEnUnidades({ ...DORITOS, razonBulto: { sugerencia: 'unidades', evidencia: 'costo', motivo: 'x' } });
    expect(volverAPendiente(aMano).razonBulto).toMatchObject({ sugerencia: 'unidades' });
    expect((volverAPendiente(aMano).razonBulto as any).rechazada).toBeUndefined();
  });
});

describe('«ya en unidades» con el producto que es la caja: armar cajas', () => {
  const { conversionSugerida } = require('../../../admin/app/lib/presentacion');
  // Doritos leídos con la columna (2 bultos, 0 unidades = 28 sueltas) y
  // vinculados después a la caja de 14, sin costo cargado
  const DORITOS_CAJA = { descripcion: 'DORITOS QUESO 200GX14', nombreCatalogo: 'Doritos Queso 200g x14', cantidad: 28, precio: 4899.65, costoCatalogo: null };

  it('con la cantidad ya en unidades, ofrece 2 cajas aunque no haya costo con qué comprobarlo', () => {
    // sin saberlo no arma cajas (sin costo, y el papel no dice "unidad")
    expect(conversionSugerida(DORITOS_CAJA)?.tipo).not.toBe('unidades_a_envase');
    expect(conversionSugerida({ ...DORITOS_CAJA, cantidadEnUnidades: true })).toMatchObject({ tipo: 'unidades_a_envase', factor: 14, cantidadNueva: 2, precioNuevo: 68595.1 });
  });

  it('unidades sueltas no son kilos: "Doritos de Queso 200g" no se ofrece en paquetes de 200 g', () => {
    const suelto = { ...DORITOS_CAJA, nombreCatalogo: 'Doritos de Queso 200g' };
    expect(conversionSugerida(suelto)?.tipo).toBe('kilo_a_paquete'); // lo que pasaría sin la marca
    expect(conversionSugerida({ ...suelto, cantidadEnUnidades: true })).toBeNull();
  });

  it('con las cajas armadas, el renglón deja de decir "como dice el papel"; al deshacerlas, vuelve', () => {
    const decidido = { ...yaEnUnidades(DORITOS), bultoAuto: true };
    expect(estadoDelBulto({ ...decidido, cantidad: 2, precio: 68595.1, envaseAplicado: 14 })).toBeNull();
    expect(estadoDelBulto({ ...decidido, envaseAplicado: null })).toBe('ya_en_unidades');
  });
});
