// La ficha del artículo del proveedor (11/11/2026): cómo viene y cómo entra,
// según lo último que se registró. Los casos son de facturas reales del 3 al
// 10/11: lo que Anabella tuvo que explicarle al chat, renglón por renglón.
import { claveArticulo, fichaTrasRegistro, mismaPresentacion, presentacionDeRenglon } from './ficha-articulo';
import { cambiosDeFicha, cambiosDeFichas, cantidadDelPapel, type FichaArticulo } from '../../../admin/app/lib/ficha-articulo';
import { aplicarCambiosIA, papelDeLectura } from '../../../admin/app/lib/tabla-factura';

const nuncaDescuento = () => false;

/** Un renglón como lo arma la pantalla al cargar la lectura. */
const fila = (descripcion: string, cantidad: number, precio: number, importe: number, extra: Record<string, unknown> = {}) => {
  const raw = { descripcion, cantidad, precio, importe, ...extra };
  return {
    descripcion, cantidad, precio, importe, sku: 'SKU-1', incluir: true, porPeso: false,
    unidadesPorBulto: (extra.unidadesPorBulto as number | undefined) ?? null,
    papel: papelDeLectura(raw),
  } as Record<string, any>;
};
const ficha = (f: Partial<FichaArticulo>): FichaArticulo => ({
  cuentaEn: 'sueltas', unidadesPorBulto: null, entraComo: 'unidades', entraDe: null, factor: 1, porUnidad: 1, costoNeto: null,
  veces: 1, ultimaFactura: '0003-00012345', ultimaFecha: '2026-11-10', ...f,
});
const aplicar = (f: Record<string, any>, fi: FichaArticulo) => {
  const r = cambiosDeFicha(f, fi, 1, nuncaDescuento);
  const despues = aplicarCambiosIA([f], r.cambios, nuncaDescuento);
  return { ...r, final: despues.items[0], descartados: despues.descartados };
};

describe('claveArticulo: la descripción del papel, sin acentos ni signos', () => {
  it('la misma descripción leída con un punto o sin él es el mismo artículo', () => {
    expect(claveArticulo('EDULCORANTE LEDESMA SUCRA 100 UN.')).toBe(claveArticulo('Edulcorante Ledesma  Sucra 100 un'));
  });
  it('saca acentos y signos', () => {
    expect(claveArticulo('Bocadito Ferrero Rocher T3 x 12.5grs.')).toBe('BOCADITO FERRERO ROCHER T3 X 12 5GRS');
    expect(claveArticulo('Dátiles Medjoul CAJA X 5kg')).toBe('DATILES MEDJOUL CAJA X 5KG');
  });
  it('vacío no es un artículo', () => {
    expect(claveArticulo(null)).toBe('');
    expect(claveArticulo('  ')).toBe('');
  });
});

