// Cigarrillos (5/11/2026): las dos facturas de Grupo Modo que Ana no pudo
// cargar. El papel imprime por renglón Neto, Iva, Imp Int Uni, Precio Unit y
// Total; el pie trae Subtotal, IVA 21 %, Imp. Internos y Perc. IIBB.
import { renglonesEnNeto } from './internos-por-renglon';
import { internosImpresos, pctPercepciones } from '../../../admin/app/lib/internos-compras';

const suma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe('factura de cigarrillos: cada renglón en neto, con su interno del papel', () => {
  // 0005-00843292: Subtotal 69.658,20 · IVA 14.628,22 · Internos 245.113,90 · Perc. IIBB 15.738,61 · Total 345.138,93
  const f292 = [
    { cantidad: 30, precio: 715.42, alicuotaIva: 21, impuestoInternoUnitario: 2517.91, importe: 101507.12 },
    { cantidad: 20, precio: 1102.87, alicuotaIva: 21, impuestoInternoUnitario: 3890.15, importe: 104492.42 },
    { cantidad: 20, precio: 1306.91, alicuotaIva: 21, impuestoInternoUnitario: 4588.68, importe: 123400.78 },
  ];

  it('con el precio leído de la columna Neto: los renglones suman el subtotal y los internos, el del pie', () => {
    const r = renglonesEnNeto(f292)!;
    expect(r.map((x) => x!.importe)).toEqual([21462.6, 22057.4, 26138.2]);
    expect(suma(r.map((x) => x!.importe))).toBe(69658.2);
    expect(suma(r.map((x) => x!.internosDelPapel))).toBe(245113.9);
    expect(r[0]!.importeImpreso).toBe(101507.12);
  });

  it('si el lector tomó «Precio Unit» (con todo adentro), se saca el neto y da lo mismo', () => {
    const r = renglonesEnNeto(f292.map((x, k) => ({ ...x, precio: [3383.57, 5224.62, 6170.04][k], alicuotaIva: 0 })))!;
    expect(r.map((x) => x!.precio)).toEqual([715.42, 1102.87, 1306.91]);
    expect(suma(r.map((x) => x!.importe))).toBe(69658.2);
    expect(r.every((x) => x!.alicuotaIva === 21)).toBe(true);
  });

  // 0005-00843293: cigarrillos y barras de cereal en la misma factura.
  // Subtotal 145.453,22 · IVA 30.545,18 · Internos 164.429,47 · Perc. IIBB 15.494,13 · Total 355.922,00
  const f293 = [
    { cantidad: 10, precio: 1102.87, alicuotaIva: 21, impuestoInternoUnitario: 3890.15, importe: 52246.21 },
    { cantidad: 30, precio: 1188.78, alicuotaIva: 21, impuestoInternoUnitario: 4184.27, importe: 168680.7 },
    { cantidad: 2, precio: 12913.25, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 31250.07 },
    { cantidad: 2, precio: 12913.25, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 31250.07 },
    { cantidad: 2, precio: 15495.9, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 37500.08 },
    { cantidad: 1, precio: 16116.32, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 19500.75 },
  ];

  it('en la factura mezclada, las barras también quedan en neto y solo los cigarrillos llevan interno', () => {
    const r = renglonesEnNeto(f293)!;
    expect(suma(r.map((x) => x!.importe))).toBe(145453.22);
    expect(r.map((x) => x!.internosDelPapel)).toEqual([38901.5, 125528.1, 0, 0, 0, 0]);
    expect(suma(r.map((x) => x!.internosDelPapel))).toBeCloseTo(164429.47, 0);
  });

  it('una factura sin internos por renglón no se toca', () => {
    expect(renglonesEnNeto([{ cantidad: 6, precio: 1462.11, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 8772.66 }])).toBeNull();
    expect(renglonesEnNeto([{ cantidad: 6, precio: 1462.11, importe: 8772.66 }])).toBeNull();
  });

  it('un renglón que ya estaba en neto, o que no se entiende, queda como se leyó', () => {
    const r = renglonesEnNeto([f292[0], { cantidad: 4, precio: 1000, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 4000 }, { cantidad: 3, precio: 500, impuestoInternoUnitario: 0, importe: 9999 }])!;
    expect(r[1]).toBeNull();
    expect(r[2]).toBeNull();
  });
});

describe('en la pantalla: los internos del papel van a su renglón y la percepción se reparte sobre neto + internos', () => {
  it('los internos impresos por renglón cierran con el pie: cada uno lleva el suyo', () => {
    const a = internosImpresos([75537.3, 77803, 91773.6], 245113.9)!;
    expect(a.estado).toBe('cierra');
    expect([...a.porIdx.entries()]).toEqual([[0, 75537.3], [1, 77803], [2, 91773.6]]);
  });
  it('en la mezclada, las barras no llevan nada y el redondeo del papel se ajusta al pie', () => {
    const a = internosImpresos([38901.5, 125528.1, 0, 0, 0, 0], 164429.47)!;
    expect(a.indices).toEqual([0, 1]);
    expect(suma([...a.porIdx.values()])).toBe(164429.47);
  });
  it('si lo impreso no da el interno del pie, no se usa (sigue la regla de siempre)', () => {
    expect(internosImpresos([1000, 2000], 245113.9)).toBeNull();
    expect(internosImpresos([0, 0], 500)).toBeNull();
    expect(internosImpresos([100], 0)).toBeNull();
  });
  it('la percepción de IIBB de Grupo Modo es el 5 % de neto + internos, en las dos facturas', () => {
    expect(pctPercepciones(15738.61, 69658.2, 245113.9)).toBeCloseTo(0.05, 5);
    expect(pctPercepciones(15494.13, 145453.22, 164429.47)).toBeCloseTo(0.05, 5);
    // sin internos es lo de siempre: percepciones sobre el neto
    expect(pctPercepciones(53530.38, 800707.62, 0)).toBeCloseTo(0.06685, 4);
    expect(pctPercepciones(100, 0, 0)).toBe(0);
  });
  it('el costo de un Lucky Cool 12 da lo que se paga: 3.383,57 del papel más su parte de la percepción', () => {
    const pct = pctPercepciones(15738.61, 69658.2, 245113.9);
    const costo = 715.42 * (1 + 0.21 + pct) + 2517.91 * (1 + pct);
    expect(Math.round(costo * 100) / 100).toBe(3545.23);
    // y los tres renglones juntos dan el total de la factura
    const total = [[30, 715.42, 2517.91], [20, 1102.87, 3890.15], [20, 1306.91, 4588.68]].reduce((s, [c, n, i]) => s + c * (n * (1.21 + pct) + i * (1 + pct)), 0);
    expect(Math.abs(total - 345138.93)).toBeLessThan(0.5);
  });
});
