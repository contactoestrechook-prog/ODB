// «NO APLICAR» QUIERE DECIR UNA SOLA COSA, Y LO QUE EL PAPEL NO COBRA NO ES UN
// RENGLÓN (18/11/2026). Caso real: Ricardo Nini 1200-00049128 del 16/11/2026.
// Quince productos (646.302,30 en la columna «total sin imp»), cinco renglones
// «Promocion NNNN» en cero debajo de los que están en oferta, y al final tres
// bonificaciones (−25.323,72). Subtotal 620.978,58 + IVA 128.875,67 +
// percepciones 31.048,93 y 18.410,81 = 799.313,99.
//
// Anabella: «las bonificaciones no van a ningún producto, es un descuento que
// nos queda a nosotros» y «no tomes los renglones que dicen promoción». Con las
// tres marcadas «no aplicar», la pantalla bajaba un 3,92 % el costo de TODO
// (el factor del pie) y además restaba las bonificaciones en la cuenta: no
// cerraba por $32.596. La regla vive en el panel (lib/descuentos-compras.ts y
// lib/lectura-compras.ts); se prueba acá, con las mismas piezas que usa la
// pantalla: el IVA por renglón, las percepciones y la cuenta.
import { netoDeRebajaNoAplicada, esRenglonDescuento, atribuirDescuentos } from '../../../admin/app/lib/descuentos-compras';
import { separarRenglonesSinNada, noEntregaNiCobra } from '../../../admin/app/lib/lectura-compras';
import { repartirIva } from '../../../admin/app/lib/iva-compras';
import { cargaDePercepciones } from '../../../admin/app/lib/percepciones-compras';
import { cuentaDeLaFactura, type ParteRenglon } from '../../../admin/app/lib/cuenta-factura';

// lo que leyó el lector (cantidad ya en unidades, como la deja interpretarRenglon)
const PRODUCTOS = [
  { descripcion: 'SWIFT pate de foie 24x90', cantidad: 24, precio: 940.89, importe: 22581.36, alicuotaIva: 21 },
  { descripcion: 'DOS ANCLAS c/especias 6x200', cantidad: 24, precio: 4237.89, importe: 101709.36, alicuotaIva: 21 },
  { descripcion: 'MENOYO vinag.alco.pvc. 12x1', cantidad: 24, precio: 1417.29, importe: 34014.96, alicuotaIva: 21 },
  { descripcion: 'CUMANA palmitos trozos 24x400', cantidad: 24, precio: 1440.79, importe: 34578.96, alicuotaIva: 21 },
  { descripcion: 'POZO vainillas 8x444', cantidad: 16, precio: 3073.09, importe: 49169.44, alicuotaIva: 21 },
  { descripcion: 'BAHIA palmitos enteros 24x400', cantidad: 24, precio: 3528.1, importe: 84674.4, alicuotaIva: 21 },
  { descripcion: 'CUMANA champ.entero 24x400', cantidad: 24, precio: 2676.29, importe: 64230.96, alicuotaIva: 21 },
  { descripcion: 'TODDY gal.chispas choc. 24x126', cantidad: 24, precio: 1737.39, importe: 41697.36, alicuotaIva: 21 },
  { descripcion: 'CUMANA champ.laminado 24x284', cantidad: 24, precio: 1821.79, importe: 43722.96, alicuotaIva: 21 },
  { descripcion: 'PUREZA harina 100% integr.10x1', cantidad: 10, precio: 1456.99, importe: 14569.9, alicuotaIva: 10.5 },
  { descripcion: 'ALICANTE coc.bsa.al&aj 10x30', cantidad: 20, precio: 2024.69, importe: 40493.8, alicuotaIva: 21 },
  { descripcion: 'DOS ANCLAS sal & ajo 6x200', cantidad: 12, precio: 3984.19, importe: 47810.28, alicuotaIva: 21 },
  { descripcion: 'CUMANA porotos 24x300', cantidad: 24, precio: 973.79, importe: 23370.96, alicuotaIva: 21 },
  { descripcion: 'ALICANTE sabor.fin.hier.1x10x4', cantidad: 20, precio: 1168.49, importe: 23369.8, alicuotaIva: 21 },
  { descripcion: 'ALICANTE sabor.alb./ajo 1x10x4', cantidad: 20, precio: 1015.39, importe: 20307.8, alicuotaIva: 21 },
];
const promo = (descripcion: string) => ({ descripcion, cantidad: '0', precio: '0', importe: '0', interpretado: { cantidad: 0 } });
const REBAJAS = [
  { descripcion: '15% DTO SWIFT PATE/PICADI. 90G - Promocion 0145993', cantidad: -1, precio: 3387.2, importe: -3387.2, descuentoPct: 15, esDescuento: true, alicuotaIva: 21 },
  { descripcion: '15% DES 1B MENOYO VIN ALC 1L - Promocion 0145853', cantidad: -1, precio: 5102.24, importe: -5102.24, descuentoPct: 15, esDescuento: true, alicuotaIva: 21 },
  { descripcion: '40% E/SDA ALICANTE ESP Y CONDI - Promocion 0145851', cantidad: -1, precio: 16834.28, importe: -16834.28, descuentoPct: 40, esDescuento: true, alicuotaIva: 21 },
];
// el orden del papel, como lo devolvió el lector (23 renglones)
const LEIDOS: any[] = [
  PRODUCTOS[0], promo('SWIFT pate de foie 24x90 - Promocion 0145993'), PRODUCTOS[1], PRODUCTOS[2], promo('MENOYO vinag.alco.pvc. 12x1 - Promocion 0145853'),
  ...PRODUCTOS.slice(3, 11), promo('ALICANTE coc.bsa.al&aj 10x30 - Promocion 0145851'), PRODUCTOS[11], PRODUCTOS[12],
  PRODUCTOS[13], promo('ALICANTE sabor.fin.hier.1x10x4 - Promocion 0145851'), PRODUCTOS[14], promo('ALICANTE sabor.alb./ajo 1x10x4 - Promocion 0145851'),
  ...REBAJAS,
];
const PIE = { neto: 620978.58, iva: 128875.67, percIva: 18410.81, percIibb: 31048.93, total: 799313.99 };