describe('presentacionDeRenglon: lo que se aprende de un renglón registrado', () => {
  it('Rhodesia, Rueda Que Rueda 10/11: 1 caja de 36 que entró como 12 paquetes de 3', () => {
    expect(presentacionDeRenglon({ bultos: 1, unidadesPorBulto: 36, sueltas: 0, entraComo: 'cajas', cantidadStock: 12, incluido: true }))
      .toMatchObject({ cuentaEn: 'bultos', unidadesPorBulto: 36, entraComo: 'cajas', entraDe: 3, factor: 12 });
  });
  it('Halls 12 × 28 g: la cantidad son paquetes y entran abiertos, 12 por paquete', () => {
    expect(presentacionDeRenglon({ bultos: 0, unidadesPorBulto: 12, sueltas: 5, entraComo: 'abiertas', cantidadStock: 60, incluido: true }))
      .toMatchObject({ cuentaEn: 'sueltas', unidadesPorBulto: 12, entraComo: 'abiertas', entraDe: 12, factor: 12, porUnidad: 12 });
  });
  it('Tufaro: BULT × UxB a precio por unidad → entran las unidades', () => {
    expect(presentacionDeRenglon({ bultos: 4, unidadesPorBulto: 12, sueltas: 0, entraComo: 'unidades', cantidadStock: 48, incluido: true }))
      .toMatchObject({ cuentaEn: 'bultos', unidadesPorBulto: 12, entraComo: 'unidades', entraDe: null, factor: 12, porUnidad: 1 });
  });
  it('Fuet de Oxxon: 30 unidades que son 3 cajas de 10', () => {
    expect(presentacionDeRenglon({ bultos: 0, unidadesPorBulto: 10, sueltas: 30, entraComo: 'cajas', cantidadStock: 3, incluido: true }))
      .toMatchObject({ entraComo: 'cajas', entraDe: 10, factor: 0.1 });
  });
  it('Danbo en horma, La Serenísima 5/11: 6 hormas que entraron como 21 kilos → 3,5 por horma', () => {
    expect(presentacionDeRenglon({ bultos: 0, sueltas: 6, entraComo: 'peso', cantidadStock: 21, incluido: true }))
      .toMatchObject({ cuentaEn: 'sueltas', unidadesPorBulto: null, entraComo: 'peso', entraDe: null, factor: 3.5 });
  });
  it('por peso leído del papel (columna de kilos): no hay factor que aplicar', () => {
    expect(presentacionDeRenglon({ bultos: null, sueltas: null, entraComo: 'peso', cantidadStock: 5.44, incluido: true }))
      .toMatchObject({ entraComo: 'peso', factor: null });
  });
  it('unidades sueltas: tal cual, aunque haya llegado una parte (Pronto Manzana: 36 facturadas, 28 llegaron)', () => {
    expect(presentacionDeRenglon({ bultos: 0, sueltas: 36, entraComo: 'unidades', cantidadStock: 28, incluido: true }))
      .toMatchObject({ entraComo: 'unidades', factor: 1 });
  });
  it('llegó una parte de algo que entra por caja: de lo que entró no se aprende; de lo facturado, sí', () => {
    const r = { bultos: 0, unidadesPorBulto: 10, sueltas: 30, entraComo: 'cajas', incluido: true };
    expect(presentacionDeRenglon({ ...r, cantidadStock: 2.3 })).toBeNull();
    expect(presentacionDeRenglon({ ...r, cantidadStock: 2.3, cantidadEntera: 3 })).toMatchObject({ entraDe: 10, factor: 0.1 });
  });
  it('guarda lo que costó cada unidad de stock: la Rhodesia, $27.883 la caja → $2.323,58 el paquete', () => {
    expect(presentacionDeRenglon({ bultos: 1, unidadesPorBulto: 36, sueltas: 0, entraComo: 'cajas', cantidadStock: 12, importe: 27883, incluido: true }))
      .toMatchObject({ porUnidad: 0.333333, costoNeto: 2323.5833 });
    // sin cargo no hay costo que guardar
    expect(presentacionDeRenglon({ sueltas: 4, entraComo: 'unidades', cantidadStock: 4, importe: 0, incluido: true })).toMatchObject({ costoNeto: null });
  });
  it('no se aprende de un descuento, una devolución, lo que no entró ni de bultos y sueltas mezclados', () => {
    expect(presentacionDeRenglon({ sueltas: 1, entraComo: 'unidades', cantidadStock: 1, incluido: true, esDescuento: true })).toBeNull();
    expect(presentacionDeRenglon({ sueltas: 2, entraComo: 'devolución', cantidadStock: -2, incluido: true })).toBeNull();
    expect(presentacionDeRenglon({ sueltas: 2, entraComo: 'solo precio', cantidadStock: 0, incluido: true })).toBeNull();
    expect(presentacionDeRenglon({ sueltas: 12, entraComo: 'unidades', cantidadStock: 12, incluido: false })).toBeNull();
    expect(presentacionDeRenglon({ bultos: 4, unidadesPorBulto: 8, sueltas: 4, entraComo: 'unidades', cantidadStock: 36, incluido: true })).toBeNull();
    expect(presentacionDeRenglon({ sueltas: 6, entraComo: null, cantidadStock: 6, incluido: true })).toBeNull();
  });
});

describe('fichaTrasRegistro: manda lo último; «veces» cuenta los registros seguidos que coinciden', () => {
  const horma = { cuentaEn: 'sueltas' as const, unidadesPorBulto: null, entraComo: 'peso' as const, entraDe: null, factor: 3.5, porUnidad: 3.5, costoNeto: null };
  const unidades = { cuentaEn: 'sueltas' as const, unidadesPorBulto: null, entraComo: 'unidades' as const, entraDe: null, factor: 1, porUnidad: 1, costoNeto: null };
  it('la primera vez vale 1; igual otra vez, 2', () => {
    expect(fichaTrasRegistro(null, horma).veces).toBe(1);
    expect(fichaTrasRegistro({ ...horma, veces: 1 }, { ...horma, factor: 3.501 }).veces).toBe(2);
  });
  it('el Danbo entró el 3/11 como unidades y el 5/11 por peso: queda por peso, y vuelve a contar desde 1', () => {
    expect(mismaPresentacion(unidades, horma)).toBe(false);
    expect(fichaTrasRegistro({ ...unidades, veces: 3 }, horma)).toEqual({ presentacion: horma, veces: 1 });
  });
});

