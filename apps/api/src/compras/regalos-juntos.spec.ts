// LO SIN CARGO ENTRA JUNTO CON LO QUE SE PAGA (21/11/2026). Renglones reales de
// Distri-Sur: 00007-00060714 del 19/11 (lectura 18e53d5d, la que Anabella no pudo
// registrar: Nutella, Ferrero T12, T24 y T8 con su regalo) y 00007-00057487 del
// 9/11 (lectura 08d976fb: Ferrero T3 y T8, Maní sin renglón pago).
import { aplicarCambiosIA, aplicarPapel, cuentaDelPapel, entraDeRenglon, juntarRegalos, papelDeLectura, paresDeRegalo, regalosAlAbrir, separarRegalos, separarRenglon, sinCargoDe, tablaParaIA, unidadesDelPapel } from '../../../admin/app/lib/tabla-factura';
import { aplicarBorrador, borradorDe } from '../../../admin/app/lib/borrador-factura';
import { atribuirDescuentos, esRenglonDescuento } from '../../../admin/app/lib/descuentos-compras';

// un renglón como lo arma la pantalla al abrir la lectura (lo justo para la cuenta)
const fila = (descripcion: string, cantidad: number, precio: number, importe: number, extra: Record<string, unknown> = {}) => {
  const raw = { descripcion, cantidad, precio, importe, alicuotaIva: 21, ...extra };
  return { ...raw, sku: (extra.sku as string) ?? '', incluir: true, esDescuento: false, esDevolucion: false, papel: papelDeLectura(raw) } as Record<string, any>;
};
const descuento = (importe: number) => ({ descripcion: 'Descuento', cantidad: 1, precio: importe, importe, esDescuento: true, esDevolucion: false, papel: null, incluir: false } as Record<string, any>);
// el renglón ya decidido como cajas de N (así lo dejó el chat el 19/11 a las 12:38)
const enCajas = (f: Record<string, any>, n: number) => aplicarPapel(f, f.papel, { como: 'cajas', de: n });

const factura6071 = () => [
  fila('Alfajor Jorgito Chocolate Negro 18 x 6U', 1, 2255.68, 39384.17, { unidadesPorBulto: 18, bultos: 1, bonificacionPct: 3, sku: 'L426' }),
  fila('Nutella UNIDAD x 140grs', 2, 3455.23, 6910.46, { codigo: '4766U', sku: 'L140' }),
  descuento(-6910.46),
  fila('Nutella UNIDAD x 140grs', 8, 3455.23, 27641.84, { codigo: '4765U', sku: 'L140' }),
  enCajas(fila('Bocadito Ferrero Rocher T12 UNIDAD x 12.5grs', 12, 898.66, 10783.88, { sku: 'L3544' }), 12),
  descuento(-10783.88),
  enCajas(fila('Bocadito Ferrero Rocher T12 UNIDAD x 12.5grs', 60, 898.66, 53919.6, { sku: 'L3544' }), 12),
  enCajas(fila('Bocadito Ferrero Rocher T8 UNIDAD x 12.5grs', 6, 893.35, 5360.08, { sku: 'L4467' }), 8),
  descuento(-5360.08),
  enCajas(fila('Bocadito Ferrero Rocher T8 UNIDAD x 12.5grs', 42, 893.35, 37520.7, { sku: 'L4467' }), 8),
  fila('Nutella UNIDAD x 350grs', 6, 7622.79, 45736.74, { sku: 'L4344' }),
];

const juntarComoLaPantalla = (items: Record<string, any>[]) => {
  const { destinos } = atribuirDescuentos(items);
  return juntarRegalos(items, paresDeRegalo(items, destinos), esRenglonDescuento);
};
// lo que suma la factura: los renglones de mercadería menos las rebajas que caen sobre ellos
const netoDeLaFactura = (items: Record<string, any>[]) => {
  const { porIdx } = atribuirDescuentos(items);
  return items.reduce((s, f, k) => (esRenglonDescuento(f) ? s : s + Math.abs(Number(f.papel?.importe ?? f.importe ?? 0)) + (porIdx.get(k) ?? 0)), 0);
};

