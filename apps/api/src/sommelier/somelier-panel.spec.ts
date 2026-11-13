// El Somelier del panel (13/11/2026): el tipo de cada vino, lo que se entiende
// de lo que escribe el vendedor y el orden de la cava. La lógica del panel vive
// en apps/admin/app/lib/somelier.ts.
import { nombreDeSucursal, tipoDeCategoria } from './cava';
import {
  SIN_FILTROS, enPalabras, interpretar, ordenar, pasa, pedidoDeFiltros, sumarFiltros, textoParaCliente,
  type Filtros, type VinoCava,
} from '../../../admin/app/lib/somelier';

describe('tipoDeCategoria', () => {
  it('lee tipo y cepa de las categorías reales', () => {
    expect(tipoDeCategoria('Vinos Tintos Malbec')).toEqual({ tipo: 'tinto', cepa: 'Malbec', dulce: false });
    expect(tipoDeCategoria('Vinos Tintos  Cabernet Sauvignon')).toEqual({ tipo: 'tinto', cepa: 'Cabernet Sauvignon', dulce: false });
    expect(tipoDeCategoria('Vinos Blancos Torrontes')).toEqual({ tipo: 'blanco', cepa: 'Torrontés', dulce: false });
    expect(tipoDeCategoria('Vinos Blancos Viogner')).toEqual({ tipo: 'blanco', cepa: 'Viognier', dulce: false });
    expect(tipoDeCategoria('Vinos Rosados')).toEqual({ tipo: 'rosado', cepa: null, dulce: false });
    expect(tipoDeCategoria('Espumantes Extra Brut')).toEqual({ tipo: 'espumante', cepa: 'Extra Brut', dulce: false });
    expect(tipoDeCategoria('Espumante Importado')).toEqual({ tipo: 'espumante', cepa: 'Importado', dulce: false });
    expect(tipoDeCategoria('Espumantes Rose')).toEqual({ tipo: 'espumante', cepa: 'Rosé', dulce: false });
  });
  it('los dulces van aparte y sin cepa', () => {
    expect(tipoDeCategoria('Vinos Blancos Dulces')).toEqual({ tipo: 'blanco', cepa: null, dulce: true });
    expect(tipoDeCategoria('Espumantes Dulces')).toEqual({ tipo: 'espumante', cepa: null, dulce: true });
  });
  it('lo que no dice el tipo queda en «otro»', () => {
    expect(tipoDeCategoria('Vinos Importados').tipo).toBe('otro');
    expect(tipoDeCategoria('Vinos').tipo).toBe('otro');
    expect(tipoDeCategoria(null).tipo).toBe('otro');
  });
  it('el nombre de la sucursal sin «Suc» y con tilde', () => {
    expect(nombreDeSucursal('Suc Santa Ines')).toBe('Santa Inés');
    expect(nombreDeSucursal('Suc Sant Thomas')).toBe('Sant Thomas');
  });
});

const CEPAS = ['Malbec', 'Cabernet Sauvignon', 'Cabernet Franc', 'Pinot Noir', 'Corte', 'Extra Brut', 'Brut Nature', 'Torrontés', 'Sauvignon Blanc'];

describe('interpretar lo que escribe el vendedor', () => {
  it('ocasión, tipo, cepa y tope de plata', () => {
    expect(interpretar('un malbec para el asado, hasta 20 mil', CEPAS)).toEqual({ ocasion: 'asado', cepas: ['Malbec'], precioMax: 20000 });
    expect(interpretar('algo rico por menos de $15.000')).toEqual({ precioMax: 15000 });
    expect(interpretar('quiere un tinto hasta 25k')).toEqual({ estilos: ['tinto'], precioMax: 25000 });
  });
  it('rangos y «unos»', () => {
    expect(interpretar('entre 10 y 20 mil')).toEqual({ precioMin: 10000, precioMax: 20000 });
    expect(interpretar('de $10.000 a $20.000')).toEqual({ precioMin: 10000, precioMax: 20000 });
    expect(interpretar('de 15 a 25 lucas')).toEqual({ precioMin: 15000, precioMax: 25000 });
    expect(interpretar('busca algo de unos 30 mil para regalar')).toEqual({ ocasion: 'regalo', precioMin: 22500, precioMax: 37500 });
    expect(interpretar('más de $40.000')).toEqual({ precioMin: 40000 });
  });
  it('lo que no es plata no es precio', () => {
    expect(interpretar('una caja de 6 para una picada')).toEqual({ ocasion: 'picada' });
    expect(interpretar('somos 8 y hay sushi')).toEqual({ ocasion: 'sushi' });
  });
  it('espumantes, dulces y cabernet sin apellido', () => {
    expect(interpretar('un extra brut para brindar', CEPAS)).toEqual({ ocasion: 'brindis', estilos: ['espumante'], cepas: ['Extra Brut'] });
    expect(interpretar('un blanco dulce para el postre')).toEqual({ ocasion: 'postre', estilos: ['dulce'] });
    expect(interpretar('un cabernet', CEPAS).cepas).toEqual(['Cabernet Sauvignon', 'Cabernet Franc']);
  });
  it('«la cava» no es un espumante', () => {
    expect(interpretar('qué hay en la cava para pastas')).toEqual({ ocasion: 'pastas' });
  });
  it('lo nuevo pisa lo que había y lo que no dice queda', () => {
    const antes: Filtros = { ...SIN_FILTROS, ocasion: 'asado', estilos: ['tinto'], precioMax: 20000 };
    expect(sumarFiltros(antes, { precioMax: 30000 })).toEqual({ ...antes, precioMax: 30000, precioMin: null });
    expect(sumarFiltros(antes, { ocasion: 'pastas' }).estilos).toEqual(['tinto']);
  });
});