describe('cambiosDeFicha: la factura siguiente entra como la última vez', () => {
  it('Rhodesia: «1 × $27.883» con 36 por caja → 12 paquetes a $2.323,59, sin que nadie lo explique', () => {
    const f = fila('RHODESIA 36 X 22G', 1, 27883, 27883, { unidadesPorBulto: 36 });
    expect(cantidadDelPapel(f.papel)).toBe(1);
    const r = aplicar(f, ficha({ cuentaEn: 'bultos', unidadesPorBulto: 36, entraComo: 'cajas', entraDe: 3, factor: 12, porUnidad: 1 / 3, costoNeto: 2300 }));
    expect(r.estado).toBe('aplicada');
    expect(r.descartados).toEqual([]);
    expect(r.final.cantidad).toBe(12);
    expect(r.final.precio).toBeCloseTo(2323.59, 2);
    expect(r.cambios[0].motivo).toContain('Como la última vez (factura 0003-00012345 del 10/11)');
  });
  it('Halls: 5 paquetes a $3.000 → 60 unidades a $250', () => {
    const f = fila('CARAMELOS HALLS MENTA 12 X 28G', 5, 3000, 15000, { unidadesPorBulto: 12 });
    const r = aplicar(f, ficha({ unidadesPorBulto: 12, entraComo: 'abiertas', entraDe: 12, factor: 12, porUnidad: 12, costoNeto: 240 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(60);
    expect(r.final.precio).toBe(250);
  });
  it('Halls sin el «12 ×» leído: la ficha pone lo que trae el paquete y lo abre', () => {
    const f = fila('CARAMELOS HALLS MENTA', 5, 3000, 15000);
    const r = aplicar(f, ficha({ unidadesPorBulto: 12, entraComo: 'abiertas', entraDe: 12, factor: 12, porUnidad: 12, costoNeto: 240 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(60);
  });
  it('Tufaro: 4 bultos × 12 a $1.000 la unidad se leían como 4 cajas → entran 48 unidades', () => {
    const f = fila('GALLETITAS X 12', 4, 1000, 48000);
    expect(f.papel).toMatchObject({ bultos: 4, uxb: 12, sueltas: 0 });
    const r = aplicar(f, ficha({ cuentaEn: 'bultos', unidadesPorBulto: 12, entraComo: 'unidades', factor: 12, porUnidad: 1, costoNeto: 980 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(48);
    expect(r.final.precio).toBe(1000);
  });
  it('Danbo en horma: 6 hormas → 21 kilos (los 3,5 kg están en la descripción)', () => {
    const f = fila('QUESO LS DANBO SIN LACTOSA HORMA 3.5 KG', 6, 0.1, 0.6);
    const r = aplicar(f, ficha({ entraComo: 'peso', factor: 3.5 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.porPeso).toBe(true);
    expect(r.final.cantidad).toBe(21);
  });
  it('un salame de peso variable no se adivina: 3 piezas no son siempre 1,70 kg', () => {
    const f = fila('SALAME MONTESANO X3', 3, 9000, 27000);
    expect(cambiosDeFicha(f, ficha({ entraComo: 'peso', factor: 0.5667 }), 1, nuncaDescuento)).toEqual({ estado: 'no_aplica', cambios: [] });
    // registrado igual dos veces, ya es fijo
    expect(cambiosDeFicha(f, ficha({ entraComo: 'peso', factor: 0.5, veces: 2 }), 1, nuncaDescuento).estado).toBe('aplicada');
  });
  it('Tufaro leído al revés (8 unidades con el «×8» pendiente, registrado como 1 bulto × 8): el costo dice que son 8, no 64', () => {
    const f = fila('MAY HELLMANNS CLAS DP X950G', 8, 2500, 20000, { unidadesPorBulto: 8 });
    expect(f.papel).toMatchObject({ bultos: 0, uxb: 8, sueltas: 8 });
    const r = aplicar(f, ficha({ cuentaEn: 'bultos', unidadesPorBulto: 8, entraComo: 'unidades', factor: 8, porUnidad: 1, costoNeto: 2400 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(8);
    expect(r.final.unidadesPorBulto).toBeNull(); // el bulto quedó decidido, ya no pregunta
  });
  it('Mantecol de Oxxon: «1 × $20.000» que la vez pasada fue 1 bulto × 40 a $500 → se abre la caja: 40 a $500', () => {
    const f = fila('GE- MANTECOL CUBANITO 40X10 GR', 1, 20000, 20000, { unidadesPorBulto: 40 });
    const r = aplicar(f, ficha({ cuentaEn: 'bultos', unidadesPorBulto: 40, entraComo: 'unidades', factor: 40, porUnidad: 1, costoNeto: 480 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(40);
    expect(r.final.precio).toBe(500);
  });
  it('Rhodesia sin el «36 ×» leído: la ficha pone lo que trae la caja y arma los paquetes de 3', () => {
    const f = fila('RHODESIA CLASICA x1 un', 1, 27883, 27883);
    const r = aplicar(f, ficha({ cuentaEn: 'bultos', unidadesPorBulto: 36, entraComo: 'cajas', entraDe: 3, factor: 12, porUnidad: 1 / 3, costoNeto: 2300 }));
    expect(r.estado).toBe('aplicada');
    expect(r.final.cantidad).toBe(12);
  });
  it('esta vez vinieron 4 unidades sueltas y no 4 bultos de 12: el costo lo dice y no se toca', () => {
    const f = fila('GALLETITAS X 12', 4, 1000, 4000);
    const fi = ficha({ cuentaEn: 'bultos', unidadesPorBulto: 12, entraComo: 'unidades', factor: 12, porUnidad: 1, costoNeto: 1000 });
    expect(cambiosDeFicha(f, fi, 1, nuncaDescuento)).toEqual({ estado: 'ya_estaba', cambios: [] });
    // sin un costo para comparar (la vez pasada vino sin cargo) no se puede saber cuál es: no se toca
    expect(cambiosDeFicha(f, { ...fi, costoNeto: null }, 1, nuncaDescuento)).toEqual({ estado: 'no_aplica', cambios: [] });
  });
  it('si el renglón no da el importe impreso, la ficha no lo tapa: queda como se leyó', () => {
    const f = fila('CARAMELOS HALLS MENTA 12 X 28G', 5, 3000, 14000, { unidadesPorBulto: 12 });
    expect(cambiosDeFicha(f, ficha({ unidadesPorBulto: 12, entraComo: 'abiertas', entraDe: 12, factor: 12, porUnidad: 12, costoNeto: 240 }), 1, nuncaDescuento))
      .toEqual({ estado: 'no_cierra', cambios: [] });
  });
  it('nunca una fracción: 25 unidades de algo que entra en cajas de 10 no son 2,5 cajas', () => {
    const f = fila('FUET X 10', 25, 900, 22500, { unidadesPorBulto: 10 });
    expect(cambiosDeFicha(f, ficha({ unidadesPorBulto: 10, entraComo: 'cajas', entraDe: 10, factor: 0.1, porUnidad: 0.1, costoNeto: 9000 }), 1, nuncaDescuento).estado).toBe('no_aplica');
  });
  it('lo que la lectura ya dejó bien no se toca', () => {
    const f = fila('FLAN SER FFS 190GR VAINILLA', 16, 1500, 24000);
    expect(cambiosDeFicha(f, ficha({}), 1, nuncaDescuento)).toEqual({ estado: 'ya_estaba', cambios: [] });
  });
  it('sin ficha, un descuento, una devolución o un renglón por peso que la ficha dice por unidad: nada', () => {
    const f = fila('ALGO', 2, 100, 200);
    expect(cambiosDeFicha(f, null, 1, nuncaDescuento).estado).toBe('sin_ficha');
    expect(cambiosDeFicha(f, ficha({}), 1, () => true).estado).toBe('no_aplica');
    expect(cambiosDeFicha({ ...f, esDevolucion: true }, ficha({}), 1, nuncaDescuento).estado).toBe('no_aplica');
    expect(cambiosDeFicha({ ...f, porPeso: true }, ficha({ entraComo: 'abiertas', entraDe: 6, factor: 6 }), 1, nuncaDescuento).estado).toBe('no_aplica');
  });
});

describe('cambiosDeFichas: toda la factura de una vez', () => {
  it('cada renglón con su ficha, numerados como los ve la persona', () => {
    const filas = [
      fila('FLAN SER FFS 190GR VAINILLA', 16, 1500, 24000),
      fila('RHODESIA 36 X 22G', 1, 27883, 27883, { unidadesPorBulto: 36 }),
      fila('CARAMELOS HALLS MENTA 12 X 28G', 5, 3000, 14000, { unidadesPorBulto: 12 }),
      fila('ARTICULO NUEVO', 3, 100, 300),
    ];
    const r = cambiosDeFichas(filas, [
      ficha({}),
      ficha({ cuentaEn: 'bultos', unidadesPorBulto: 36, entraComo: 'cajas', entraDe: 3, factor: 12, porUnidad: 1 / 3, costoNeto: 2300 }),
      ficha({ unidadesPorBulto: 12, entraComo: 'abiertas', entraDe: 12, factor: 12, porUnidad: 12, costoNeto: 240 }),
      null,
    ], nuncaDescuento);
    expect(r.yaEstaban).toEqual([1]);
    expect(r.aplicadas).toEqual([2]);
    expect(r.noCierran).toEqual([3]);
    expect(r.cambios.every((c) => c.renglon === 2)).toBe(true);
    const despues = aplicarCambiosIA(filas, r.cambios, nuncaDescuento);
    expect(despues.items[1].cantidad).toBe(12);
    expect(despues.items[0]).toBe(filas[0]);
  });
  it('si las listas no coinciden, no se toca nada', () => {
    expect(cambiosDeFichas([fila('A', 1, 1, 1)], [], nuncaDescuento).cambios).toEqual([]);
  });
});
