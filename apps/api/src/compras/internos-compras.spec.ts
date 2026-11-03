// Impuestos internos solo a los productos que los pagan (3/11/2026). La regla
// vive en el panel (apps/admin/app/lib/internos-compras.ts); se prueba acá.
// Caso real: La Serenísima 06376-00001046, $7.148,01 de internos = 8,7 % de los
// dos bebibles de almendra. El panel los repartía entre los 42 renglones.
import { asignarInternos, puedeLlevarInternos, textoInternos } from '../../../admin/app/lib/internos-compras';
import { repartirIva } from '../../../admin/app/lib/iva-compras';

// los 42 renglones de la factura, como los leyó la IA (descripción e importe)
const SERENISIMA: [string, number][] = [
  ['LECHE LS ULTRA PARC.DESC 1% FORT SACH 1L', 47940], ['LECHE LS ULTRA ENTERA 3% FORT SACHET 1L', 47940],
  ['LECHE LS ULTRA DESC PROTEIN S1L', 24066.9], ['QUESO LS FINLANDIA RED.CALORIAS P290GR', 104162.4],
  ['QUESO LS FINLANDIA PROC.POTE 290GR', 69441.6], ['QUESO LS RALLADO BOLSA 130GR', 73476], ['QUESO LS RALLADO BOLSA 175GR', 89334],
  ['QUESO LS RALLADO SOBRE 70GR', 39240], ['QUESO LS FINL HEBRAS MOZZ/PARM SOB 130 G', 34344], ['QUESO LS FINL HEBRAS 4 QUESOS SOB 130 G', 34344],
  ['QUESO LS FINL HEBRAS CHEDDAR SOB 130 G', 34344], ['QUESO LS PROTEIN FRACC 500GR', 1.2], ['QUESO LS CREMON RED.CALORIAS FRACC500GR', 2.4],
  ['MOZZARELLA LS UNIDAD 500 GRS', 126608], ['QUESO LS DANBO SIN LACTOSA HORMA 3.5 KG', 0.6], ['QUESO LS GOUDA SIN LACTOSA FRACC 340GR', 2.4],
  ['DULCE DE LECHE LS COLONIAL POTE 400GR', 28339.2], ['DULCE DE LECHE LS REPOSTERO POTE 400GR', 29970], ['CREMA LS TETRA TOP 330 CC', 98982],
  ['CREMA LS CULINARIA TETRA TOP 330 CC', 94413.6], ['CREMA LS TETRA SQUARE 520 CC', 103392], ['MANTECA LS EXTRA PAQUETE 200 GR', 75913.5],
  ['MANTECA LS EXTRA PAQUETE 100 GR', 55760], ['MANTECA LS LIGHT PAQUETE 200GR', 56400], ['PREP.VEG.BEB. LS B\\ALMENDRA S\\A SQ 1L', 54774],
  ['PREP.VEG BEBIBLE LS ALMEND SAB CHO SQ 1L', 27387], ['CALSA LPF CLASICA 50GR.', 20074.4], ['LECHE CINDOR CHOCOLATADA BRIK 200CM3', 46866.24],
  ['LSNA YOGUR FIRME DESCREMADO 190G VAI', 31278.8], ['ACTIMEL ENTERO FS 100GR FRUTILLA', 84820.32], ['DANONINO BOTELLITA FS 185 GR FRUTILLA', 41623.02],
  ['YOGURISIMO NATURAL BIG POT 300 GR S/END', 80256.72], ['YOGURISIMO NATURAL BIG POT 300 GR ENDULZ', 80256.72], ['YOGURISIMO GRIEGO 125 GR FRUTILLA', 56894.64],
  ['YOGURISIMO GRIEGO SACHET 900 GR FRUTILLA', 32754.48], ['QUESO CREMA CASANCREM ENTERO VIT 290GR', 152250.12], ['QUESO CREMA CASANCREM VERDE FORT 290GR', 101500.08],
  ['DANETTE POSTRE FFS 190GR DULCE DE LECHE', 64471.68], ['DANETTE POSTRE FFS 190GR CHOCOLATE', 64471.68], ['FLAN SER FFS 190GR VAINILLA', 64781.64],
  ['POSTRE SER FFS 190GR DULCE DE LECHE', 43187.76], ['POSTRE SERENITO ROCKLETS 120G VAINILLA', 54551.6],
];
const renglones = SERENISIMA.map(([descripcion, neto]) => ({ descripcion, neto }));
const INTERNOS = 7148.01;
const pesos = (n: number) => `$${n.toFixed(2)}`;

