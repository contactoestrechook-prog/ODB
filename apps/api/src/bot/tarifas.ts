// Lo que cuesta cada llamada a Claude, en un solo lugar: lo usan el registro de
// cada charla del bot y el banco de pruebas (bot y juez).
//
// 1/10/2026: la tabla vivía adentro de bot.service.ts, no tenía claude-opus-5
// (el modelo del bot) y caía en una tarifa vieja de Sonnet: el costo que se
// veía era un 40% menor al real. El banco "costaba" USD 60 por semana y eran 100.

// USD por millón de tokens: entrada, caché leída, caché escrita (5 min), salida.
// El razonamiento se cobra como salida (ya viene sumado en output_tokens).
export const TARIFAS: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 0.2, 5, 20],
  'claude-opus-5': [5, 0.5, 6.25, 25],
  'claude-opus-4-8': [5, 0.5, 6.25, 25],
  'claude-sonnet-5-5': [2, 0.2, 2.5, 10],
  'claude-sonnet-5': [2, 0.2, 2.5, 10],
  'claude-haiku-4-5': [1, 0.1, 1.25, 5],
};

// Un modelo que no está en la tabla se cobra como Opus: mejor sobreestimar que
// esconder gasto (el error de antes fue el contrario).
const MAS_CARA = TARIFAS['claude-opus-5'];

export type UsoTokens = { entrada: number; cacheLeida: number; cacheEscrita: number; salida: number };

export function costoUSD(modelo: string, uso: UsoTokens): number {
  const [ent, lee, esc, sal] = TARIFAS[String(modelo).replace(/-\d{8}$/, '')] ?? MAS_CARA;
  return (uso.entrada * ent + uso.cacheLeida * lee + uso.cacheEscrita * esc + uso.salida * sal) / 1_000_000;
}

// El `usage` tal como lo devuelve la API, pasado a nuestro formato.
export function usoDeRespuesta(usage: any): UsoTokens {
  return {
    entrada: Number(usage?.input_tokens ?? 0),
    cacheLeida: Number(usage?.cache_read_input_tokens ?? 0),
    cacheEscrita: Number(usage?.cache_creation_input_tokens ?? 0),
    salida: Number(usage?.output_tokens ?? 0),
  };
}
