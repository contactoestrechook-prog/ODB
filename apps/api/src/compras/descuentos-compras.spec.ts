// A qué renglón va cada rebaja de una factura de compra. La cuenta vive en el
// panel (apps/admin/app/lib/descuentos-compras.ts) porque se recalcula en vivo;
// se prueba acá porque la API es la que tiene los tests.
import { atribuirDescuentos, nombraAlRenglon } from '../../../admin/app/lib/descuentos-compras';

const merc = (descripcion: string, importe: number, cantidad = 1) => ({ descripcion, importe, cantidad, precio: importe / cantidad });
const desc = (descripcion: string, importe: number, descuentoPct: number | null = null) => ({ descripcion, importe, cantidad: 1, precio: 0, esDescuento: true, descuentoPct });

describe('nombraAlRenglon', () => {
  it('reconoce el nombre aunque cambien los espacios', () => {
    expect(nombraAlRenglon('Descuento - Mani Frito Salado sin Piel x100Grs. Mani King', 'Mani Frito Salado sin Piel x 100Grs. Mani King')).toBe(true);
  });
  it('no confunde productos distintos', () => {
    expect(nombraAlRenglon('Descuento - Mani Tostado sin Piel sin Sal x100Grs.', 'Mani Frito Salado sin Piel x 100Grs.')).toBe(false);
  });
});

