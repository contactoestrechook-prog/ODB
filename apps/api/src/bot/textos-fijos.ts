// ============================================================
// LOS TEXTOS FIJOS QUE LE LLEGAN AL CLIENTE (6/10/2026, consulta silenciosa)
//
// Regla de Leandro: «Si no sabe algo, lo consulta directamente con la
// administración, pero no se lo avisa al cliente que lo está consultando.»
// Varios textos fijos del sistema prometían o anunciaban una consulta («Tomo tu
// consulta y doy aviso al sector correspondiente», «Lo revisa alguien de la casa
// y te confirmamos por acá», «Le paso los datos por acá en un rato»). Quedan acá,
// juntos, sin promesa ni anuncio, y el barrido de consulta-silenciosa.spec.ts
// controla que ninguno vuelva a decir algo así. Lo que se consulta va por
// adentro; ante un pago, un comprobante o un reclamo de pago lo final es
// «Recibido.» (regla del 23/9/2026).
// ============================================================

/** Ante un comprobante, un pago o un reclamo de pago: la palabra y nada más (23/9/2026). */
export const RECIBIDO = 'Recibido.';

/** Se pasó del tope de mensajes por hora (una vez por hora, sin gastar modelo). */
export const LIMITE_POR_HORA = 'Recibimos muchos mensajes tuyos en la última hora. Gracias por la paciencia.';

/** El modelo no respondió (sin crédito, caída): un acuse honesto cada 30 min; la charla la atiende una persona desde RESPONDE. */
export const SIN_MODELO = 'Recibí tu mensaje.';

/** El candado de «no puedo ver/escuchar» reemplazó el mensaje entero (si vino un archivo, se consulta en silencio). */
export const CANDADO_CON_ARCHIVO = RECIBIDO;
export const CANDADO_SIN_ARCHIVO = 'Recibido. Contame qué necesitás y lo vemos.';

/** Un audio sin transcripción o un archivo que el bot no abre: lo abre una persona, sin anunciarlo. */
export const AUDIO_SIN_TRANSCRIBIR = 'Recibí tu audio. Si te queda más cómodo, escribime lo que necesitás y te lo resuelvo ahora.';
export const ARCHIVO_SIN_ABRIR = 'Recibí tu archivo. Si te queda más cómodo, escribime lo que necesitás y te lo resuelvo ahora.';

/** El cliente pidió hablar con una persona y la derivación ya quedó hecha (si la reescritura no sale). */
export const DERIVACION_PEDIDA = 'Soy Emilia, la asistente de O.D.B. Te paso con una persona de la casa.';
/** El bot iba a repetir dos veces el mismo mensaje: la charla pasa a una persona. */
export const PASA_A_UNA_PERSONA = 'Te paso con una persona del local.';

/**
 * El pedido que el cliente confirmó y no se pudo cargar: sale a administración
 * como PEDIDO CONFIRMADO SIN CARGAR (encolarPedidoSinCargar, 3/10/2026) con la
 * nota y el chat. Honesto y sin promesa (6/10/2026).
 */
export const PEDIDO_SIN_CARGAR = 'Tuve un problema para cargar el pedido; ya quedó con todos los datos para el local.';
/** El pedido supera el máximo del canal: lo carga una persona del local (la nota y el aviso ya salieron). */
export const PEDIDO_GRANDE = 'Por el tamaño del pedido, lo carga una persona del local; ya quedó con todos los datos.';
/** Las frases de ahora para el pedido que no se cargó (las de arriba, o parecidas). */
export const RE_PEDIDO_SIN_CARGAR = /tuve un (?:problema|inconveniente) para cargar el pedido|qued[oó] con todos los datos para el local|lo carga una persona del local/i;
/** Lo que dice el bot cuando el pedido salió a administración sin cargar (también lo que el modelo escribe parecido, o la frase vieja del historial). */
export const RE_PEDIDO_A_ADMINISTRACION = /tuve un (?:problema|inconveniente) para cargar el pedido|qued[oó] con todos los datos(?: para el local)?|lo carga una persona del local|aviso al sector correspondiente para (?:que lo dejen|dejarlo) confirmado|\btomo (?:tu|su|el) pedido\b|aviso al (?:sector|local|equipo)[^.\n]{0,80}?para (?:que lo dejen|dejarlo) (?:confirmad|cargad|armad)/i;

/** Administración contestó el aviso del pago: llegó. */
export function pagoRecibido(montoTexto = ''): string {
  return `Recibimos tu pago${montoTexto}. Muchas gracias.`;
}
/** Administración contestó el aviso del pago: todavía no figura (sin acusar ni anunciar otra revisión). */
export function pagoNoFigura(montoTexto = ''): string {
  return `Estuvimos revisando tu transferencia${montoTexto} y todavía no la encontramos acreditada. ¿Me reenviás el comprobante?`;
}
