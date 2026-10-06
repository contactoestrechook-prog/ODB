// Lo que cuesta cada llamada a Claude, en un solo lugar: lo usan el registro de
// cada charla del bot y el banco de pruebas (bot y juez).
//
// 1/10/2026: la tabla vivía adentro de bot.service.ts, no tenía claude-opus-5
// (el modelo del bot) y caía en una tarifa vieja de Sonnet: el costo que se
// veía era un 40% menor al real. El banco "costaba" USD 60 por semana y eran 100.

// USD por millón de tokens: entrada, caché leída, caché escrita (5 min), salida.
// El razonamiento se cobra como salida (ya viene sumado en output_tokens).
// La caché escrita por 1 hora sale el doble de la entrada (ver costoUSD).
// 6/10/2026: el bot y todas las funciones pasan a Opus 5.5 (comun/modelos.ts):
// 4/20, caché leída 0,20 (5 % de la entrada; en Opus 5 era 0,50) y escrita 5.
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

// cacheEscrita es la de 5 minutos; cacheEscrita1h, la de una hora (6/10/2026:
// el bot puede guardar el prompt fijo una hora con ODB_BOT_CACHE_PREFIJO=1h, y
// esa escritura cuesta 2 veces la entrada, no 1,25: contarla como de 5 minutos
// escondía gasto).
export type UsoTokens = { entrada: number; cacheLeida: number; cacheEscrita: number; cacheEscrita1h?: number; salida: number };

export function costoUSD(modelo: string, uso: UsoTokens): number {
  const [ent, lee, esc, sal] = TARIFAS[String(modelo).replace(/-\d{8}$/, '')] ?? MAS_CARA;
  return (uso.entrada * ent + uso.cacheLeida * lee + uso.cacheEscrita * esc + (uso.cacheEscrita1h ?? 0) * ent * 2 + uso.salida * sal) / 1_000_000;
}

// El `usage` tal como lo devuelve la API, pasado a nuestro formato. La API da
// la caché escrita total y, aparte, cuánto fue de 1 hora.
export function usoDeRespuesta(usage: any): UsoTokens {
  const escrita = Number(usage?.cache_creation_input_tokens ?? 0);
  const deUnaHora = Math.min(escrita, Number(usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0) || 0);
  return {
    entrada: Number(usage?.input_tokens ?? 0),
    cacheLeida: Number(usage?.cache_read_input_tokens ?? 0),
    cacheEscrita: escrita - deUnaHora,
    cacheEscrita1h: deUnaHora,
    salida: Number(usage?.output_tokens ?? 0),
  };
}
