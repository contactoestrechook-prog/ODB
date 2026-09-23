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
// adjuntos, derivaciones (🔔), ubicación (📍) y tarjetas (📇): siempre esperan algo
const RE_ADJUNTO = /^(🎙️|📷|📄|🎬|🔔|📍|📇|✉️)/u;

export function pideRespuesta(texto: string | null | undefined): boolean {
  const t = sinAcentos(texto ?? '');
  if (!t) return false;
  if (RE_ADJUNTO.test(String(texto).trim())) return true;
  if (RE_CORTESIA.test(t)) return false;
  if (RE_PIDE.test(t)) return true;
  // mensajes largos: alguien que escribe tres renglones espera respuesta
  return t.length >= 40;
}

// ============================================================
// QUÉ CHARLAS AVISAR AHORA (23/9/2026)
//
// El vigilante traía las 12 esperas MÁS VIEJAS y recién después filtraba las ya
// avisadas: esas 12 ocupaban la lista para siempre y las charlas nuevas nunca
// se avisaban (el comprobante de un cliente del 21/9 quedó sin aviso). Además
// re-avisaba cada 6 h sin fin. Ahora: primero las nunca avisadas (de la más
// vieja a la más nueva), después los re-avisos; tope de 3 avisos por espera
// (a los 20 min, a las 6 h y a las 24 h).
// ============================================================
export type Espera = { telefono: string; esperando_desde: string; esperando_aviso_en: string | null; esperando_avisos?: number | null };

export function esperasParaAvisar<T extends Espera>(filas: T[], ahora: number, tope = 12): T[] {
  const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const listas = filas.filter((f) => {
    const desde = ms(f.esperando_desde);
    if (!desde || ahora - desde < 20 * 60_000) return false;
    const avisos = Number(f.esperando_avisos ?? (f.esperando_aviso_en ? 1 : 0));
    if (avisos >= 3) return false;
    if (!f.esperando_aviso_en) return true;
    const espera = avisos >= 2 ? 24 * 3600_000 : 6 * 3600_000;
    return ahora - ms(f.esperando_aviso_en) >= espera;
  });
  return listas
    .sort((a, b) => (a.esperando_aviso_en ? 1 : 0) - (b.esperando_aviso_en ? 1 : 0) || ms(a.esperando_desde) - ms(b.esperando_desde))
    .slice(0, tope);
}

// ============================================================
// ¿LA SESIÓN DE WHATSAPP ESTÁ CAÍDA? (23/9/2026)
//
// El domingo 21/9 a las 18:49 la sesión de WAHA pasó a FAILED y nadie se
// enteró: casi dos días sin recibir un solo mensaje. Una lectura mala puede ser
// un parpadeo; dos seguidas es una caída de verdad.
// ============================================================
export function decisionSesion(status: string | null, fallosSeguidos: number): { fallos: number; reiniciar: boolean; alertar: boolean } {
  if (status === 'WORKING') return { fallos: 0, reiniciar: false, alertar: false };
  const fallos = fallosSeguidos + 1;
  // STARTING: está arrancando, se le da una vuelta más antes de tocarla
  if (status === 'STARTING' && fallos < 3) return { fallos, reiniciar: false, alertar: false };
  // SCAN_QR_CODE: se desvinculó el teléfono; reiniciar no sirve, hay que escanear
  if (status === 'SCAN_QR_CODE') return { fallos, reiniciar: false, alertar: fallos >= 2 };
  return { fallos, reiniciar: fallos === 2, alertar: fallos >= 2 };
}
