// LA FORMA DEL PROVEEDOR (17/11/2026). Los renglones son reales: La Farina
// (remitos 0001-00000109 y 0001-00000116) y Tronador (Franui, 10/11).
import { decidir, fichaDeForma, fichaPorCuenta, fichasConForma, firmaDe, formaDe, salidaDe, filaLeida, cuentaParecida, type Antecedente } from '../../../admin/app/lib/forma-proveedor';
import { cambiosDeFicha, cambiosDeFichas } from '../../../admin/app/lib/ficha-articulo';
import { aplicarCambiosIA, papelDeLectura, vistaDelPapel } from '../../../admin/app/lib/tabla-factura';
import { esRenglonDescuento } from '../../../admin/app/lib/descuentos-compras';

const sinDecidir = (descripcion: string, cantidad: number, precio: number, uxb: number, sugerencia: string | null = null) => ({
  bultos: null, precio, importe: cantidad * precio, cantidad, alicuotaIva: null, descripcion, esDescuento: false,
  interpretado: { porPeso: false, cantidad, decision: 'bulto_pendiente', razonBulto: sugerencia ? { sugerencia, evidencia: 'costo', motivo: '' } : null, unidadesPorBulto: uxb },
  bonificacionPct: null, unidadesSueltas: null, unidadesPorBulto: uxb,
});
const decidido = (descripcion: string, cantidad: number, precio: number) => ({
  bultos: null, precio, importe: cantidad * precio, cantidad, alicuotaIva: null, descripcion, esDescuento: false,
  interpretado: { porPeso: false, cantidad, decision: 'cierra', razonBulto: null, unidadesPorBulto: null },
  bonificacionPct: null, unidadesSueltas: null, unidadesPorBulto: null,
});
/** el renglón como lo arma la pantalla al cargar la lectura */
const enPantalla = (i: any) => ({
  descripcion: i.descripcion, cantidad: i.interpretado.cantidad, porPeso: false, precio: i.precio, importe: i.importe,
  unidadesPorBulto: i.interpretado.unidadesPorBulto ?? null, razonBulto: i.interpretado.razonBulto ?? null,
  esDescuento: false, esDevolucion: false, devueltoAMano: false, papel: papelDeLectura(i),
});
const talCual = (i: any): Antecedente => ({ leido: i, registrado: { descripcion: i.descripcion, bultos: 0, unidadesPorBulto: i.unidadesPorBulto, sueltas: i.cantidad, entraComo: 'unidades', cantidadStock: i.cantidad, incluido: true, esDescuento: false } });
const abierto = (i: any): Antecedente => ({ leido: i, registrado: { descripcion: i.descripcion, bultos: 0, unidadesPorBulto: i.unidadesPorBulto, sueltas: i.cantidad, entraComo: 'abiertas', cantidadStock: i.cantidad * i.unidadesPorBulto, incluido: true, esDescuento: false } });

// La Farina, remito 109 (12/11): la persona dejó los tres «x N» tal cual
const panArabe = sinDecidir('Pan árabe clasico x 4 unidades', 24, 2154, 4);
const figacitasQueso = sinDecidir('Figacitas de manteca con queso x 9 unidades', 15, 3770, 9);
// La Farina, remito 116 (16/11): artículos que venían por primera vez
const figacita = sinDecidir('Figacita de manteca x 9 unidades', 24, 3490, 9, 'unidades');
const figaza = sinDecidir('Figaza de manteca x 6 unidades', 17, 3140, 6);
// Tronador (10/11): «FRANUI … CAJA X 24», la cantidad son cajas
const franuiAmargo = sinDecidir('FRANUI AMARGO CAJA X 24', 2, 115024, 24, 'convertir');
const franuiFree = sinDecidir('FRANUI FREE CAJA x24', 1, 115024, 24, 'convertir');
const franuiLeche = sinDecidir('FRANUI LECHE CAJA X 24', 2, 115024, 24, 'convertir');

