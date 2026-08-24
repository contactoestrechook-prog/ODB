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