describe('juntarRegalos: lo sin cargo es más cantidad del mismo artículo, por la misma plata', () => {
  it('Ferrero T12 (19/11): 12 sin cargo + 60 pagas = 72 → 6 cajas de 12 a $8.986,60 c/u, el importe del pago no cambia', () => {
    const r = juntarComoLaPantalla(factura6071());
    const t12 = r.items[6];
    expect(cuentaDelPapel(t12.papel)).toMatchObject({ unidades: 72, cierra: true });
    expect(t12.papel.importe).toBe(53919.6);
    expect(t12.cantidad).toBe(6); // cajas
    const precioCaja = t12.precio * (1 - t12.bonificacionPct / 100);
    expect(precioCaja).toBeCloseTo(8986.6, 1);
    expect(sinCargoDe(t12)).toBe(12);
    // el regalo y su «Descuento» quedan en cero y juntados en el 7
    expect(r.items[4]).toMatchObject({ cantidad: 0, importe: 0, incluir: false, juntadoEn: 7 });
    expect(r.items[5]).toMatchObject({ importe: 0, precio: 0, juntadoEn: 7 });
  });

  it('Ferrero T8 (19/11): 6 + 42 = 48 → 6 cajas enteras de 8 (antes 0,75 + 5,25)', () => {
    const r = juntarComoLaPantalla(factura6071());
    const t8 = r.items[9];
    expect(cuentaDelPapel(t8.papel)).toMatchObject({ unidades: 48, cierra: true });
    expect(t8.cantidad).toBe(6);
    expect(t8.precio * (1 - t8.bonificacionPct / 100)).toBeCloseTo(37520.7 / 6, 1);
  });

  it('Nutella 140 (19/11): 2 sin cargo con OTRO código (4766U / 4765U) + 8 pagas = 10 unidades a $2.764,18', () => {
    const r = juntarComoLaPantalla(factura6071());
    const n = r.items[3];
    expect(n.cantidad).toBe(10);
    expect(n.precio * (1 - n.bonificacionPct / 100)).toBeCloseTo(27641.84 / 10, 1);
    expect(r.juntados.map((j) => [j.regalo + 1, j.en + 1])).toEqual([[2, 4], [5, 7], [8, 10]]);
  });

  it('la plata de la factura no cambia y las rebajas ya no caen sobre nada', () => {
    const antes = factura6071();
    const r = juntarComoLaPantalla(antes);
    expect(netoDeLaFactura(r.items)).toBeCloseTo(netoDeLaFactura(antes), 2);
    const despues = atribuirDescuentos(r.items);
    expect(despues.sinAtribuir).toEqual([]);
    expect([...despues.porIdx.values()].filter((v) => v !== 0)).toEqual([]);
  });

  it('lo que no tiene renglón pago queda como estaba (Maní del 9/11: 4 sin cargo y nada más)', () => {
    const items = [fila('Mani Frito Salado sin Piel x 100Grs. Mani King', 4, 760.585, 3042.34, { sku: 'L77' }), descuento(-3042.34), fila('Nutella UNIDAD x 350grs.', 6, 7622.79, 45736.74, { sku: 'L4344' })];
    const r = juntarComoLaPantalla(items);
    expect(r.juntados).toEqual([]);
    expect(r.noJuntados[0].porque).toMatch(/mismo artículo/);
    expect(r.items).toEqual(items);
  });

  it('el mismo producto vinculado al mismo precio, aunque el lector leyó mal la descripción (9/11: «T8» y «T3 UNIDAD» a $893,35, los dos «Ferrero x 8»)', () => {
    const items = [
      fila('Bocadito Ferrero Rocher T8 UNIDAD x 12.5grs', 4, 893.35, 3573.38, { sku: 'L4467' }), descuento(-3573.38),
      fila('Bocadito Ferrero Rocher T3 UNIDAD x 12.5grs', 60, 893.35, 53601, { sku: 'L4467' }),
    ].map((f) => (f.esDescuento ? f : enCajas(f, 8)));
    const r = juntarComoLaPantalla(items);
    expect(r.items[2].cantidad).toBe(8);
    expect(r.items[2].precio * (1 - r.items[2].bonificacionPct / 100)).toBeCloseTo(53601 / 8, 1);
  });

  it('otro precio NO es el mismo artículo: no se junta (T3 a $2.234 con T8 a $893)', () => {
    const items = [fila('Bocadito Ferrero Rocher T3 x 12.5grs.', 2, 2234.27, 4468.55, { sku: 'L3543' }), descuento(-4468.55), fila('Bocadito Ferrero Rocher T8 UNIDAD x 12.5grs', 60, 893.35, 53601, { sku: 'L3543' })];
    expect(juntarComoLaPantalla(items).juntados).toEqual([]);
  });

  it('el queso a $0 de La Serenísima no es un regalo de nadie: precio 0 no se junta', () => {
    const items = [fila('QUESO CREMON FRACC', 48, 0, 0, { sku: 'LQ' }), fila('QUESO CREMON FRACC', 10, 9000, 90000, { sku: 'LQ' })];
    expect(juntarComoLaPantalla(items).juntados).toEqual([]);
  });

  it('100 % de bonificación en el mismo renglón también es sin cargo', () => {
    const items = [fila('Alfajor X', 10, 100, 1000, { sku: 'A' }), fila('Alfajor X', 2, 100, 0, { sku: 'A', bonificacionPct: 100 })];
    const r = juntarComoLaPantalla(items);
    expect(r.juntados).toHaveLength(1);
    expect(r.items[0].cantidad).toBe(12);
    expect(cuentaDelPapel(r.items[0].papel).cierra).toBe(true);
  });

  it('Luigi Bosca 0175-00004531: 5 cajas pagas a precio de caja + 1 de regalo al 100 % (importe $0) = 6 cajas, no 5 + 6 botellas', () => {
    const items = [
      fila('LUIGI BOSCA DE SANGRE MALBEC ED.LIMITADA Caja 6x750ml', 5, 355041.3223, 683454.55, { unidadesPorBulto: 6, bonificacionPct: 61.5, sku: 'LB' }),
      fila('LUIGI BOSCA DE SANGRE MALBEC ED.LIMITADA Caja 6x750ml', 1, 355041.3223, 0, { unidadesPorBulto: 6, bonificacionPct: 100, sku: 'LB' }),
    ];
    // con importe $0 la lectura del regalo «cierra» como 1 bulto de 6: por eso se cuenta la columna Cantidad
    expect(items[1].papel).toMatchObject({ bultos: 1, uxb: 6 });
    const r = juntarComoLaPantalla(items);
    expect(r.juntados).toHaveLength(1);
    expect(r.items[0].papel).toMatchObject({ bultos: 0, sueltas: 6 });
    expect(cuentaDelPapel(r.items[0].papel).cierra).toBe(true);
    expect(sinCargoDe(r.items[0])).toBe(1);
    expect(r.items[0].papel.precio * (1 - r.items[0].papel.desc / 100)).toBeCloseTo(683454.55 / 6, 1);
  });

  it('Kaiken (Ley Seca): 2 pagas con 50 % + 2 de regalo = 4 botellas; el regalo puede estar arriba del pago', () => {
    const items = [
      fila('KAIKEN FRANKLY CABERNET FRANC 2021', 1, 343636.36, 0, { bonificacionPct: 100, sku: 'K' }),
      fila('KAIKEN FRANKLY CABERNET FRANC 2021', 4, 343636.36, 687272.72, { bonificacionPct: 50, sku: 'K' }),
    ];
    const r = juntarComoLaPantalla(items);
    expect(r.items[1].cantidad).toBe(5);
    expect(r.items[0]).toMatchObject({ juntadoEn: 2, cantidad: 0 });
  });

  it('si el renglón pago tenía su propia bonificación, se suman las dos (3 % + lo sin cargo)', () => {
    const items = [fila('Galletita Y 12 X 100', 2, 1000, 2000, { sku: 'G' }), descuento(-2000), fila('Galletita Y 12 X 100', 10, 1000, 9700, { sku: 'G', bonificacionPct: 3 })];
    const r = juntarComoLaPantalla(items);
    const g = r.items[2];
    expect(g.cantidad).toBe(12);
    expect(cuentaDelPapel(g.papel).cierra).toBe(true);
    expect(g.precio * (1 - g.bonificacionPct / 100)).toBeCloseTo(9700 / 12, 2);
  });

  it('Separar deja todo exactamente como estaba (desde el pago, desde el regalo o desde el «Descuento»)', () => {
    const antes = factura6071();
    const r = juntarComoLaPantalla(antes);
    const limpio = (xs: any[]) => JSON.parse(JSON.stringify(xs.map(({ regalos, antesDelRegalo, regaloJuntado, juntadoEn, antesDeJuntar, ...x }: any) => x)));
    const porElPago = separarRegalos(r.items, 6);
    expect(limpio(porElPago)[6]).toEqual(limpio(antes)[6]);
    expect(limpio(porElPago)[4]).toEqual(limpio(antes)[4]);
    expect(limpio(porElPago)[5]).toEqual(limpio(antes)[5]);
    expect(limpio(separarRenglon(r.items, 4))).toEqual(limpio(porElPago));
    expect(limpio(separarRenglon(r.items, 5))).toEqual(limpio(porElPago));
    // los otros regalos siguen juntos
    expect(porElPago[9].cantidad).toBe(6);
  });

  it('el chat junta y separa: «juntarEn» en el regalo (marcado por la pantalla con _regaloDe) y «juntarEn» vacío', () => {
    const items = factura6071().map((f, k) => (k === 7 ? { ...f, _regaloDe: 8 } : f));
    const junto = aplicarCambiosIA(items, [{ renglon: 8, campo: 'juntarEn', valor: 10 }], esRenglonDescuento);
    expect(junto.descartados).toEqual([]);
    expect(junto.items[9].cantidad).toBe(6);
    const separado = aplicarCambiosIA(junto.items, [{ renglon: 8, campo: 'juntarEn', valor: null }], esRenglonDescuento);
    expect(separado.items[9].cantidad).toBe(5.25);
    // un renglón que no es el mismo artículo no recibe el regalo
    const mal = aplicarCambiosIA(items, [{ renglon: 8, campo: 'juntarEn', valor: 11 }], esRenglonDescuento);
    expect(mal.descartados[0].porque).toMatch(/no es el mismo artículo/);
  });

  it('Ferrero T24 (19/11): el lector no leyó su «Descuento»; el chat pone 100 % e importe 0 y lo junta → 96 = 4 cajas de 24', () => {
    const items = [
      enCajas(fila('Bocadito Ferrero Rocher T24 UNIDAD x 12.5grs', 12, 843.54, 10122.51, { sku: 'L7484' }), 24),
      enCajas(fila('Bocadito Ferrero Rocher T24 UNIDAD x 12.5grs', 84, 843.54, 70857.36, { sku: 'L7484' }), 24),
    ];
    const r = aplicarCambiosIA(items, [
      { renglon: 1, campo: 'descuentoPct', valor: 100 },
      { renglon: 1, campo: 'importe', valor: 0 },
      { renglon: 1, campo: 'juntarEn', valor: 2 },
    ], esRenglonDescuento);
    expect(r.descartados).toEqual([]);
    expect(r.items[1].cantidad).toBe(4);
    expect(cuentaDelPapel(r.items[1].papel)).toMatchObject({ unidades: 96, cierra: true });
    expect(r.items[1].precio * (1 - r.items[1].bonificacionPct / 100)).toBeCloseTo(70857.36 / 4, 1);
    expect(r.items[0]).toMatchObject({ cantidad: 0, juntadoEn: 2 });
  });

  it('el renglón con regalos adentro no se junta como suma común (perdería lo sin cargo)', () => {
    const r = juntarComoLaPantalla(factura6071());
    const x = aplicarCambiosIA(r.items, [{ renglon: 11, campo: 'juntarEn', valor: 7 }], esRenglonDescuento);
    expect(x.descartados[0].porque).toMatch(/lo sin cargo/);
  });

  it('el chat ve el pago con «sinCargo» y el regalo y su descuento como juntados', () => {
    const r = juntarComoLaPantalla(factura6071());
    const tabla: any[] = tablaParaIA(r.items, esRenglonDescuento, () => null);
    expect(tabla[6]).toMatchObject({ unidades: 72, sinCargo: { unidades: 12, pagas: 60, deLosRenglones: [5, 6] } });
    expect(tabla[4]).toMatchObject({ juntadoEnElRenglon: 7 });
    expect(tabla[5]).toMatchObject({ descuento: true, juntadoEnElRenglon: 7 });
  });

  it('cómo entra se mantiene: en unidades sigue en unidades, en cajas sigue en cajas', () => {
    const r = juntarComoLaPantalla(factura6071());
    expect(entraDeRenglon(r.items[3], r.items[3].papel)).toEqual({ como: 'unidades' });
    expect(entraDeRenglon(r.items[6], r.items[6].papel)).toEqual({ como: 'cajas', de: 12 });
    expect(unidadesDelPapel(r.items[9].papel)).toBe(48);
  });
});

