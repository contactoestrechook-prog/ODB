// RÁFAGAS DE WHATSAPP (8/10/2026). Pedido de Leandro: «tiene que esperar entre
// un minuto, un minuto y medio antes de contestar de último».
//
// El caso: Los Talas, Lote 15, mandó 5 mensajes en 14 segundos («6 BIDONES DE
// AGUA», «15 PACK DE VILLAVICENCIO», «1 PACK DE 6 DE LECHE PROTEIN», «les dejo un
// pedido para el lote 15», «Saludooos»). La cola por conversación contestaba cada
// uno por separado, sin saber que venían más: fueron 5 respuestas en 3 minutos,
// que repetían el pedido y volvían a pedir el nombre. Desde el lado del cliente,
// el bot «le volvía a escribir» sin que él contestara.
//
// Ahora, por WhatsApp, cada mensaje espera ESPERA desde el último del mismo chat,
// sin pasar TOPE desde el primero, y la charla corre UNA vez con todo junto.
// Acá solo están las cuentas, sin estado: el estado vive en BotService
// (charlaWhatsapp).

export type MensajeDeRafaga = {
  linea?: string;
  numeroLinea?: string;
  telefono: string;
  mensaje?: string;
  mensajeId?: string;
  archivoBase64?: string;
  mimeType?: string;
  archivoUrl?: string;
  vistaPreviaDeVideo?: boolean;
  deAudio?: boolean;
};

/**
 * La espera configurada: ODB_BOT_ESPERA_SEG (60) y ODB_BOT_ESPERA_MAX_SEG (180). 0 = contestar al instante, como antes.
 * 9/10/2026: el tope era 90 s desde el PRIMER mensaje, y con un cliente que
 * seguía escribiendo el bot le contestaba a los 0–17 s de su último mensaje
 * (Leandro: «que no responda al segundo»). Ahora el tope es de 3 minutos: en
 * la práctica siempre espera un minuto de silencio.
 */
export function esperaDeRafaga(env: Record<string, string | undefined> = process.env): { esperaMs: number; topeMs: number } {
  const seg = (v: unknown, def: number) => {
    if (v == null || String(v).trim() === '') return def;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  const espera = seg(env.ODB_BOT_ESPERA_SEG, 60);
  const tope = Math.max(espera, seg(env.ODB_BOT_ESPERA_MAX_SEG, 180));
  return { esperaMs: espera * 1000, topeMs: tope * 1000 };
}

/** Cuánto falta para contestar: `esperaMs` desde ahora (el último mensaje), sin pasar `topeMs` desde el primero. */
export function msHastaContestar(primero: number, ahora: number, esperaMs: number, topeMs: number): number {
  return Math.max(0, Math.min(esperaMs, primero + topeMs - ahora));
}

/** Un segundo archivo cierra la ráfaga: charla() mira un archivo por turno. */
export function cierraLaRafaga(pendientes: MensajeDeRafaga[], nuevo: MensajeDeRafaga): boolean {
  return !!nuevo.archivoBase64 && pendientes.some((d) => !!d.archivoBase64);
}

/**
 * Los mensajes de una ráfaga en un solo turno: los textos en orden, separados
 * por salto de línea, el archivo si vino alguno y el id del ÚLTIMO mensaje (el
 * que lleva la respuesta).
 */
export function juntarRafaga(pendientes: MensajeDeRafaga[]): MensajeDeRafaga {
  if (!pendientes.length) throw new Error('ráfaga vacía');
  const ultimo = pendientes[pendientes.length - 1];
  if (pendientes.length === 1) return ultimo;
  const conArchivo = pendientes.find((d) => !!d.archivoBase64);
  const textos = pendientes.map((d) => String(d.mensaje ?? '').trim()).filter(Boolean);
  const juntado: MensajeDeRafaga = {
    linea: ultimo.linea,
    numeroLinea: ultimo.numeroLinea,
    telefono: ultimo.telefono,
    mensaje: textos.join('\n'),
    mensajeId: ultimo.mensajeId,
  };
  if (conArchivo) {
    juntado.archivoBase64 = conArchivo.archivoBase64;
    juntado.mimeType = conArchivo.mimeType;
    juntado.archivoUrl = conArchivo.archivoUrl;
    if (conArchivo.vistaPreviaDeVideo) juntado.vistaPreviaDeVideo = true;
  }
  if (pendientes.some((d) => d.deAudio)) juntado.deAudio = true;
  return juntado;
}
