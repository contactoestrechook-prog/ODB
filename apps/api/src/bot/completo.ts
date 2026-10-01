// EL PEDIDO SE CONFIRMA COMPLETO ANTES DE LOS PRECIOS (regla de Leandro,
// 25/9/2026): cuando el cliente manda un pedido, el bot primero repite lo que
// anotó —sin precios— y pregunta si está completo. Recién cuando el cliente lo
// confirma se cotiza. Esta guarda decide si ya se puede cotizar.

/** La pregunta del bot: «¿Está completo el pedido o querés sumar algo?» */
export const RE_PREGUNTA_COMPLETO = /¿[^?]*(est[aá] completo|queda completo|algo m[aá]s|sumar algo|agregar algo|falta algo|(?:es|ser[ií]a|eso) todo|nada m[aá]s|cerramos|lo cierro|cierro as[ií]|queda as[ií]|as[ií] est[aá] bien)[^?]*\?/i;

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
  // (alcanza con que lo haya dicho después de una lista de lo anotado, aunque la
  // última pregunta del bot fuera otra: «¿qué hielo?»)
  const huboLista = ultimosDelBot.some((m) => RE_PREGUNTA_COMPLETO.test(m) || (/\d\s*[×x]\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(m) && !/\$\s?\d/.test(m)));
  if (huboLista && anterioresDelCliente.some(diceQueEstaCompleto)) return true;
  if (diceQueEstaCompleto(textoCliente) && (RE_PREGUNTA_COMPLETO.test(ultimosDelBot[0] ?? '') || /\b(es todo|nada m[aá]s|completo)\b/i.test(textoCliente))) return true;
  return ultimosDelBot.some((m) => /\btotal\b[^\n]{0,20}\$|¿lo confirmo\?/i.test(m));
}

/**
 * La lista de lo anotado (sin precios) sin ninguna pregunta deja al cliente sin
 * saber qué contestar: se le agrega la pregunta de si está completo (30/9/2026,
 * el bot la olvidaba al sumar un producto).
 */
export function conPreguntaDeCompleto(respuesta: string): string {
  const t = String(respuesta ?? '');
  // «• 2 × Fernet» o «Sumado: 1 × Smirnoff»: lo anotado, sin precio y sin pregunta
  const esListaAnotada = /\b\d+(?:[.,]\d+)?\s*(?:kg\s*)?×\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t) && !/\$\s?\d/.test(t) && !/\?/.test(t);
  return esListaAnotada ? `${t.trimEnd()}\n\n¿Está completo el pedido o querés sumar algo?` : t;
}

// en la lista quedó algo para elegir ("decime cuál: clásicas 134 g o 330 g",
// "¿con cáscara o pelado?")
const RE_VARIANTE_PENDIENTE = /a (?:definir|elegir|confirmar)\b|las variantes|me confirm[aá]s (?:la|las|el|cu[aá]l)|decime cu[aá]l|¿\s*qu[eé] [^?]{0,60}(te preparo|quer[eé]s|prefer[ií]s)|¿\s*cu[aá]l(es)?\b|eleg[ií] (cu[aá]l|una|entre)|qu[eé] (sabor|variante|tama[nñ]o|marca)|—[^\n$]{0,80}\bo\b[^\n$]{0,60}(\?|$)/im;

/**
 * "Es todo" NO elige variantes (30/9/2026, el modelo elegía papas y maní por el
 * cliente): si la última lista dejó opciones abiertas y el cliente solo confirma,
 * todavía no se cotiza.
 */
export function faltaElegirVariante(textoCliente: string, ultimosDelBot: string[]): boolean {
  const ultimo = ultimosDelBot[0] ?? '';
  // una lista de lo anotado (sin precios) con opciones abiertas, termine en la
  // pregunta de completo o en «¿qué papas te preparo?»
  if (!/[×x]\s*\S/.test(ultimo) || /\$\s?\d/.test(ultimo)) return false;
  // la lista terminó en OTRA pregunta («¿qué presentación querés?», «¿botellas o
  // cajas?»): un "sí, es todo" no la contesta (banco 1/10/2026, el bot elegía)
  const ultimaPregunta = ultimo.slice(ultimo.lastIndexOf('¿'));
  const preguntaOtraCosa = ultimo.includes('¿') && !RE_PREGUNTA_COMPLETO.test(ultimaPregunta);
  if (!preguntaOtraCosa && !RE_VARIANTE_PENDIENTE.test(ultimo)) return false;
  const t = String(textoCliente ?? '').trim();
  return diceQueEstaCompleto(t) && t.split(/\s+/).length <= 5;
}