describe('regalosAlAbrir: el juntado y el borrador de la persona', () => {
  // abrir como la pantalla: lo leído, encima el borrador (si hay) y encima el juntado
  const abrir = (leido: Record<string, any>[], b: any) => {
    const filas = b ? aplicarBorrador(leido, {}, b).filas : leido;
    return regalosAlAbrir(filas, b, atribuirDescuentos(filas).destinos, esRenglonDescuento);
  };
  const entranDe = (items: Record<string, any>[], sku: string) =>
    items.filter((f) => f.sku === sku && f.incluir && !f.juntadoEn && !esRenglonDescuento(f)).reduce((s, f) => s + Number(f.cantidad), 0);

  it('abrir, pasar el T12 a cajas, guardar y volver a abrir: 6 cajas, nunca 6 + 1 (los 12 de regalo no se cuentan dos veces)', () => {
    const leido = factura6071().map((f) => (f.esDescuento ? f : aplicarPapel(f, f.papel, { como: 'unidades' })));
    const abierta = abrir(leido, null);
    expect(entranDe(abierta, 'L3544')).toBe(72);
    // la persona dice «van en cajas de 12» sobre el renglón juntado
    const enCajasYa = abierta.map((f, k) => (k === 6 ? aplicarPapel(f, f.papel, { como: 'cajas', de: 12 }) : f));
    expect(entranDe(enCajasYa, 'L3544')).toBe(6);
    const b = borradorDe(leido, enCajasYa, {}, {}, []);
    const otraVez = abrir(leido, b);
    expect(entranDe(otraVez, 'L3544')).toBe(6);
    expect(otraVez[4]).toMatchObject({ juntadoEn: 7, cantidad: 0 });
    expect(entranDe(otraVez, 'L4467')).toBe(48 / 1);
  });

  it('lo que la persona separó queda separado al volver a abrir', () => {
    const leido = factura6071();
    const abierta = abrir(leido, null);
    const separada = separarRegalos(abierta, 6);
    const b = borradorDe(leido, separada, {}, {}, [{ quien: 'Vos', renglon: 7, campo: 'sinCargo', antes: 'junto', despues: 'separado' }]);
    const otraVez = abrir(leido, b);
    expect(otraVez[4].juntadoEn ?? null).toBeNull();
    expect(otraVez[6].regalos ?? null).toBeNull();
    // los otros regalos siguen juntos
    expect(otraVez[9].regalos).toHaveLength(1);
  });

  it('un borrador de antes del arreglo que ya tocó la cuenta de esos renglones queda como lo dejó la persona', () => {
    const leido = factura6071();
    const b = { renglones: [{ renglon: 6, descripcion: leido[6].descripcion, campos: { cantidad: 5, envaseAplicado: 12 } }], pie: {}, cambios: [] };
    const otraVez = abrir(leido, b);
    expect(otraVez[4].juntadoEn ?? null).toBeNull();
    expect(otraVez[6].cantidad).toBe(5);
    // lo que no tocó, se junta
    expect(otraVez[9].regalos).toHaveLength(1);
  });

  it('un borrador con solo el margen o el producto no impide juntar', () => {
    const leido = factura6071();
    const b = { renglones: [{ renglon: 4, descripcion: leido[4].descripcion, campos: { margenPct: 40, sku: 'L3544' } }], pie: {}, cambios: [] };
    expect(abrir(leido, b)[6].regalos).toHaveLength(1);
  });
});
