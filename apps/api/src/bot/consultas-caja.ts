// ============================================================
// LA CONSULTA DEL BOT SUENA EN LA CAJA (21/11/2026). Leandro, después del pedido de
// El Casco Viejo que se perdió: «que no suene más en administración, que no avise más
// administración, que no se apague el bot y que siempre suene a caja, con sonido, con
// mucho sonido».
//
// Lo que el bot no sabe (si el roquefort se fracciona, si hay 12 Paty) ya no sale por
// WhatsApp a administración ni pasa sola a una persona a los 30 minutos: queda con
// enviado_a 'caja' y la ventana «Pregunta de un cliente» del panel la hace sonar en la
// caja de la sucursal de los pedidos hasta que alguien la contesta ahí mismo. Lo que
// escribe la caja le llega al cliente por la misma línea (llevarRespuestaDeConsulta).
//
// Acá viven las piezas sin base (con pruebas en consultas-caja.spec.ts).
// ============================================================

/** Hasta cuándo suena una pregunta sin contestar: lo de anoche todavía, lo de hace dos días ya no. */
export const HORAS_CONSULTA_EN_CAJA = 12;

/** El enviado_a de las consultas que van a la caja (las viejas tienen el teléfono de administración). */
export const ENVIADO_A_CAJA = 'caja';

/**
 * ¿Se le puede mandar esto al cliente tal cual? Devuelve el motivo para la caja, o null si
 * está bien. Lo que escribe la caja le llega al cliente como respuesta final: sin notas
 * internas ni órdenes para el bot.
 */
export function problemaDeLaRespuesta(texto: unknown): string | null {
  const t = String(texto ?? '').trim();
  if (!t) return 'Escribí la respuesta para el cliente.';
  if (t.length > 1000) return 'Es muy larga: dejala en pocas líneas (hasta 1.000 letras).';
  if (/nota interna|no le digas|decile al bot|instrucciones para/i.test(t)) {
    return 'Escribila como se la dirías al cliente: sin notas internas ni indicaciones para el bot.';
  }
  return null;
}

/**
 * La ruta del archivo en el depósito privado del bot, sacada del enlace firmado que se
 * guardó con la consulta (dura una hora): con la ruta, el panel pide uno nuevo cada vez.
 */
export function rutaDeAdjunto(url: unknown): string | null {
  const m = String(url ?? '').match(/\/storage\/v1\/object\/(?:sign|public)\/bot-adjuntos\/([^?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** Lo que vuelve de llevarRespuestaDeConsulta, dicho para quien está en la caja. */
export function resultadoParaLaCaja(r: { contestado?: boolean; motivo?: string; porque?: string } | null | undefined, nombre: string): { ok: boolean; texto: string } {
  if (r?.contestado) return { ok: true, texto: `Le llegó a ${nombre}.` };
  const motivo = String(r?.motivo ?? '');
  if (r?.porque || /guardada como nota/.test(motivo)) {
    return { ok: false, texto: `No le llegó: ${r?.porque || 'la charla está en pausa'}. Quedó anotada en su charla: pasásela vos desde RESPONDE.` };
  }
  if (/ya entregada|en proceso/.test(motivo)) return { ok: false, texto: 'Ya la contestó otra persona.' };
  if (/envío pendiente/.test(motivo)) return { ok: false, texto: 'WhatsApp no la mandó todavía: se reintenta sola en 5 minutos.' };
  if (/incierto/.test(motivo)) return { ok: false, texto: 'WhatsApp no confirmó si le llegó. Mirá su charla antes de mandarla de nuevo.' };
  return { ok: false, texto: motivo ? `No se mandó: ${motivo}.` : 'No se mandó. Probá de nuevo.' };
}

/** Primero la del cliente que insiste; después, la que más espera. */
export function ordenDeLaCaja<T extends { creado_en?: string | null; insistio_en?: string | null }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => {
    const ia = a.insistio_en ? 1 : 0;
    const ib = b.insistio_en ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return Date.parse(String(a.creado_en ?? '')) - Date.parse(String(b.creado_en ?? ''));
  });
}
