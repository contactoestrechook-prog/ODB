import { marcaDelRenglon, marcaDistinta, mismaMarca, otraMarca } from './marca';

describe('la marca del renglón', () => {
  it('salta el tipo de producto: «Alfajor Jorgito…» es Jorgito', () => {
    expect(marcaDelRenglon('Alfajor Jorgito Chocolate Negro 18 x 6U')).toBe('jorgito');
    expect(marcaDelRenglon('Galletitas Trio besitos glaceadas x 300 gr')).toBe('trio');
    expect(marcaDelRenglon('Bocadito Ferrero Rocher T3 x 12.5grs.')).toBe('ferrero');
    expect(marcaDelRenglon('Knorr Risotto hongos')).toBe('knorr');
  });
  it('Distri Sur 9/11/2026: Jorgito no es Cachafaz ni Terrabusi', () => {
    expect(mismaMarca('Alfajor Jorgito Chocolate Negro 18 x 6U', 'Alfajor Cachafaz  Chocolate Negro x 6u')).toBe(false);
    expect(mismaMarca('Alfajor Jorgito Blanco Glaseado Tubo 18 x 6U', 'Alfajor Terrabusi Blanco glaseado x 6')).toBe(false);
    expect(mismaMarca('Alfajor Jorgito Chocolate Negro 18 x 6U', 'Alfajor Jorgito Tubo Chocolate x155gr')).toBe(true);
  });
  it('lo de siempre sigue: Knorr no es Gallo', () => {
    expect(mismaMarca('Knorr Risotto hongos', 'Arroz Gallo Risotto')).toBe(false);
    expect(mismaMarca('Vinagre Vino UNIDAD x 500 m.l. Menoyo', 'Vinagre Menoyo de vino x 500 cc')).toBe(true);
  });
});

// 19/11/2026: la pregunta de «Antes de registrar». Casos de los 172 «está bien»
// (del 10 al 19/11) y de los vínculos mal hechos que una persona corrigió.
describe('otra marca, para preguntar antes de registrar', () => {
  it('no pregunta por abreviaturas, plurales, una letra mal leída ni siglas', () => {
    const iguales: [string, string][] = [
      ['Garbanzo UNIDAD X 350grs. Inca', 'Garbanzos INCA  x lata 350g'],
      ['Nachos Rest. Style UNIDAD x 250gr. Macricas', 'Nachos Macritas  Extra Grandes 250grs'],
      ['MAY HELLMANNS LIVIANA DP 475G', 'Mayonesa Hellmans Liviana 475 gr'],
      ['GELAT EXQ CEREZA 25G', 'Gelatina Exquisita Cereza x 25g'],
      ['LECHE LS ULTRA ENTERA 3% FORT SACHET 1L', 'Leche La Serenisima 3% clasica  sachet  x 1lt'],
      ['LSNA YOGUR FIRME ENTERO 190G VAINILLA', 'Yogur La Serenisima Firme entero vainilla x 190 gr'],
      ['CTC- JUGO NARANJA X (1000 CC)', 'Jugo Citric Naranja x  1l'],
      ['PAPAS MCCAIN CRINKLE 600G', 'Papas fritas Mc Cain Crinkle x 600 gr'],
      ['Nutella UNIDAD x 140grs', 'Nutella x 140 gr'],
      ['Vinagre Vino UNIDAD x 500 m.l. Menoyo', 'Vinagre Menoyo de vino x 500 cc'],
    ];
    for (const [papel, producto] of iguales) expect([papel, otraMarca(papel, producto)]).toEqual([papel, false]);
  });
  it('sigue preguntando cuando es otra marca', () => {
    const distintos: [string, string, string][] = [
      ['Alfajor Jorgito Chocolate Negro 18 x 6U', 'Alfajor Cachafaz  Chocolate Negro x 6u', 'jorgito'],
      ['Alfajor Jorgito Blanco Glaseado Tubo 18 x 6U', 'Alfajor Terrabusi Blanco glaseado x 6', 'jorgito'],
      ['Knorr Risotto hongos', 'Arroz Gallo Risotto', 'knorr'],
      // la palabra de adelante es el tipo («Raviol», «Garbanzo»): lo que manda es lo que sigue
      ['LS- RAVIOL ESP/MOZZA/ PARMESANO TASTY X 450', 'Raviolones Furatti de Calabaza y Parmesano', 'esp'],
      ['Garbanzo UNIDAD X 350grs. Inca', 'Garbanzos Egran x 350g', 'inca'],
      // la sigla de la marca no vale si sale de otra palabra («LS» no dice «ligth»)
      ['MANTECA LS EXTRA PAQUETE 200 GR', 'Manteca LS ligth x 200gr', 'extra'],
    ];
    for (const [papel, producto, dice] of distintos) expect([papel, marcaDistinta(papel, producto)]).toEqual([papel, dice]);
  });
});

describe('las dos copias de la regla de marca', () => {
  it('el lector y el panel usan exactamente la misma', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    expect(readFileSync(join(__dirname, 'marca.ts'), 'utf8')).toBe(readFileSync(join(__dirname, '../../../admin/app/lib/marca.ts'), 'utf8'));
  });
});
