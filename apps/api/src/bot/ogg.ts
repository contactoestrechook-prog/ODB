// ¿El audio que bajamos de WAHA está entero?
//
// Historia: el 1/9/2026 se vieron audios guardados cortados y se agregó un
// chequeo que exigía la marca de fin de stream (bit EOS 0x04 en la última
// página OGG), con 5 reintentos de 1,5 s. Medido el 2/10/2026 sobre 231 notas
// de voz reales (WAHA 2026.8.2, motor NOWEB): NINGUNA trae esa marca — las
// arma así WhatsApp (vendor "WhatsApp" en OpusTags) — y todas estaban
// completas: mismo tamaño que el fileLength que declara WhatsApp y misma
// duración que sus "seconds". El chequeo viejo daba siempre "a medio
// escribir": cada audio esperaba 7 s de más y el log decía "puede estar
// cortado" sin estarlo. WAHA NOWEB guarda el archivo antes de mandar el webhook.
//
// Ahora un audio está entero si (en este orden):
//   1) mide exactamente lo que WhatsApp declaró (fileLength), o
//   2) tiene la marca EOS, o
//   3) sus páginas OGG encadenan justo hasta el último byte y el tamaño no
//      cambió entre dos bajadas (si todavía se estuviera escribiendo, crecería).

export type EstadoOgg = {
  paginasEnteras: boolean; // las páginas encadenan hasta el último byte, sin sobrar ni faltar
  eos: boolean; // la última página trae la marca de fin de stream
  segundos: number | null; // duración por el granule de la última página (Opus: 48 kHz)
};

const CAPTURA = 0x5367674f; // 'OggS' leído como uint32 little endian

export function estadoOgg(buf: Buffer): EstadoOgg {
  let off = 0;
  let ultima = -1;
  while (off + 27 <= buf.length && buf.readUInt32LE(off) === CAPTURA) {
    const segmentos = buf[off + 26];
    if (off + 27 + segmentos > buf.length) break; // tabla de segmentos cortada
    let carga = 0;
    for (let k = 0; k < segmentos; k++) carga += buf[off + 27 + k];
    const fin = off + 27 + segmentos + carga;
    if (fin > buf.length) break; // la última página no terminó de escribirse
    ultima = off;
    off = fin;
  }
  if (ultima < 0) return { paginasEnteras: false, eos: false, segundos: null };
  const granule = buf.readBigInt64LE(ultima + 6);
  return {
    paginasEnteras: off === buf.length,
    eos: (buf[ultima + 5] & 0x04) !== 0,
    segundos: granule > 0n ? Number(granule) / 48000 : null,
  };
}

// Solo la marca de fin de stream. Sirve como prueba positiva, pero su falta NO
// prueba que esté cortado (las notas de WhatsApp no la traen): la decisión
// completa la toma bajarMediaWaha con audioDeclarado y estadoOgg.
export function oggCompleto(buf: Buffer): boolean {
  return estadoOgg(buf).eos;
}

// Lo que WhatsApp declara de una nota de voz en el payload de WAHA (NOWEB:
// _data.message.audioMessage). fileLength puede venir como número, texto o
// Long de protobuf ({ low, high }).
export function audioDeclarado(p: any): { bytes: number | null; segundos: number | null } {
  const m = p?._data?.message ?? {};
  const a = m.audioMessage ?? m.pttMessage ?? m.ephemeralMessage?.message?.audioMessage ?? m.viewOnceMessage?.message?.audioMessage ?? null;
  const num = (v: any) => {
    if (v == null) return null;
    if (typeof v === 'object' && 'low' in v) return Number(v.low) + Number(v.high ?? 0) * 2 ** 32;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { bytes: num(a?.fileLength), segundos: num(a?.seconds) };
}