describe('la forma del proveedor', () => {
  it('la firma: solo los renglones con «×N» que quedaron sin decidir', () => {
    expect(firmaDe(enPantalla(figacita))).toBe('sueltas');
    expect(firmaDe(enPantalla(decidido('Alfajorcitos de maicena', 16, 3450)))).toBeNull();
    expect(firmaDe({ ...enPantalla(figacita), porPeso: true })).toBeNull();
    expect(firmaDe({ ...enPantalla(figacita), devueltoAMano: true })).toBeNull();
  });

  it('qué pasó con un renglón al registrarlo', () => {
    expect(salidaDe(filaLeida(panArabe), talCual(panArabe).registrado)).toBe('tal_cual');
    expect(salidaDe(filaLeida(franuiAmargo), abierto(franuiAmargo).registrado)).toBe('abre');
    // llegó una parte (9 facturadas, entraron 8): la presentación es la misma
    const pepas = sinDecidir('Pepas x 6', 9, 3300, 6);
    expect(salidaDe(filaLeida(pepas), { ...talCual(pepas).registrado, cantidadStock: 8 })).toBe('tal_cual');
    // se registró como bultos × N (Logística Esteban Echeverría: 15 × 6 = 90)
    const ipa = sinDecidir('PATAGONIA IPA OW X6 730', 15, 9000, 6);
    expect(salidaDe(filaLeida(ipa), { descripcion: ipa.descripcion, bultos: 15, unidadesPorBulto: 6, sueltas: 0, entraComo: 'unidades', cantidadStock: 90, incluido: true, esDescuento: false })).toBe('abre');
    // no entró al stock: no se aprende nada
    expect(salidaDe(filaLeida(panArabe), { ...talCual(panArabe).registrado, incluido: false })).toBeNull();
    // por peso o con otra cantidad: no es ninguna de las dos
    expect(salidaDe(filaLeida(panArabe), { ...talCual(panArabe).registrado, entraComo: 'peso' })).toBe('otra');
  });

  it('La Farina: el artículo nuevo «x 9» entra tal cual, como los otros «x N» suyos', () => {
    const antes = [talCual(panArabe), talCual(figacitasQueso)];
    const forma = formaDe(antes);
    expect(forma.sueltas).toEqual({ talCual: 2, abre: 0, otra: 0 });
    expect(decidir(forma, 'sueltas')).toEqual({ salida: 'tal_cual', casos: 2, total: 2 });
    const fila = enPantalla(figacita);
    const ficha = fichaDeForma(fila, forma, 'La Farina');
    expect(ficha?.entraComo).toBe('unidades');
    expect(ficha?.porque).toContain('La Farina');
    const r = cambiosDeFicha(fila, ficha, 1, esRenglonDescuento as any);
    expect(r.estado).toBe('aplicada');
    const final = aplicarCambiosIA([fila], r.cambios, esRenglonDescuento as any).items[0];
    expect(final.cantidad).toBe(24); // 24 paquetes, no 216 figacitas
    expect(final.unidadesPorBulto ?? null).toBeNull(); // quedó decidido
    expect(r.cambios[0].motivo).toContain('tal cual');
  });

  it('Tronador: la caja nueva «X 24» se abre, como las otras', () => {
    const forma = formaDe([abierto(franuiAmargo), abierto(franuiFree)]);
    const fila = enPantalla(franuiLeche);
    const r = cambiosDeFicha(fila, fichaDeForma(fila, forma, 'TRONADOR'), 1, esRenglonDescuento as any);
    expect(r.estado).toBe('aplicada');
    const final = aplicarCambiosIA([fila], r.cambios, esRenglonDescuento as any).items[0];
    expect(final.cantidad).toBe(48); // 2 cajas de 24
    expect(Math.round(Number(final.precio) * 100) / 100).toBeCloseTo(115024 / 24, 1); // a precio de unidad
  });

  it('con un solo caso, o si el proveedor contestó de las dos maneras, no decide', () => {
    expect(decidir(formaDe([talCual(panArabe)]), 'sueltas')).toBeNull();
    // Distribuidora City: Gillette Venus X8 se abre y Mach 3 X2 entra tal cual
    const venus = sinDecidir('GILLETTE VENUS SIMPLY X8', 2, 20000, 8);
    const mach = sinDecidir('GILLETTE MACH 3 X2 SENSITIVE', 12, 5000, 2);
    const forma = formaDe([abierto(venus), talCual(mach)]);
    expect(decidir(forma, 'sueltas')).toBeNull();
    expect(fichaDeForma(enPantalla(figacita), forma, 'City')).toBeNull();
  });

  it('con seis o más artículos tolera uno distinto cada diez, no más', () => {
    const muchos = Array.from({ length: 10 }, (_, k) => talCual(sinDecidir(`Tapa x ${k + 2} unidades`, 10, 1000, k + 2)));
    expect(decidir(formaDe([...muchos, abierto(franuiAmargo)]), 'sueltas')?.salida).toBe('tal_cual'); // 10 de 11
    expect(decidir(formaDe([...muchos.slice(0, 6), abierto(franuiAmargo)]), 'sueltas')).toBeNull(); // 6 de 7
  });

  it('el mismo artículo vota una sola vez', () => {
    const forma = formaDe([talCual(panArabe), talCual(panArabe), talCual(panArabe)]);
    expect(forma.sueltas.talCual).toBe(1);
    expect(decidir(forma, 'sueltas')).toBeNull();
  });

  it('si el propio renglón muestra lo contrario (el costo del catálogo), no decide', () => {
    const forma = formaDe([talCual(panArabe), talCual(figacitasQueso)]);
    // el lector sugiere «convertir» porque el precio ÷ N cuadra con el costo: lo mira una persona
    const raro = enPantalla(sinDecidir('Budín x 12 unidades', 2, 60000, 12, 'convertir'));
    expect(fichaDeForma(raro, forma, 'La Farina')).toBeNull();
    const formaAbre = formaDe([abierto(franuiAmargo), abierto(franuiFree)]);
    expect(fichaDeForma(enPantalla(sinDecidir('Barra x 6', 12, 900, 6, 'unidades')), formaAbre, 'TRONADOR')).toBeNull();
  });

  it('en la factura: la ficha del artículo manda, y la forma completa lo que no tiene ficha', () => {
    const filas = [enPantalla(figacita), enPantalla(figaza), enPantalla(decidido('Alfajorcitos de maicena', 16, 3450))];
    const fichaPropia = { cuentaEn: 'sueltas' as const, unidadesPorBulto: 9, entraComo: 'unidades' as const, entraDe: null, factor: 1, porUnidad: 1, costoNeto: 3490, veces: 1, ultimaFactura: '0001-00000116', ultimaFecha: '2026-11-12' };
    const r = fichasConForma(filas, [fichaPropia, null, null], [talCual(panArabe), talCual(figacitasQueso)], 'La Farina');
    expect(r.fichas[0]).toBe(fichaPropia);
    expect(r.fichas[1]?.por).toBe('forma');
    expect(r.fichas[2]).toBeNull(); // ya venía decidido: no es pregunta de la forma
    expect(r.porForma).toEqual([2]);
    const c = cambiosDeFichas(filas, r.fichas, esRenglonDescuento as any);
    expect(c.aplicadas).toEqual([1, 2]);
    // sin antecedentes queda todo como antes
    expect(fichasConForma(filas, [null, null, null], [], 'La Farina').porForma).toEqual([]);
  });
});