/**
 * La misma cuenta que hace la pantalla (ComprasWorkspace): cada renglón con su
 * neto (la rebaja sin aplicar, en negativo), el IVA repartido contra el pie,
 * el costo = neto × factor del pie × (1 + IVA + percepciones), y la cuenta de
 * la factura con lo que entra menos las rebajas que no se aplicaron.
 */
function cuentaComoLaPantalla(renglones: any[], { comoAntes = false } = {}) {
  const neto = (i: any) => (esRenglonDescuento(i) ? (comoAntes ? 0 : netoDeRebajaNoAplicada(i)) : i.cantidad * i.precio);
  const conIva = renglones.filter((i) => (esRenglonDescuento(i) ? neto(i) < 0 : neto(i) > 0));
  const iva = repartirIva(conIva.map((i) => ({ neto: neto(i), alicuotaImpresa: i.alicuotaIva })), { neto: PIE.neto, iva: PIE.iva, percepcionesAlCosto: PIE.percIva + PIE.percIibb, impuestosInternos: 0 });
  // como la pantalla: con el IVA que cierra o que no cierra por poco se costea igual (ivaConAlicuotas)
  if (iva.estado !== 'cierra' && iva.estado !== 'no_cierra') throw new Error(`sin IVA por renglón: ${iva.estado}`);
  const pct = cargaDePercepciones([{ nombre: 'IVA', monto: PIE.percIva }, { nombre: 'IIBB', monto: PIE.percIibb }], PIE.neto).pct;
  const factor = (i: any) => iva.factorNeto * (1 + iva.alicuotas[conIva.indexOf(i)] / 100 + pct);
  const partes: ParteRenglon[] = renglones
    .map((i, k) => ({ i, k }))
    .filter(({ i }) => !esRenglonDescuento(i))
    .map(({ i, k }) => ({ renglon: k + 1, descripcion: i.descripcion, tipo: 'entra' as const, valor: i.cantidad * i.precio * factor(i), unidades: i.cantidad }));
  // antes: la rebaja sin aplicar se restaba con el recargo promedio de la factura
  const sinAplicar = comoAntes
    ? renglones.filter((i) => i.noAplicar).reduce((s, i) => s + Math.abs(i.cantidad * i.precio), 0) * (PIE.total / PIE.neto)
    : renglones.filter((i) => esRenglonDescuento(i) && neto(i) < 0).reduce((s, i) => s + Math.abs(neto(i)) * factor(i), 0);
  const cuenta = cuentaDeLaFactura({ total: PIE.total, partes, descuentosNoAplicados: sinAplicar });
  const costoUnitario = (descripcion: string) => {
    const i = renglones.find((x) => x.descripcion === descripcion);
    return Math.round(i.precio * factor(i) * 100) / 100;
  };
  return { iva, pct, cuenta, costoUnitario };
}