describe('atribuirDescuentos — casos reales', () => {
  it('Distri Sur 0007-00044104 (8/9): la rebaja del maní frito va al maní frito aunque el lector escriba «x100Grs»', () => {
    const items = [
      merc('Bicarbonato de Sodio Chango 1 sobre x 50 grs', 28250.5, 25),
      merc('Nutella UNIDAD x 350grs.', 40475.04, 6),
      merc('Durazno en Mitades UNIDAD X 820Grs. Inca', 30822.12, 12),
      merc('Mani Frito Salado sin Piel x 100Grs. Mani King', 1521.17, 2),
      desc('Descuento - Mani Frito Salado sin Piel x100Grs. Mani King', -1521.17),
    ];
    const r = atribuirDescuentos(items);
    expect(r.destinos.get(4)).toEqual({ renglon: 3, motivo: 'nombre' });
    expect(r.porIdx.get(3)).toBeCloseTo(-1521.17, 2);
    expect(r.porIdx.has(0)).toBe(false);
    expect(r.grupos.size).toBe(0);
  });

  it('Distri Sur 00007-00049764 (1/10): los seis «Descuento» a secas son el regalo del renglón de arriba', () => {
    // [descripción, importe] tal como la leyó un lector que no repite el nombre
    const filas: [string, number][] = [
      ['Besitos Glaseados 10 X 300 Grs. Trio', 9919.22], ['Palmera 18 X 150Grs. Hojalmar', 26251.16], ['Azafran Alicante Blister 2U x 2Grs.', 56116.44],
      ['Frolitas 12 X 300Grs. Trio', 11903.06], ['Choco-Van Lit.20 X 130Grs. For-Van', 13926.83], ['Nutella UNIDAD x 140grs.', 3057.73], ['Descuento', -3057.73],
      ['Pepas 10 X 500Grs. Trio', 28338], ['Nutella UNIDAD x 350grs.', 40475.04], ['Cafe Instan Clas/Esp Inst UNIDAD X 100Grs.', 23687.7],
      ['Arrocitas Prem. Sin Sal 12 X 101Grs.', 10349.94], ['Bizcocho Don Satur Grasa Uni X 200Grs.', 49357.2], ['Bocadito Ferrero Rocher T12 UNIDAD', 9929.93], ['Descuento', -9929.93],
      ['Bocadito Ferrero Rocher T12 UNIDAD', 49649.4], ['Bocadito Ferrero Rocher T24 UNIDAD', 9160.61], ['Descuento', -9160.61],
      ['Bocadito Ferrero Rocher T24 UNIDAD', 64123.92], ['Bocadito Ferrero Rocher T3 UNIDAD Blister x16U', 70094.82], ['Bocadito Ferrero Rocher T8 UNIDAD', 3292.22], ['Descuento', -3292.22],
      ['Bocadito Ferrero Rocher T8 UNIDAD', 23045.4], ['Donuts Blanca Un X 52Grs. Bonafide', 26417.28], ['Mini Arrocitas chocolate 12 x53Gr', 12499.17], ['Nutella B-Ready T1 UNIDAD', 8340.63], ['Descuento', -8340.63],
      ['Pepa 12 X 320Grs. Trio', 21761.84], ['Raffaello T3 x12.5Gr', 7053.02], ['Descuento', -7053.02], ['Raffaello T3 x12.5Gr', 21159.12], ['Nutella B-Ready T1 UNIDAD', 75065.76],
    ];
    const items = filas.map(([d, imp]) => (imp < 0 ? desc(d, imp) : merc(d, imp)));
    const r = atribuirDescuentos(items);
    const regalos = [...r.destinos.entries()].map(([j, x]) => [j, x.renglon, x.motivo]);
    expect(regalos).toEqual([[6, 5, 'regalo'], [13, 12, 'regalo'], [16, 15, 'regalo'], [20, 19, 'regalo'], [25, 24, 'regalo'], [28, 27, 'regalo']]);
    expect(r.grupos.size).toBe(0);
    expect(r.sinAtribuir).toEqual([]);
    // nadie más recibe rebaja: las galletitas quedan a su precio
    expect([...r.porIdx.keys()].sort((a, b) => a - b)).toEqual([5, 12, 15, 19, 24, 27]);
  });

  it('una rebaja con % que nombra su renglón sigue yendo a ese renglón (MANOS NEGRAS 42,86%)', () => {
    const items = [merc('Cerveza Corona 355', 50000, 24), merc('MANOS NEGRAS Malbec CJ x6', 305454.55, 7), desc('Desc. 42.86% - MANOS NEGRAS Malbec CJ x6', -130917.82, 42.86)];
    const r = atribuirDescuentos(items);
    expect(r.destinos.get(2)).toEqual({ renglon: 1, motivo: 'nombre' });
  });

  it('un descuento de grupo se sigue repartiendo entre los renglones de arriba (Px mágico 17,2%)', () => {
    const items = [merc('Coca Cola 600ml x 6', 30000), merc('Sprite 354ml x 6', 15055), desc('Px mágico $12.000 MP = 17.2%', -7749.46, 17.2)];
    const r = atribuirDescuentos(items);
    expect(r.destinos.size).toBe(0);
    expect(r.grupos.get(2)).toEqual({ n: 2, pct: 17.2, importe: 7749.46 });
    expect(r.porIdx.get(0)! + r.porIdx.get(1)!).toBeCloseTo(-7749.46, 2);
  });

  it('igual al renglón de arriba pero con un % que no es 100: no es un regalo', () => {
    const items = [merc('Agua 2L', 1000), merc('Agua 500ml', 1000), desc('Promo agua 50%', -1000, 50)];
    const r = atribuirDescuentos(items);
    expect(r.destinos.size).toBe(0);
    expect(r.grupos.get(2)?.n).toBe(2);
  });

  it('una rebaja más grande que todo lo de arriba no se aplica y se avisa', () => {
    const r = atribuirDescuentos([merc('Yerba 1kg', 5000), desc('Descuento', -9000)]);
    expect(r.porIdx.size).toBe(0);
    expect(r.sinAtribuir).toEqual([{ descripcion: 'Descuento', importe: 9000 }]);
  });

  it('la que el operador marcó «No aplicar» no se aplica', () => {
    const r = atribuirDescuentos([merc('Nutella UNIDAD x 140grs.', 3057.73), { ...desc('Descuento', -3057.73), noAplicar: true }]);
    expect(r.porIdx.size).toBe(0);
    expect(r.destinos.size).toBe(0);
  });
});
