import { BadRequestException } from '@nestjs/common';

// LOS MODELOS DE CLAUDE, EN UN SOLO LUGAR (Leandro, 6/10/2026: «quiero que
// bajemos el gasto de ODB»). Hasta hoy cada servicio escribía su modelo a mano:
// el bot en Opus 5, el resto en Opus 4.8 (USD 5/25 por millón) y abastecimiento
// ya en Opus 5.5. Opus 5.5 cuesta USD 4/20, la caché leída sale 0,20 (antes
// 0,50) y suele resolver lo mismo con menos tokens. Todo lo que era Opus pasa a
// Opus 5.5 desde acá; Sonnet 5 y Haiku 4.5 (lectura de facturas, verificadores,
// catálogo) quedan como estaban porque son más baratos.
//
// Se vuelve atrás sin deploy de código: ODB_MODELO para todas las funciones,
// ODB_BOT_MODELO solo para el bot de WhatsApp (la de siempre).
export const MODELO_PRINCIPAL = process.env.ODB_MODELO ?? 'claude-opus-5-5';
export const MODELO_BOT = process.env.ODB_BOT_MODELO ?? 'claude-opus-5-5';

// ESFUERZO (cuánto piensa el modelo). En Opus 5.5 el razonamiento no se puede
// apagar (un 400 si se intenta): el esfuerzo es la perilla de costo y demora.
// Su valor por defecto es 'medium' (en Opus 5 era 'high') y, según la guía de
// Anthropic, Opus 5.5 en 'medium' rinde igual o más que Opus 5 en 'high'. El bot
// estaba en 'xhigh': ahí 5.5 piensa todavía más que 5 y la salida es el 18 % del
// gasto. Se manda SIEMPRE explícito y el mismo en todas las llamadas de un
// turno: cambiarlo de una llamada a otra rompe la caché.
//
// Cada función tiene su variable (ODB_BOT_ESFUERZO, MESA_ESFUERZO…); si no está,
// manda ODB_ESFUERZO para todas; si tampoco, el valor por defecto de la función.
// Las que corren contra un reloj (el asistente de la tienda, 50 s; el cierre de
// la mesa de compras, 55 s) NO leen ODB_ESFUERZO: un «subile el esfuerzo a
// todo» las dejaba sin tiempo y contestaban vacío (6/10/2026, revisión).
//
// Las variables, todas opcionales (sin cargar, queda lo de arriba):
//   ODB_MODELO, ODB_BOT_MODELO            el modelo (todas las funciones / el bot)
//   ODB_ESFUERZO                          el esfuerzo de todas las funciones (menos
//                                         el asistente y el cierre de la mesa)
//   ODB_BOT_ESFUERZO (el bot y la lectura del comprobante), ANALISTA_ESFUERZO,
//   DIFUSIONES_ESFUERZO, EVENTOS_ESFUERZO, INFORMES_ESFUERZO, PROMOS_ESFUERZO,
//   REPORTES_ESFUERZO, COMPARADOR_ESFUERZO, LISTAS_ESFUERZO, MESA_ESFUERZO,
//   ABASTECIMIENTO_ESFUERZO                                      medium por defecto
//   ASISTENTE_ESFUERZO                    low por defecto (la tienda contesta en 50 s)
//   MESA_CIERRE_ESFUERZO                  low por defecto (el cierre tiene 55 s)
// Y tres del bot para gastar menos en caché, APAGADAS hasta probarlas con el
// banco (ver bot.service.ts):
//   ODB_BOT_CACHE_PREFIJO=1h | mantener   el prompt fijo no se enfría entre charlas
//   ODB_BOT_CACHE_HILO=1                  el historial de la charla se lee de la caché
//   ODB_BOT_TOPE_BUSQUEDA=20              fichas por búsqueda (el resto, solo nombres)
export type Esfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const ESFUERZOS: readonly Esfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ESFUERZO_POR_DEFECTO: Esfuerzo = 'medium';

/**
 * El esfuerzo de una función: su variable, después ODB_ESFUERZO (salvo
 * `{ general: false }`, para las que tienen un reloj encima) y después su valor
 * por defecto.
 */