describe('qué productos pueden pagar internos', () => {
  it('bebidas, alcohol, cerveza y tabaco sí; los lácteos no, aunque digan «chocolatada» o «bebible»', () => {
    expect(puedeLlevarInternos('PREP.VEG.BEB. LS B\\ALMENDRA S\\A SQ 1L')).toBe(true);
    expect(puedeLlevarInternos('PREP.VEG BEBIBLE LS ALMEND SAB CHO SQ 1L')).toBe(true);
    expect(puedeLlevarInternos('GASEOSA COCA COLA 2.25 L')).toBe(true);
    expect(puedeLlevarInternos('CERVEZA QUILMES LATA 473')).toBe(true);
    expect(puedeLlevarInternos('FERNET BRANCA 750')).toBe(true);
    expect(puedeLlevarInternos('LECHE LS ULTRA PARC.DESC 1% FORT SACH 1L')).toBe(false);
    expect(puedeLlevarInternos('LECHE CINDOR CHOCOLATADA BRIK 200CM3')).toBe(false);
    expect(puedeLlevarInternos('ACTIMEL ENTERO FS 100GR FRUTILLA')).toBe(false);
    expect(puedeLlevarInternos('DULCE DE LECHE LS COLONIAL POTE 400GR')).toBe(false);
  });
});

describe('a qué renglones van', () => {
  it('La Serenísima: los $7.148,01 son el 8,7 % de los dos bebibles de almendra, al centavo', () => {
    const a = asignarInternos(renglones, INTERNOS);
    expect(a.estado).toBe('cierra');
    if (a.estado !== 'cierra') return;
    expect(a.indices).toEqual([24, 25]);
    expect(a.tasa).toBe(8.7);
    expect(a.base).toBe(82161);
    expect(a.porIdx.get(24)).toBe(4765.34);
    expect(a.porIdx.get(25)).toBe(2382.67);
    // la leche no paga nada
    expect(a.porIdx.has(0)).toBe(false);
    expect(textoInternos(a, INTERNOS, pesos, (k) => k + 1)).toBe('Impuestos internos $7148.01: van a los renglones 25 y 26 (8,7 % sobre $82161.00, cierra al centavo). Los demás productos no los pagan.');
  });

  it('la leche vuelve a costar lo que cuesta: $1.818,26 (antes $1.822,51)', () => {
    const iva = repartirIva(renglones.map((r) => ({ neto: r.neto, alicuotaImpresa: 21 })), {
      neto: 2370618.7, iva: 497829.92, percepcionesAlCosto: 69680.36 + 118888.34, impuestosInternos: 0,
    });
    expect(iva.estado).toBe('cierra');
    if (iva.estado !== 'cierra') return;
    const leche = 1410 * iva.factorNeto * (1 + 0.21 + iva.cargaComunPct);
    expect(Math.round(leche * 100) / 100).toBe(1818.26);
    // el bebible de almendra sin azúcar (24 u. a $2.282,25 netos) suma sus internos
    const a = asignarInternos(renglones, INTERNOS);
    const porUnidad = a.estado === 'cierra' ? a.porIdx.get(24)! / 24 : 0;
    expect(Math.round(porUnidad * 100) / 100).toBe(198.56);
  });

  it('lo que marca una persona manda, y lo que descarta no se cuenta', () => {
    const marcado = renglones.map((r, k) => ({ ...r, marcado: k === 27 ? true : null }));
    const a = asignarInternos(marcado, INTERNOS);
    expect(a).toMatchObject({ estado: 'marcados', indices: [27] });
    if (a.estado === 'marcados') expect(a.porIdx.get(27)).toBe(INTERNOS);
    // si descartan uno de los dos bebibles, ya no cierra con nada: que decida una persona
    const descartado = renglones.map((r, k) => ({ ...r, marcado: k === 25 ? false : null }));
    expect(asignarInternos(descartado, INTERNOS)).toEqual({ estado: 'dudoso', candidatos: [24] });
  });

  it('sin productos que puedan pagarlos: no se reparten en todos, se avisa', () => {
    const lacteos = renglones.filter((r) => !/BEB/.test(r.descripcion));
    expect(asignarInternos(lacteos, INTERNOS)).toEqual({ estado: 'sin_destino' });
    expect(textoInternos({ estado: 'sin_destino' }, INTERNOS, pesos)).toMatch(/ningún renglón parece llevarlos/);
  });

  it('si no cierra con ninguna tasa, tampoco se adivina', () => {
    const a = asignarInternos(renglones, 7000);
    expect(a).toEqual({ estado: 'dudoso', candidatos: [24, 25] });
  });

  it('una factura sin internos no cambia nada', () => {
    expect(asignarInternos(renglones, 0)).toEqual({ estado: 'sin_internos' });
  });

  it('gaseosas al 8 % (8,6957 % sobre el neto) cierran igual', () => {
    const r = [{ descripcion: 'GASEOSA COCA COLA 2.25 L', neto: 100000 }, { descripcion: 'AGUA MINERAL 2L', neto: 30000 }, { descripcion: 'LECHE ENTERA', neto: 50000 }];
    const a = asignarInternos(r, 8695.65);
    expect(a).toMatchObject({ estado: 'cierra', indices: [0], tasa: 8.6957 });
  });
});
