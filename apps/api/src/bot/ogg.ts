// Los audios de WhatsApp llegan vía WAHA, que los convierte a OGG/Opus en el
// momento. Si el archivo se baja apenas entra el webhook, muchas veces está a
// medio escribir: las páginas OGG que hay son válidas, pero falta la última,
// la que lleva la marca de fin de stream (EOS). Resultado real del 2026-09-01:
// TODOS los audios guardados estaban cortados — se escuchaban truncados en
// RESPONDE y la transcripción leía solo el principio.
//
// Un OGG completo termina en una página cuyo header_type tiene el bit 0x04
// (end of stream). Esto lo verifica sin decodificar el audio.
export function oggCompleto(buf: Buffer): boolean {
  const MARCA = Buffer.from('OggS');
  let i = buf.lastIndexOf(MARCA);
  // si la última cabecera quedó cortada antes del byte de tipo, mirá la anterior
  while (i >= 0 && i + 6 > buf.length) i = buf.lastIndexOf(MARCA, i - 1);
  if (i < 0) return false; // ni una página: no es un OGG válido
  return (buf[i + 5] & 0x04) !== 0;
}
