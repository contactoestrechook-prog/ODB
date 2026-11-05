// Cigarrillos (5/11/2026): las dos facturas de Grupo Modo que Ana no pudo
// cargar. El papel imprime por renglón Neto, Iva, Imp Int Uni, Precio Unit y
// Total; el pie trae Subtotal, IVA 21 %, Imp. Internos y Perc. IIBB.
import { renglonesDelPapel } from './internos-por-renglon';
import { internosImpresos, pctPercepciones } from '../../../admin/app/lib/internos-compras';

const suma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

describe('factura de cigarrillos: el renglón queda como dice el papel, con su neto y su interno aparte', () => {
  // 0005-00843292: Subtotal 69.658,20 · IVA 14.628,22 · Internos 245.113,90 · Perc. IIBB 15.738,61 · Total 345.138,93
  // columnas: cantidad · Neto · Imp Int Uni · Precio Unit · Total
  const papel292 = [[30, 715.42, 2517.91, 3383.57, 101507.12], [20, 1102.87, 3890.15, 5224.62, 104492.42], [20, 1306.91, 4588.68, 6170.04, 123400.78]];
  const leido = (filas: number[][], precioEs: 'unitario' | 'neto') =>
    filas.map(([cantidad, neto, interno, unitario, importe]) => ({ cantidad, precio: precioEs === 'unitario' ? unitario : neto, alicuotaIva: 21, impuestoInternoUnitario: interno, importe }));

  it('el precio y el total son los impresos; el neto suma el subtotal y los internos, el del pie', () => {
    const r = renglonesDelPapel(leido(papel292, 'unitario'))!;
    expect(r.map((x) => x!.precio)).toEqual([3383.57, 5224.62, 6170.04]);
    expect(r.map((x) => x!.importe)).toEqual([101507.12, 104492.42, 123400.78]);
    expect(r.map((x) => x!.netoDelPapel)).toEqual([715.42, 1102.87, 1306.91]);
    expect(suma(r.map((x, k) => papel292[k][0] * x!.netoDelPapel))).toBe(69658.2);
    expect(suma(r.map((x) => x!.internosDelPapel))).toBe(245113.9);
    // la parte neta del precio, que es lo que usa la pantalla para controlar el IVA
    expect(suma(r.map((x) => x!.importe * x!.fraccionNeta))).toBeCloseTo(69658.2, 0);
  });

  it('si el lector puso la columna Neto en el precio, igual queda el «Precio Unit» del papel', () => {
    const r = renglonesDelPapel(leido(papel292, 'neto'))!;
    expect(r.map((x) => x!.precio)).toEqual([3383.57, 5224.62, 6170.04]);
    expect(r.map((x) => x!.netoDelPapel)).toEqual([715.42, 1102.87, 1306.91]);
  });

  // 0005-00843293: cigarrillos y barras de cereal en la misma factura.
  // Subtotal 145.453,22 · IVA 30.545,18 · Internos 164.429,47 · Perc. IIBB 15.494,13 · Total 355.922,00
  const papel293 = [[10, 1102.87, 3890.15, 5224.62, 52246.21], [30, 1188.78, 4184.27, 5622.69, 168680.7], [2, 12913.25, 0, 15625.03, 31250.07], [2, 12913.25, 0, 15625.03, 31250.07], [2, 15495.9, 0, 18750.04, 37500.08], [1, 16116.32, 0, 19500.75, 19500.75]];

  it('en la factura mezclada, las barras también quedan con su precio del papel y solo los cigarrillos llevan interno', () => {
    const r = renglonesDelPapel(leido(papel293, 'unitario'))!;
    expect(r.map((x) => x!.precio)).toEqual(papel293.map((f) => f[3]));
    expect(suma(r.map((x, k) => papel293[k][0] * x!.netoDelPapel))).toBeCloseTo(145453.22, 0);
    expect(r.map((x) => x!.internosDelPapel)).toEqual([38901.5, 125528.1, 0, 0, 0, 0]);
  });

  it('una factura sin internos por renglón no se toca', () => {
    expect(renglonesDelPapel([{ cantidad: 6, precio: 1462.11, alicuotaIva: 21, impuestoInternoUnitario: 0, importe: 8772.66 }])).toBeNull();
    expect(renglonesDelPapel([{ cantidad: 6, precio: 1462.11, importe: 8772.66 }])).toBeNull();
  });

  it('un renglón que no se entiende queda como se leyó', () => {
    const r = renglonesDelPapel([...leido(papel292.slice(0, 1), 'unitario'), { cantidad: 3, precio: 500, impuestoInternoUnitario: 0, importe: 9999 }])!;
    expect(r[0]).not.toBeNull();
    expect(r[1]).toBeNull();
  });
});

describe('en la pantalla: los internos del papel van a su renglón y la percepción se reparte sobre neto + internos', () => {
  it('los internos impresos por renglón cierran con el pie: cada uno lleva el suyo', () => {
    const a: any = internosImpresos([75537.3, 77803, 91773.6], 245113.9)!;
    expect(a.estado).toBe('cierra');
    expect([...a.porIdx.entries()]).toEqual([[0, 75537.3], [1, 77803], [2, 91773.6]]);
  });
  it('en la mezclada, las barras no llevan nada y el redondeo del papel se ajusta al pie', () => {
    const a: any = internosImpresos([38901.5, 125528.1, 0, 0, 0, 0], 164429.47)!;
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
  it('el costo de un Lucky Cool 12 es el precio unitario del papel (3.383,57) más su parte de la percepción', () => {
    const pct = pctPercepciones(15738.61, 69658.2, 245113.9);
    const costo = 3383.57 + (715.42 + 2517.91) * pct;
    expect(Math.round(costo * 100) / 100).toBe(3545.23);
    // y los tres renglones juntos dan el total de la factura
    const total = [[30, 715.42, 2517.91], [20, 1102.87, 3890.15], [20, 1306.91, 4588.68]].reduce((s, [c, n, i]) => s + c * (n * (1.21 + pct) + i * (1 + pct)), 0);
    expect(Math.abs(total - 345138.93)).toBeLessThan(0.5);
  });
});
