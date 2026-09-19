// UNA sola regla para "¿el bot tiene que callar en esta charla?", usada por
// el camino de texto (charla) y por el de archivos (webhook). Hoy (2026-09-08)
// el camino de archivos mandaba "Recibí tu archivo…" con la línea apagada y
// pisaba la pausa de la persona con una derivación que vencía a las 4 h.
export type EstadoLinea = { bot_activo?: boolean | null } | null | undefined;
export type EstadoCharla = { bot_activo?: boolean | null; atendida_por?: string | null; derivada_motivo?: string | null } | null | undefined;

export function atiendeUnaPersona(conv: EstadoCharla): boolean {
  if (!conv || conv.bot_activo !== false) return false;
  return !!conv.atendida_por || /^(Pausado desde la bandeja|Atendida desde el tel[eé]fono)/i.test(String(conv.derivada_motivo ?? ''));
}

export function motivoDeSilencio(linea: EstadoLinea, conv: EstadoCharla, esBancoDePruebas = false): string | null {
  if (linea?.bot_activo === false && !esBancoDePruebas) return 'bot apagado en toda la línea';
  if (atiendeUnaPersona(conv)) return 'conversación en manos de una persona';
  return null;
}

// ============================================================
// ¿ESTE MENSAJE PIDE UNA RESPUESTA? (19/9/2026)
//
// Una charla pausada sigue pausada: el bot no habla. Pero si el cliente escribió
// algo que espera respuesta y nadie contestó, administración tiene que
// enterarse. El problema es el ruido: de 149 charlas esperando, la mayoría
// terminan en "gracias", "ok", "dale" o un pulgar, y avisar por eso sería
// entrenar a todos para ignorar los avisos. Esto separa una cosa de la otra con
// los textos reales de las charlas de ODB.
// ============================================================

const sinAcentos = (t: string) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Cierres de cortesía: no hace falta que nadie corra. */
const RE_CORTESIA = /^(ok+|oka+y?|okey|okk+|dale+|listo+|perfecto|barbaro|buenisimo|genial|gracias+|muchas gracias|graciasss*|mil gracias|de nada|joya|copado|excelente|va|vale|bueno|si|sii+|no|nop|👍|👌|🙏|❤️|😊|😉|✅|recibido|entendido|ah ok|a la orden|saludos|abrazo|chau|buenas noches|hasta luego)[\s.!,👍👌🙏❤️😊😉✅🎉]*$/;

/** Señales de que el cliente espera algo: pregunta, pedido, plata, reclamo. */
const RE_PIDE = /\?|¿|\b(precio|precios|cuanto|cuesta|sale|saldria|presupuesto|cotiza|stock|tenes|tienen|hay|queda|quedan|necesito|quiero|llevo|mandame|manda|enviame|envio|pedido|pedir|encargar|reservar|reserva|factura|pagar|pago|transferencia|alias|entrega|retiro|demora|cuando|horario|abren|cierran|problema|reclamo|falta|faltan|urgente|me olvide|me mandaron mal)\b/;

/** Un audio, una foto o un archivo del cliente casi siempre esperan algo. */
const RE_ADJUNTO = /^(🎙️|📷|📄|🎬)/;

export function pideRespuesta(texto: string | null | undefined): boolean {
  const t = sinAcentos(texto ?? '');
  if (!t) return false;
  if (RE_ADJUNTO.test(String(texto).trim())) return true;
  if (RE_CORTESIA.test(t)) return false;
  if (RE_PIDE.test(t)) return true;
  // mensajes largos: alguien que escribe tres renglones espera respuesta
  return t.length >= 40;
}
