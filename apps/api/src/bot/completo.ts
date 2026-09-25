// EL PEDIDO SE CONFIRMA COMPLETO ANTES DE LOS PRECIOS (regla de Leandro,
// 25/9/2026): cuando el cliente manda un pedido, el bot primero repite lo que
// anotó —sin precios— y pregunta si está completo. Recién cuando el cliente lo
// confirma se cotiza. Esta guarda decide si ya se puede cotizar.

/** La pregunta del bot: «¿Está completo el pedido o querés sumar algo?» */
export const RE_PREGUNTA_COMPLETO = /¿[^?]*(est[aá] completo|queda completo|algo m[aá]s|sumar algo|agregar algo|falta algo|(?:es|ser[ií]a|eso) todo|nada m[aá]s)[^?]*\?/i;

/** El cliente dice que el pedido está completo. */
export function diceQueEstaCompleto(texto: string): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (/\b(es todo|eso es todo|nada mas|esta completo|completo|ya esta|solo eso|eso solo|con eso (esta|alcanza)|por ahora (es )?eso|no,? (nada|gracias)|no,? eso)\b/.test(t)) return true;
  // un sí suelto a la pregunta de si está completo
  return /^(si+|sisi|dale|ok(ey)?|listo|perfecto|asi (esta )?bien|todo bien|correcto|exacto)\b[\s!.,]*(,?\s*(gracias|es todo|eso))?[\s!.]*$/.test(t);
}

const RE_PREGUNTA_PRECIO = /\b(cu[aá]nto|precio|sale|salen|cuesta|cuestan|presupuesto|total)\b/i;

/**
 * ¿Ya se pueden pasar precios de este pedido? Sí si: el cliente pregunta un
 * precio o un total; dice que es todo; contesta que sí a la pregunta de si está
 * completo; o el pedido ya pasó esa etapa (el bot ya mostró precios o el resumen).
 */
export function puedeCotizar(textoCliente: string, ultimosDelBot: string[], anterioresDelCliente: string[] = []): boolean {
  if (RE_PREGUNTA_PRECIO.test(textoCliente)) return true;
  // ya lo confirmó antes y ahora solo define variantes ("las clásicas de 134"):
  // no se le vuelve a preguntar si está completo (banco 25/9/2026)
  if (ultimosDelBot.some((m) => RE_PREGUNTA_COMPLETO.test(m)) && anterioresDelCliente.some(diceQueEstaCompleto)) return true;
  if (diceQueEstaCompleto(textoCliente) && (RE_PREGUNTA_COMPLETO.test(ultimosDelBot[0] ?? '') || /\b(es todo|nada m[aá]s|completo)\b/i.test(textoCliente))) return true;
  return ultimosDelBot.some((m) => /\btotal\b[^\n]{0,20}\$|¿lo confirmo\?/i.test(m));
}