export function esfuerzo(variable?: string, porDefecto: Esfuerzo = ESFUERZO_POR_DEFECTO, o: { general?: boolean } = {}): Esfuerzo {
  const valido = (v: unknown): Esfuerzo | null => {
    const t = String(v ?? '').trim().toLowerCase();
    return (ESFUERZOS as readonly string[]).includes(t) ? (t as Esfuerzo) : null;
  };
  return (variable ? valido(process.env[variable]) : null) ?? (o.general === false ? null : valido(process.env.ODB_ESFUERZO)) ?? porDefecto;
}

/** ¿Piensa más que medium? (la correa de tiempo de la mesa de compras, 6/10/2026) */
export function esfuerzoAlto(e: Esfuerzo): boolean {
  return e === 'high' || e === 'xhigh' || e === 'max';
}

// RAZONAMIENTO EN HAIKU 4.5 (regla fija de Leandro, 9/9/2026: ninguna llamada
// sin razonamiento). Haiku 4.5 no tiene el adaptativo: va con presupuesto, el
// mínimo (1024), y el tope de la llamada tiene que quedar por encima con lugar
// para la respuesta. Se lee el texto por tipo de bloque (el primero es el
// razonamiento). Es la forma que ya usa el verificador de preguntas del bot.
export const RAZONAMIENTO_HAIKU = { type: 'enabled', budget_tokens: 1024 } as const;

/**
 * Razonamiento siempre encendido (regla fija del 9/9/2026): adaptive en los
 * modelos 4.6 en adelante y en los 5; los viejos (Haiku 4.5, Sonnet y Opus 4.5
 * o anteriores) piensan con budget_tokens, que tiene que ser menor que max_tokens.
 */
export function razonamientoPara(modelo: string): { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number } {
  const m = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/i.exec(String(modelo ?? ''));
  if (!m) return /claude-[123]\b|claude-[123]-/i.test(String(modelo ?? '')) ? { type: 'enabled', budget_tokens: 2048 } : { type: 'adaptive' };
  const mayor = Number(m[1]);
  const menor = m[2] && m[2].length <= 2 ? Number(m[2]) : 0; // «-20250514» es una fecha, no la versión
  return mayor > 4 || (mayor === 4 && menor >= 6) ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: 2048 };
}

// RAZONAMIENTO SIEMPRE ENCENDIDO (regla fija de Leandro, 9/9/2026). En Opus 5.5
// ya no se puede apagar, pero se manda igual: si alguien vuelve a Opus 4.8 con
// ODB_MODELO, en 4.8 no mandarlo es apagarlo.
export const RAZONAMIENTO = { type: 'adaptive' } as const;

type RespuestaClaude = { stop_reason?: string | null; content?: any[] | null; stop_details?: { category?: string | null } | null };

/** El texto de la respuesta, leído por tipo de bloque (el primero suele ser el razonamiento). */
export function textoDe(r: RespuestaClaude | null | undefined): string {
  return ((r?.content ?? []) as any[]).filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n').trim();
}

/**
 * El texto de la respuesta, o un error que dice qué pasó. Antes de leerlo se
 * mira por qué terminó: un rechazo de seguridad (Opus 5.5 suma los de biología y
 * los de «extraer el razonamiento» a los de ciberseguridad) o un corte por el
 * tope de tokens no traen una respuesta entera. Antes eso salía como un texto
 * vacío o como un JSON.parse roto, incomprensible para quien usa la pantalla
 * (6/10/2026).
 */
export function textoUtil(r: RespuestaClaude | null | undefined, queEs: string): string {
  if (r?.stop_reason === 'refusal') {
    throw new BadRequestException(`${queEs}: la IA no quiso contestar este pedido${r?.stop_details?.category ? ` (${r.stop_details.category})` : ''}. Probá reformularlo.`);
  }
  if (r?.stop_reason === 'max_tokens') {
    throw new BadRequestException(`${queEs}: la respuesta de la IA se cortó antes de terminar. Probá con menos datos de una vez.`);
  }
  const t = textoDe(r);
  if (!t) throw new BadRequestException(`${queEs}: la IA no devolvió nada. Probá de nuevo.`);
  return t;
}

/** El JSON de una respuesta con salida estructurada, con los mismos controles que textoUtil. */
export function jsonDe<T = any>(r: RespuestaClaude | null | undefined, queEs: string): T {
  const t = textoUtil(r, queEs);
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new BadRequestException(`${queEs}: la respuesta de la IA no se pudo leer. Probá de nuevo.`);
  }
}
