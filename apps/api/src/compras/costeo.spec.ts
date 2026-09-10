import { calcularCosto, compararOfertas, impactoEnPrecio } from './costeo';

describe('costeo de compras — los errores que se hacen a mano', () => {
  it('los descuentos en cascada NO se suman: 10% + 5% da 14,5%, no 15%', () => {
    const r = calcularCosto({
      unidadesPorBulto: 1,
      bultos: 1,
      precioBulto: 1000,
      descuentosPct: [10, 5],
    });
    // 1000 → 900 → 855
    expect(r.costoUnitarioContado).toBe(855);
    expect(r.detalle.some((d) => d.includes('NO se suman'))).toBe(true);
  });

  it('la bonificación 10+2 baja el costo por unidad, no el precio de lista', () => {
    const r = calcularCosto({
      unidadesPorBulto: 6,
      bultos: 10,
      precioBulto: 60000,
      bonificacion: { paga: 10, gratis: 2 },
    });
    expect(r.unidadesPagadas).toBe(60); // 10 bultos x 6
    expect(r.unidadesRecibidas).toBe(72); // llegan 12 bultos
    // se pagan 600.000 por 72 unidades
    expect(r.costoUnitarioContado).toBeCloseTo(600000 / 72, 2);
  });

  it('el flete se reparte entre las unidades que LLEGAN, no las que se pagan', () => {
    const conBonif = calcularCosto({
      unidadesPorBulto: 1,
      bultos: 10,
      precioBulto: 1000,
      bonificacion: { paga: 10, gratis: 2 },
      flete: 1200,
    });
    // 12 unidades reciben el flete: $100 cada una
    expect(conBonif.fletePorUnidad).toBe(100);
    expect(conBonif.costoUnitarioContado).toBeCloseTo(10000 / 12 + 100, 2);
  });

  it('los impuestos internos por porcentaje son costo y se prorratean', () => {
    const r = calcularCosto({
      unidadesPorBulto: 1,
      bultos: 100,
      precioBulto: 500,
      impuestosInternosPct: 20,
    });
    // 50.000 de neto → 10.000 de internos → 100 por unidad
    expect(r.internosPorUnidad).toBe(100);
    expect(r.costoUnitarioContado).toBe(600);
  });

  it('el plazo de pago vale plata: a 60 días el costo de hoy es menor', () => {
    const contado = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000 });
    const aPlazo = calcularCosto({
      unidadesPorBulto: 1,
      bultos: 1,
      precioBulto: 1000,
      plazoDias: 60,
      tasaMensualPct: 5,
    });
    expect(contado.costoUnitarioReal).toBe(1000);
    // 1000 / (1 + 0.05*2) = 909,09
    expect(aPlazo.costoUnitarioReal).toBeCloseTo(909.09, 1);
    expect(aPlazo.ahorroPorPlazo).toBeGreaterThan(0);
  });

  it('compara ofertas con estructuras distintas y elige bien', () => {
    // A: más barata de lista pero sin plazo ni bonificación
    // B: más cara de lista, con bonificación 10+2 y 30 días
    const r = compararOfertas([
      { descripcion: 'Proveedor A', unidadesPorBulto: 6, bultos: 10, precioBulto: 50000 },
      {
        descripcion: 'Proveedor B',
        unidadesPorBulto: 6,
        bultos: 10,
        precioBulto: 55000,
        bonificacion: { paga: 10, gratis: 2 },
        plazoDias: 30,
        tasaMensualPct: 5,
      },
    ]);
    // A: 500.000/60 = 8.333 por unidad
    // B: 550.000/72 = 7.639 → a 30 días con 5% = 7.275
    expect(r.mejor).toBe('Proveedor B');
    expect(r.ofertas[0].costoUnitarioReal).toBeLessThan(r.ofertas[1].costoUnitarioReal);
  });

  it('avisa cuando el costo nuevo deja el precio vigente por debajo del costo', () => {
    const r = impactoEnPrecio({ costoNuevo: 1200, costoAnterior: 800, precioVigente: 1100, margenPct: 35 });
    expect(r.vendeBajoCosto).toBe(true);
    expect(r.precioSugerido).toBe(1600); // 1200 × 1,35 = 1.620 → redondeo de góndola 1.600
    expect(r.variacionCostoPct).toBe(50);
    expect(r.margenSiNoSeTocaPct).toBeLessThan(0);
  });

  it('un precio de bulto en cero no se calcula en silencio: avisa', () => {
    expect(() => calcularCosto({ unidadesPorBulto: 6, bultos: 1, precioBulto: 0 })).toThrow(
      /mayor a cero/i,
    );
  });
});

