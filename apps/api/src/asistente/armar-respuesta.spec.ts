import { armarRespuesta, grupoDeRespaldo, MAX_GRUPOS, MAX_POR_GRUPO, MAX_SUGERENCIAS } from './armar-respuesta';

const p = (sku: string) => ({ sku, nombre: `Producto ${sku}`, precio: 1000 });
const vistos = new Map(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => [s, p(s)]));

describe('armarRespuesta: el asistente solo muestra lo que existe', () => {
  it('descarta los skus que no salieron de una búsqueda (nunca un producto inventado)', () => {
    const r = armarRespuesta({ mensaje: 'Mirá', grupos: [{ titulo: 'Quesos', skus: ['A', 'INVENTADO', 'B'] }] }, vistos);
    expect(r.grupos[0].items.map((x) => x.sku)).toEqual(['A', 'B']);
  });

  it('un grupo que quedó sin productos reales no se muestra', () => {
    const r = armarRespuesta({ grupos: [{ titulo: 'Fantasma', skus: ['X', 'Y'] }, { titulo: 'Vinos', skus: ['C'] }] }, vistos);
    expect(r.grupos.map((g) => g.titulo)).toEqual(['Vinos']);
  });

  it('un producto no se repite entre grupos', () => {
    const r = armarRespuesta({ grupos: [{ titulo: 'Uno', skus: ['A', 'B'] }, { titulo: 'Dos', skus: ['B', 'C'] }] }, vistos);
    expect(r.grupos[1].items.map((x) => x.sku)).toEqual(['C']);
  });

  it('pone topes para no llenar la pantalla de fotos', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => ({ titulo: `G${i}`, skus: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }));
    const r = armarRespuesta({ grupos: muchos, sugerencias: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'] }, vistos);
    expect(r.grupos.length).toBeLessThanOrEqual(MAX_GRUPOS);
    expect(r.grupos[0].items.length).toBeLessThanOrEqual(MAX_POR_GRUPO);
    expect(r.sugerencias.length).toBeLessThanOrEqual(MAX_SUGERENCIAS);
  });

  it('las sugerencias vacías, repetidas o larguísimas se descartan', () => {
    const r = armarRespuesta({ sugerencias: ['Sumale un vino', 'Sumale un vino', '', 'x'.repeat(80), 'Más barato'] }, vistos);
    expect(r.sugerencias).toEqual(['Sumale un vino', 'Más barato']);
  });

  it('un grupo sin título igual tiene un nombre', () => {
    expect(armarRespuesta({ grupos: [{ titulo: '', skus: ['A'] }] }, vistos).grupos[0].titulo).toBe('Para vos');
  });
});

describe('grupoDeRespaldo: si el modelo no llamó a responder, igual se ve lo que buscó', () => {
  it('arma un grupo por búsqueda, con productos reales y en orden', () => {
    const g = grupoDeRespaldo([{ q: 'queso', skus: ['A', 'B'] }, { q: 'nada', skus: ['Z'] }, { q: 'vino', skus: ['C'] }], vistos);
    expect(g.map((x) => x.titulo)).toEqual(['Queso', 'Vino']);
    expect(g[0].items.map((x) => x.sku)).toEqual(['A', 'B']);
  });
});