// 18/11/2026, La Farina 0001-00000133, 11:03. La forma (4 de 4 «x N» tal cual) dejó
// «Medialunas de manteca cruda congelada x 144 unidades», 1 × $64.690, entrando
// como UNA unidad. Ana la pasó a 144 a mano. El control de publicar lo marcó.
describe('la costumbre vale para lo que se parece a lo que el proveedor ya mostró', () => {
  const chips = sinDecidir('Chips clasicos x 9 unidades', 24, 2480, 9);
  const medialunas = sinDecidir('Medialunas de manteca cruda congelada x 144 unidades', 1, 64690, 144);
  const forma = formaDe([talCual(panArabe), talCual(figacitasQueso), talCual(chips), talCual(figaza)]);

  it('la caja de 144 a $64.690 no es «otro paquete de los suyos»: no se decide', () => {
    expect(decidir(forma, 'sueltas')).toEqual({ salida: 'tal_cual', casos: 4, total: 4 });
    expect(fichaDeForma(enPantalla(medialunas), forma, 'La Farina')).toBeNull();
    expect(fichasConForma([enPantalla(medialunas)], [null], [talCual(panArabe), talCual(figacitasQueso), talCual(chips), talCual(figaza)], 'La Farina').porForma).toEqual([]);
  });
  it('un paquete nuevo parecido («x 9» a $3.230) sigue entrando solo', () => {
    const chipsQueso = sinDecidir('Chips con queso x 9 unidades', 15, 3230, 9);
    expect(fichaDeForma(enPantalla(chipsQueso), forma, 'La Farina')?.entraComo).toBe('unidades');
  });
  it('mira las dos cosas: cuántas trae y lo que sale la unidad', () => {
    const cuenta = (uxb: number, precio: number) => cuentaParecida(enPantalla(sinDecidir('Artículo nuevo', 1, precio, uxb)), 'sueltas', forma);
    expect(cuenta(12, 5000)).toEqual({ talCual: 4, abre: 0, otra: 0 });
    expect(cuenta(144, 3000)).toBeNull(); // trae 16 veces más que el más grande
    expect(cuenta(9, 64690)).toBeNull(); // sale 17 veces más que el más caro
    expect(cuenta(9, 300)).toBeNull(); // sale 7 veces menos que el más barato
  });
  it('la caja de 144, ya registrada abierta, no le saca la costumbre a los paquetes: cada cosa aprende de las suyas', () => {
    const conLaCaja = formaDe([talCual(panArabe), talCual(figacitasQueso), talCual(chips), talCual(figaza), abierto(medialunas)]);
    // mirada entera, la forma quedó de las dos maneras…
    expect(decidir(conLaCaja, 'sueltas')).toBeNull();
    // …pero un paquete nuevo «x 9» se compara con los paquetes
    const chipsQueso = sinDecidir('Chips con queso x 9 unidades', 15, 3230, 9);
    expect(fichaDeForma(enPantalla(chipsQueso), conLaCaja, 'La Farina')).toMatchObject({ entraComo: 'unidades', veces: 4 });
    // y otra caja de 144 todavía tiene un solo antecedente: la mira una persona
    const otraCaja = sinDecidir('Medialunas de grasa cruda congelada x 144 unidades', 1, 61000, 144);
    expect(fichaDeForma(enPantalla(otraCaja), conLaCaja, 'La Farina')).toBeNull();
    // con dos cajas registradas abiertas, la tercera se abre sola
    const dosCajas = formaDe([talCual(panArabe), talCual(figacitasQueso), abierto(medialunas), abierto(otraCaja)]);
    const tercera = sinDecidir('Medialunas saladas crudas congeladas x 144 unidades', 2, 63000, 144);
    expect(fichaDeForma(enPantalla(tercera), dosCajas, 'La Farina')).toMatchObject({ entraComo: 'abiertas', entraDe: 144 });
    // y los paquetes siguen entrando tal cual
    expect(fichaDeForma(enPantalla(chipsQueso), dosCajas, 'La Farina')).toMatchObject({ entraComo: 'unidades' });
  });
  it('si con artículos parecidos contestó de las dos maneras, sigue sin decidir', () => {
    const mezclado = formaDe([talCual(panArabe), talCual(figacitasQueso), abierto(sinDecidir('Budín x 6 unidades', 4, 14000, 6)), abierto(sinDecidir('Pan dulce x 6 unidades', 3, 15000, 6))]);
    expect(fichaDeForma(enPantalla(sinDecidir('Rosca x 6 unidades', 5, 3000, 6)), mezclado, 'La Farina')).toBeNull();
  });
  it('en los que se abren, lo que se compara es el precio de la unidad de adentro', () => {
    const formaAbre = formaDe([abierto(franuiAmargo), abierto(franuiFree)]);
    // otra caja x 24 al mismo precio: se abre igual
    expect(fichaDeForma(enPantalla(sinDecidir('FRANUI PISTACHO CAJA X 24', 3, 115024, 24)), formaAbre, 'TRONADOR')?.entraComo).toBe('abiertas');
    // una «caja x 24» de $3.000: cada unidad saldría $125 contra $4.793 de las otras
    expect(fichaDeForma(enPantalla(sinDecidir('SERVILLETAS X 24', 3, 3000, 24)), formaAbre, 'TRONADOR')).toBeNull();
  });
});

