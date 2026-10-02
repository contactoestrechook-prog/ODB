import {
  coincideAproximado,
  coincideBusqueda,
  filtrarColumna,
  filtrarPorBusqueda,
  palabraParecida,
  terminosDeBusqueda,
} from './busqueda';

// Lo que devuelven terminos_busqueda() y palabra_parecida() en la base para
// los mismos casos (consultado el 2/10/2026). Si la regla cambia de un lado y
// no del otro, esto falla.
const TERMINOS_DE_LA_BASE: Record<string, string[]> = {
  'café cabrales': ['cabral', 'cafe'],
  'Café Cabrales': ['cabral', 'cafe'],
  'cafés cabrales': ['cabral', 'caf'],
  'CAFE  CABRALES x 250 grs': ['250', 'cabral', 'cafe'],
  'Leche La Serenísima 1 L': ['1', 'leche', 'serenisima'],
  'vinos tintos': ['tinto', 'vino'],
  licores: ['licor'],
  x: ['x'],
  de: ['de'],
  'j&b': ['j&b'],
  '1,5 L': ['1', '5'],
  'Coca-Cola 2.25': ['2', '25', 'coca', 'cola'],
  'fernet branca 750cc': ['750', 'branca', 'fernet'],
  'dulces de leche': ['dulc', 'leche'],
  x250gr: ['250'],
  Ñandú: ['nandu'],
  '  ': [],
};

const PARECIDAS_DE_LA_BASE: [string, string, boolean][] = [
  ['cabrlaes', 'cabrales', true],
  ['cabrlaes', 'cabra', false],
  ['zreo', 'zero', true],
  ['zreo', 'oreo', true],
  ['brnaca', 'branca', true],
  ['serenismia', 'serenisima', true],
  ['quilmez', 'quilmes', true],
  ['malbek', 'malbec', true],
  ['cabrl', 'cabrales', true],
  ['amor', 'roma', false],
  ['cafes', 'cafe', true],
  ['vino', 'vina', true],
  ['leche', 'lecha', true],
  ['coca', 'cola', true],
];

describe('busqueda: la misma regla que la base', () => {
  it.each(Object.entries(TERMINOS_DE_LA_BASE))('términos de "%s"', (q, esperado) => {
    expect([...terminosDeBusqueda(q)].sort()).toEqual([...esperado].sort());
  });

  it.each(PARECIDAS_DE_LA_BASE)('"%s" se parece a "%s": %s', (r, w, esperado) => {
    expect(palabraParecida(r, w)).toBe(esperado);
  });
});

describe('busqueda: lo que no puede volver a pasar', () => {
  const cabrales = 'Cafe Cabrales Happy Day tostado molido  x 190g';

  it('"café cabrales" encuentra "Cafe Cabrales" (tildes, mayúsculas, plural y orden)', () => {
    for (const q of ['café cabrales', 'Café Cabrales', 'CAFÉ CABRALES', 'cafés cabrales', 'cabrales café', 'cafe  cabrales', 'café de cabrales'])
      expect(coincideBusqueda(cabrales, q)).toBe(true);
  });

  it('y al revés: "cafe" encuentra un producto escrito "Café"', () => {
    expect(coincideBusqueda('Café Molido La Virginia x 500g', 'cafe virginia')).toBe(true);
  });

  it('números con o sin unidad', () => {
    expect(coincideBusqueda(cabrales, 'cabrales 190 gr')).toBe(true);
    expect(coincideBusqueda(cabrales, 'cabrales x190grs')).toBe(true);
    expect(coincideBusqueda('Fernet Branca  x750cc', 'fernet 750 ml')).toBe(true);
  });

  it('no inventa: todas las palabras tienen que estar', () => {
    expect(coincideBusqueda(cabrales, 'cafe la virginia')).toBe(false);
  });

  it('errores de tipeo solo en la segunda vuelta', () => {
    expect(coincideBusqueda(cabrales, 'cafe cabrlaes')).toBe(false);
    expect(coincideAproximado(cabrales, 'cafe cabrlaes')).toBe(true);
    expect(coincideAproximado('Coca Cola Zero 1.5L', 'coca zreo')).toBe(true);
    expect(coincideAproximado('Fernet Branca  x750cc', 'fernet brnaca')).toBe(true);
    expect(coincideAproximado('Queso de cabra', 'cabrlaes')).toBe(false);
    expect(coincideAproximado(cabrales, 'xyzw')).toBe(false);
  });

  it('filtrarPorBusqueda: exactos primero; si no hay, aproximados; sin búsqueda, todo', () => {
    const provs = [{ n: 'Distribuidora Peñaflor S.A.' }, { n: 'Cervecería Quilmes' }, { n: 'Arcor' }];
    const nombres = (xs: { n: string }[]) => xs.map((x) => x.n);
    expect(nombres(filtrarPorBusqueda(provs, 'penaflor', (x) => x.n))).toEqual(['Distribuidora Peñaflor S.A.']);
    expect(nombres(filtrarPorBusqueda(provs, 'cerveceria', (x) => x.n))).toEqual(['Cervecería Quilmes']);
    expect(nombres(filtrarPorBusqueda(provs, 'quilmez', (x) => x.n))).toEqual(['Cervecería Quilmes']);
    expect(filtrarPorBusqueda(provs, '', (x) => x.n)).toHaveLength(3);
    expect(filtrarPorBusqueda(provs, 'zzzz', (x) => x.n)).toHaveLength(0);
  });

  it('las sucursales con el nombre corto de Mesa de compras', () => {
    const sucs = [{ n: 'Suc Sant Thomas' }, { n: 'Suc Santa Ines' }];
    expect(filtrarPorBusqueda(sucs, 'Saint Thomas', (s) => s.n).map((s) => s.n)).toEqual(['Suc Sant Thomas']);
    expect(filtrarPorBusqueda(sucs, 'Santa Inés', (s) => s.n).map((s) => s.n)).toEqual(['Suc Santa Ines']);
  });

  it('filtrarColumna arma un like por palabra', () => {
    const llamadas: [string, string][] = [];
    const q: any = { like: (c: string, p: string) => (llamadas.push([c, p]), q) };
    filtrarColumna(q, 'texto_busqueda', 'Café Cabrales');
    expect(llamadas).toEqual([
      ['texto_busqueda', '%cabral%'],
      ['texto_busqueda', '%cafe%'],
    ]);
  });
});

describe('busqueda: la copia del panel', () => {
  it('apps/admin/app/lib/busqueda.ts tiene exactamente la misma regla', () => {
    const fs = require('fs');
    const path = require('path');
    const regla = (s: string) => {
      const desde = s.indexOf('const VACIAS');
      const hasta = s.indexOf('/**\n * Agrega a una consulta de Supabase');
      return s.slice(desde, hasta >= 0 ? hasta : undefined).trim();
    };
    const api = fs.readFileSync(path.join(__dirname, 'busqueda.ts'), 'utf8');
    const panel = fs.readFileSync(path.join(__dirname, '../../../admin/app/lib/busqueda.ts'), 'utf8');
    expect(regla(panel)).toBe(regla(api));
  });
});