describe('los renglones que el papel no entrega ni cobra', () => {
  it('Nini: los cinco «Promocion NNNN» en cero no se cargan; los productos y las bonificaciones sí', () => {
    const { renglones, sinNada } = separarRenglonesSinNada(LEIDOS);
    expect(sinNada.map((i: any) => i.descripcion)).toEqual([
      'SWIFT pate de foie 24x90 - Promocion 0145993',
      'MENOYO vinag.alco.pvc. 12x1 - Promocion 0145853',
      'ALICANTE coc.bsa.al&aj 10x30 - Promocion 0145851',
      'ALICANTE sabor.fin.hier.1x10x4 - Promocion 0145851',
      'ALICANTE sabor.alb./ajo 1x10x4 - Promocion 0145851',
    ]);
    expect(renglones).toHaveLength(18);
  });

  it('no deja afuera lo que sí es algo: un regalo, una rebaja, una devolución, una cantidad sin leer', () => {
    expect(noEntregaNiCobra({ cantidad: 1, precio: 0, importe: 0 })).toBe(false); // sin cargo: entra al stock
    expect(noEntregaNiCobra({ cantidad: 0, precio: 0, importe: -500, esDescuento: true })).toBe(false);
    expect(noEntregaNiCobra({ cantidad: 0, precio: 0, importe: 0, esDevolucion: true })).toBe(false);
    expect(noEntregaNiCobra({ cantidad: '', precio: 0, importe: 0 })).toBe(false); // no se leyó: se pregunta
    expect(noEntregaNiCobra({ cantidad: null, precio: null, importe: null })).toBe(false);
    expect(noEntregaNiCobra({ cantidad: 0, precio: 1200, importe: 0 })).toBe(false); // trae precio: que lo mire una persona
    expect(noEntregaNiCobra({ cantidad: 0, precio: 0, importe: 3400 })).toBe(false); // cobra algo
    expect(noEntregaNiCobra({ cantidad: '0', precio: '', importe: null })).toBe(true);
  });
});

describe('«no aplicar»: la mercadería a precio de lista y la rebaja una sola vez', () => {
  const sinPromos = separarRenglonesSinNada(LEIDOS).renglones;
  const noAplicadas = sinPromos.map((i: any) => (i.esDescuento ? { ...i, noAplicar: true } : i));

  it('Nini con las tres bonificaciones sin aplicar: el IVA da el del pie, el factor queda en 1 y la cuenta cierra', () => {
    const { iva, cuenta } = cuentaComoLaPantalla(noAplicadas);
    expect(iva.estado).toBe('cierra');
    if (iva.estado !== 'cierra') return;
    expect(iva.factorNeto).toBeCloseTo(1, 6);
    expect(Math.abs(iva.diferencia)).toBeLessThan(1);
    expect(cuenta.estado).toBe('cierra');
    expect(Math.abs(cuenta.diferencia!)).toBeLessThan(1);
    // la bonificación se resta una vez, con su IVA y su parte de percepciones
    const linea = cuenta.lineas.find((l) => l.clave === 'descuentos_no_aplicados')!;
    expect(linea.monto).toBeCloseTo(-25323.72 * (1.21 + 49459.74 / 620978.58), 0);
  });

  it('el costo de cada producto es el de lista: el paté no baja el 15 % ni los demás el 3,92 %', () => {
    const { pct, costoUnitario } = cuentaComoLaPantalla(noAplicadas);
    expect(costoUnitario('SWIFT pate de foie 24x90')).toBeCloseTo(940.89 * (1.21 + pct), 2);
    expect(costoUnitario('CUMANA porotos 24x300')).toBeCloseTo(973.79 * (1.21 + pct), 2);
    expect(costoUnitario('PUREZA harina 100% integr.10x1')).toBeCloseTo(1456.99 * (1.105 + pct), 2);
  });

  it('como era antes: la rebaja se repartía en todos los costos y la cuenta la restaba otra vez (no cerraba por ≈ $32.600)', () => {
    const antes = cuentaComoLaPantalla(noAplicadas, { comoAntes: true });
    if (antes.iva.estado !== 'cierra' && antes.iva.estado !== 'no_cierra') throw new Error('sin IVA');
    // el IVA de la rebaja también se repartía: el de los renglones daba ≈ $60 de más
    expect(Math.abs(antes.iva.diferencia)).toBeGreaterThan(50);
    expect(antes.iva.factorNeto).toBeCloseTo(620978.58 / 646302.3, 6);
    expect(antes.cuenta.estado).toBe('no_cierra');
    expect(antes.cuenta.diferencia!).toBeGreaterThan(32000);
    expect(antes.cuenta.diferencia!).toBeLessThan(33000);
  });

  it('solo cambia la rebaja que alguien marcó: la aplicada o la que no tiene destino valen 0 como renglón', () => {
    for (const r of REBAJAS) expect(netoDeRebajaNoAplicada(r)).toBe(0);
    expect(netoDeRebajaNoAplicada({ ...REBAJAS[0], noAplicar: true })).toBeCloseTo(-3387.2, 2);
    // si no se leyó cantidad × precio, vale su importe
    expect(netoDeRebajaNoAplicada({ descripcion: 'Bonif.', importe: -1500, esDescuento: true, noAplicar: true })).toBe(-1500);
    // un producto nunca es una rebaja sin aplicar
    expect(netoDeRebajaNoAplicada({ ...PRODUCTOS[0], noAplicar: true } as any)).toBe(0);
    // y sin «no aplicar» las tres de Nini siguen sin destino (bajan todo en proporción, como siempre)
    expect(atribuirDescuentos(sinPromos).sinAtribuir).toHaveLength(3);
  });
});