const vino = (x: Partial<VinoCava> & { sku: string }): VinoCava => ({
  nombre: x.sku, bodega: null, categoria: null, tipo: 'tinto', cepa: 'Malbec', dulce: false, descripcion: null, maridaje: null,
  precio: 15000, precioEfectivo: 13500, promo: null, stock: { st: 10 }, vendidas: 0, ...x,
});

describe('ordenar la cava', () => {
  const cava = [
    vino({ sku: 'malbec-asado', descripcion: 'Malbec para un asado con amigos.', precio: 18000 }),
    vino({ sku: 'malbec-solo', precio: 16000 }),
    vino({ sku: 'torrontes', tipo: 'blanco', cepa: 'Torrontés', descripcion: 'Fresco, ideal con pescados y sushi.', precio: 12000 }),
    vino({ sku: 'extra-brut', tipo: 'espumante', cepa: 'Extra Brut', precio: 22000 }),
    vino({ sku: 'en-la-otra', stock: { si: 4 } }),
    vino({ sku: 'caro', precio: 90000 }),
  ];

  it('para un asado, primero el tinto que dice asado', () => {
    const r = ordenar(cava, { ...SIN_FILTROS, ocasion: 'asado' }, 'st', 'recomendar').map((x) => x.vino.sku);
    expect(r[0]).toBe('malbec-asado');
    expect(r.indexOf('torrontes')).toBeGreaterThan(r.indexOf('malbec-solo'));
  });
  it('para sushi, el espumante y el blanco arriba del tinto', () => {
    const r = ordenar(cava, { ...SIN_FILTROS, ocasion: 'sushi' }, 'st', 'recomendar').map((x) => x.vino.sku);
    expect(r.slice(0, 2).sort()).toEqual(['extra-brut', 'torrontes']);
  });
  it('solo lo que hay en el local elegido, y en las dos si no se elige', () => {
    expect(ordenar(cava, SIN_FILTROS, 'st', 'recomendar').some((x) => x.vino.sku === 'en-la-otra')).toBe(false);
    expect(ordenar(cava, SIN_FILTROS, '', 'recomendar').some((x) => x.vino.sku === 'en-la-otra')).toBe(true);
  });
  it('los filtros de precio y tipo cortan', () => {
    const f: Filtros = { ...SIN_FILTROS, estilos: ['tinto'], precioMax: 20000 };
    expect(ordenar(cava, f, 'st', 'barato').map((x) => x.vino.sku)).toEqual(['malbec-solo', 'malbec-asado']);
    expect(pasa(cava[5], f)).toBe(false);
  });
  it('el buscador busca todas las palabras en nombre y bodega', () => {
    const c = [vino({ sku: 'a', nombre: 'Colome Estate Malbec', bodega: 'Colome' }), vino({ sku: 'b', nombre: 'Alamos Malbec' })];
    expect(ordenar(c, { ...SIN_FILTROS, texto: 'colomé malbec' }, '', 'recomendar').map((x) => x.vino.sku)).toEqual(['a']);
  });
});

describe('en palabras', () => {
  it('lo que busca el cliente y el pedido al somelier', () => {
    const f: Filtros = { ...SIN_FILTROS, ocasion: 'asado', estilos: ['tinto'], cepas: ['Malbec'], precioMax: 20000 };
    expect(enPalabras(f)).toBe('Para un asado · Tinto · Malbec · hasta $20.000');
    expect(pedidoDeFiltros(f, 'Sant Thomas')).toBe('Elegime 3 vinos. Busca: Para un asado · Tinto · Malbec · hasta $20.000 en Sant Thomas.');
    expect(pedidoDeFiltros(SIN_FILTROS, null)).toBe('Elegime 3 vinos variados para recomendar hoy.');
  });
  it('el mensaje para el cliente', () => {
    expect(textoParaCliente([
      { nombre: 'Colome Estate', precio: 25000, precioEfectivo: 22500, porque: 'Potente, para la parrilla.' },
      { nombre: 'Alamos Malbec', precio: 9000, precioEfectivo: null, promo: { nombre: '2x1' } },
    ])).toBe('Te paso 2 opciones:\n• Colome Estate: $25.000 ($22.500 en efectivo o transferencia)\n  Potente, para la parrilla.\n• Alamos Malbec: $9.000 · promo 2x1');
  });
});