describe('ajuste de lista (aumento del proveedor)', () => {
  it('"sumale 29%" se aplica sobre la lista, antes de los descuentos', () => {
    const r = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, ajusteListaPct: 29 });
    expect(r.costoUnitarioContado).toBe(1290);
    expect(r.detalle.some((d) => d.includes('aumentada 29%'))).toBe(true);
  });

  it('el aumento y el descuento se encadenan en el orden correcto', () => {
    // 1000 → +29% = 1290 → -10% = 1161
    const r = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, ajusteListaPct: 29, descuentosPct: [10] });
    expect(r.costoUnitarioContado).toBe(1161);
  });
});

// La fórmula que Leandro le dio al analista el 10/9/2026 con la lista de
// Mosquita Muerta: "a la columna costo hay que dividirla por 1.21 y hacerla por
// 1.24. Al resultado hacerle un 10% de descuento". Sin estas operaciones el
// analista (que tiene prohibido hacer cuentas) no tenía cómo expresarla y se
// quedaba tres minutos trabado hasta terminar preguntando.
describe('la fórmula del comprador sobre la columna', () => {
  it('÷1,21 ×1,24 −10% sobre una caja de 6 a $63.000 da $9.684 la botella', () => {
    const r = calcularCosto({
      unidadesPorBulto: 6,
      bultos: 1,
      precioBulto: 63000,
      operacionesLista: [{ op: 'dividir', valor: 1.21 }, { op: 'multiplicar', valor: 1.24 }],
      descuentosPct: [10],
    });
    // 63.000 ÷ 1,21 = 52.066,12 → ×1,24 = 64.561,98 → −10% = 58.105,79 → ÷6
    expect(r.costoUnitarioContado).toBeCloseTo(9684.3, 1);
    expect(r.detalle.some((d) => d.startsWith('Dividido por 1.21'))).toBe(true);
    expect(r.detalle.some((d) => d.startsWith('Multiplicado por 1.24'))).toBe(true);
  });

  it('el orden importa y se respeta: primero la fórmula, después los descuentos', () => {
    const conFormula = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, operacionesLista: [{ op: 'multiplicar', valor: 2 }], descuentosPct: [50] });
    expect(conFormula.costoUnitarioContado).toBe(1000); // 1000 ×2 = 2000 −50% = 1000
  });

  it('se encadena con el ajuste de lista', () => {
    // 1000 +10% = 1100 ÷ 1,1 = 1000
    const r = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, ajusteListaPct: 10, operacionesLista: [{ op: 'dividir', valor: 1.1 }] });
    expect(r.costoUnitarioContado).toBeCloseTo(1000, 4);
  });

  it('un factor inválido frena con un mensaje claro, no con un número cualquiera', () => {
    expect(() => calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, operacionesLista: [{ op: 'dividir', valor: 0 }] })).toThrow(/factor inválido/);
    expect(() => calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, operacionesLista: [{ op: 'sumar' as any, valor: 2 }] })).toThrow(/operación desconocida/);
  });

  it('el aviso de "los descuentos no se suman" se calcula sobre el precio ya con la fórmula', () => {
    const r = calcularCosto({ unidadesPorBulto: 1, bultos: 1, precioBulto: 1000, operacionesLista: [{ op: 'multiplicar', valor: 2 }], descuentosPct: [10, 10] });
    // 2000 → 1800 → 1620: el descuento real es 19%, no 20%
    expect(r.detalle.some((d) => d.includes('19.00%'))).toBe(true);
  });
});