// 19/11/2026. Leandro: «en facturación todo lo que es cajas entra en sueltas; se
// lo explicamos y lo corrige, no lo aprende». Desde el 9/11, en 64 renglones de
// 14 proveedores el lector ya decía «son cajas» (el precio ÷ N cuadra con el
// costo del producto) y las 64 veces se registraron abiertas. Quedaban
// pendientes, la pantalla los mostraba como «Sueltas» y lo explicado se guardaba
// como regla de ESE proveedor.
describe('lo que la cuenta ya prueba: son cajas, en cualquier proveedor', () => {
  // Umami, 19/11 16:59 (primera factura de Umami): «LP EXPLORACION GEWURZTRAMINER
  // CAJA X 4», 2 × $92.340,89 contra el Gewurztraminer de catálogo a $17.867,96
  const prueba = { sugerencia: 'convertir', evidencia: 'costo', motivo: '$92.340,89 ÷ 4 = $23.085,22, que cuadra con el costo de catálogo ($17.867,96) de la unidad' };
  const conPrueba = (i: any, razon: any = prueba, sku = '40211') => ({ ...enPantalla({ ...i, interpretado: { ...i.interpretado, razonBulto: razon } }), sku, skuLeido: sku });
  const gewurz = sinDecidir('LP EXPLORACION GEWURZTRAMINER CAJA X 4', 2, 92340.89, 4);

  it('el renglón entra como 2 cajas que se abren: 8 botellas a precio de botella, y se ve «2 bultos a precio de bulto»', () => {
    const fila = conPrueba(gewurz);
    // antes: «Sueltas 2 · Precio u. $92.340»
    expect(vistaDelPapel(fila)).toMatchObject({ bultos: 0, sueltas: 2, precioPor: 'unidad' });
    const ficha = fichaPorCuenta(fila);
    expect(ficha).toMatchObject({ por: 'cuenta', entraComo: 'abiertas', entraDe: 4 });
    expect(ficha?.porque).toContain('Son cajas de 4');
    const r = cambiosDeFicha(fila, ficha, 1, esRenglonDescuento as any);
    expect(r.estado).toBe('aplicada');
    const final = aplicarCambiosIA([fila], r.cambios, esRenglonDescuento as any).items[0];
    expect(final.cantidad).toBe(8);
    expect(Number(final.precio)).toBeCloseTo(92340.89 / 4, 1);
    expect(vistaDelPapel(final)).toMatchObject({ bultos: 2, sueltas: 0, precioPor: 'bulto' });
  });

  it('decide sin saber el proveedor y sin antecedentes (era su primera factura)', () => {
    const filas = [conPrueba(gewurz), enPantalla(decidido('LP RVA DON JUAN x 3 lt MAGNUM 3000CC', 2, 100685.75))];
    const r = fichasConForma(filas, [null, null], [], null);
    expect(r.porCuenta).toEqual([1]);
    expect(r.porForma).toEqual([]);
    expect(cambiosDeFichas(filas, r.fichas, esRenglonDescuento as any).aplicadas).toEqual([1]);
  });

  it('Tronador: la primera caja de Franui ya entra sola, sin que nadie lo explique', () => {
    const fila = { ...enPantalla(franuiLeche), sku: 'f1', skuLeido: 'f1' };
    const final = aplicarCambiosIA([fila], cambiosDeFicha(fila, fichaPorCuenta(fila), 1, esRenglonDescuento as any).cambios, esRenglonDescuento as any).items[0];
    expect(final.cantidad).toBe(48);
  });

  it('la columna de bultos del papel también lo prueba', () => {
    const fila = conPrueba(gewurz, { sugerencia: 'convertir', evidencia: 'columna', motivo: 'el papel dice 2 bulto(s) y esa es la cantidad: son cajas de 4' });
    expect(fichaPorCuenta(fila)?.entraComo).toBe('abiertas');
    // aunque después se cambie el producto: la columna es del papel, no del catálogo
    expect(fichaPorCuenta({ ...fila, sku: 'otro' })?.entraComo).toBe('abiertas');
    // y el importe que solo cierra contando las de adentro (Distri-Sur, «Alfajor Jorgito X 24U», 19/11)
    const jorgito = sinDecidir('Alfajor Jorgito X 24U Choco Negro', 1, 737.91, 24);
    const porImporte = { ...enPantalla({ ...jorgito, importe: 1 * 24 * 737.91, interpretado: { ...jorgito.interpretado, razonBulto: { sugerencia: 'convertir', evidencia: 'importe', motivo: 'el importe solo cierra contando las 24 de cada caja' } } }), sku: 'a', skuLeido: 'a' };
    expect(fichaPorCuenta({ ...porImporte, sku: 'b' })).not.toBeNull();
    const final = aplicarCambiosIA([porImporte], cambiosDeFicha(porImporte, fichaPorCuenta(porImporte), 1, esRenglonDescuento as any).cambios, esRenglonDescuento as any).items[0];
    expect(final.cantidad).toBe(24);
  });

  it('si el producto cambió después de leer, la prueba del costo ya no vale', () => {
    expect(fichaPorCuenta({ ...conPrueba(gewurz), sku: '99999' })).toBeNull();
    expect(fichaPorCuenta({ ...conPrueba(gewurz), sku: '' })).toBeNull();
  });

  it('sin prueba no decide: la palabra «caja» sola no alcanza (Oxxon «Paty caja x 4» entra tal cual)', () => {
    const paty = sinDecidir('QF- PATY LIGHT CAJA X (4 UNID)', 6, 6045.74, 4);
    expect(fichaPorCuenta(enPantalla(paty))).toBeNull();
    expect(fichaPorCuenta(conPrueba(paty, { sugerencia: 'unidades', evidencia: 'costo', motivo: '' }))).toBeNull();
    expect(fichaPorCuenta(conPrueba(paty, { sugerencia: 'caja', evidencia: 'catalogo', motivo: '' }))).toBeNull();
    // ni lo que ya está decidido
    expect(fichaPorCuenta(enPantalla(decidido('Alfajorcitos de maicena', 16, 3450)))).toBeNull();
  });

  it('la ficha del propio artículo sigue mandando; la cuenta va antes que la costumbre del proveedor', () => {
    const filas = [conPrueba(gewurz), conPrueba(sinDecidir('Budín x 12 unidades', 2, 60000, 12))];
    const fichaPropia = { cuentaEn: 'sueltas' as const, unidadesPorBulto: 4, entraComo: 'abiertas' as const, entraDe: 4, factor: 4, porUnidad: 4, costoNeto: 23085, veces: 2, ultimaFactura: '0001-1', ultimaFecha: '2026-11-12' };
    // La Farina deja los «x N» tal cual, pero el budín prueba por el costo que es caja de 12
    const r = fichasConForma(filas, [fichaPropia, null], [talCual(panArabe), talCual(figacitasQueso)], 'La Farina');
    expect(r.fichas[0]).toBe(fichaPropia);
    expect(r.porCuenta).toEqual([2]);
    expect(r.fichas[1]).toMatchObject({ por: 'cuenta', entraComo: 'abiertas', entraDe: 12 });
  });
});
