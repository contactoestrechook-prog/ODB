import { costoUSD, usoDeRespuesta } from './tarifas';

// 1/10/2026: el registro del bot no tenía claude-opus-5 y lo cobraba como
// Sonnet viejo ($3/$15): se veía un 40% menos de lo que se gastaba.
describe('tarifas de Claude', () => {
  const millon = { entrada: 1_000_000, cacheLeida: 1_000_000, cacheEscrita: 1_000_000, salida: 1_000_000 };

  it('Opus 5, el modelo del bot, a su precio', () => {
    expect(costoUSD('claude-opus-5', millon)).toBeCloseTo(5 + 0.5 + 6.25 + 25);
  });

  // 6/10/2026: el bot y todas las funciones pasan a Opus 5.5 (comun/modelos.ts)
  it('Opus 5.5 a $4/$20, caché leída $0,20 y escrita $5', () => {
    expect(costoUSD('claude-opus-5-5', millon)).toBeCloseTo(4 + 0.2 + 5 + 20);
    expect(costoUSD('claude-opus-5-5', millon)).toBeLessThan(costoUSD('claude-opus-5', millon));
  });

  it('la caché escrita por 1 hora se cobra al doble de la entrada', () => {
    expect(costoUSD('claude-opus-5-5', { entrada: 0, cacheLeida: 0, cacheEscrita: 0, cacheEscrita1h: 1_000_000, salida: 0 })).toBeCloseTo(8);
  });

  it('Sonnet 5 a $2/$10 (el juez del banco)', () => {
    expect(costoUSD('claude-sonnet-5', { ...millon, cacheLeida: 0, cacheEscrita: 0 })).toBeCloseTo(12);
  });

  it('un modelo desconocido se cobra como Opus, nunca de menos', () => {
    expect(costoUSD('claude-modelo-nuevo', millon)).toBeCloseTo(costoUSD('claude-opus-5', millon));
  });

  it('acepta el nombre con fecha', () => {
    expect(costoUSD('claude-haiku-4-5-20251001', millon)).toBeCloseTo(costoUSD('claude-haiku-4-5', millon));
  });

  it('lee el usage de la API', () => {
    expect(usoDeRespuesta({ input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40 }))
      .toEqual({ entrada: 10, cacheLeida: 20, cacheEscrita: 30, cacheEscrita1h: 0, salida: 40 });
    expect(usoDeRespuesta(undefined)).toEqual({ entrada: 0, cacheLeida: 0, cacheEscrita: 0, cacheEscrita1h: 0, salida: 0 });
  });

  it('separa la caché escrita de 1 hora de la de 5 minutos', () => {
    expect(usoDeRespuesta({ input_tokens: 1, cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 }, output_tokens: 2 }))
      .toEqual({ entrada: 1, cacheLeida: 0, cacheEscrita: 10, cacheEscrita1h: 20, salida: 2 });
  });
});
