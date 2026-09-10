// Que un asistente NUNCA conteste dos veces lo mismo.
//
// El 10/9/2026 Leandro mostró la mesa de compras: el analista decía «decime con
// cuántos renglones arranco», él contestaba «los primeros 30 dale», y volvía el
// mismo texto palabra por palabra. Da lo mismo si el que se repite es un mensaje
// fijo del código o el modelo: para el que está del otro lado, el asistente se
// colgó y no hay nada que pueda escribir para destrabarlo.
//
// Esta es la última barrera antes de devolver una respuesta: si es igual a algo
// que ya se dijo, se cambia por un próximo paso distinto, y el último escalón
// deja de pedirle cosas al usuario y ofrece que lo mire una persona.

const normalizar = (t: string) =>
  (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Cada escalón pide algo DISTINTO al anterior; el último no pide nada.
export const ESCALONES = [
  'Me estoy trabando con esto. Vamos por partes: pasame un solo renglón (producto, precio del bulto y cuántas unidades trae) y lo cuesto entero.',
  'Sigo sin poder avanzar con lo que tengo cargado. Empecemos la charla de nuevo con la oferta en dos renglones, así no arrastro lo anterior.',
  'No lo estoy resolviendo. Le avisé al equipo del sistema para que lo miren; mientras tanto, si es urgente, cargá la compra a mano desde Facturas de compra.',
];

export type Repetida = { texto: string; seRepitio: boolean; escalon: number };

/**
 * Devuelve una respuesta que NO sea igual a ninguna de las anteriores del
 * asistente. `anteriores` son los textos que el asistente ya dijo en esta charla
 * (el más reciente primero o último, da igual: se comparan todos).
 */
export function respuestaSinVueltas(propuesta: string | null | undefined, anteriores: string[] = []): Repetida {
  const limpia = (propuesta ?? '').trim();
  const dichas = new Set(anteriores.map(normalizar).filter(Boolean));

  if (limpia && !dichas.has(normalizar(limpia))) return { texto: limpia, seRepitio: false, escalon: 0 };

  for (let i = 0; i < ESCALONES.length; i++) {
    if (!dichas.has(normalizar(ESCALONES[i]))) return { texto: ESCALONES[i], seRepitio: true, escalon: i + 1 };
  }
  return { texto: ESCALONES[ESCALONES.length - 1], seRepitio: true, escalon: ESCALONES.length };
}
