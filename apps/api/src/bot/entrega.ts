// Retiro o envío lo elige el cliente (23/9/2026): si el bot lo preguntó y el
// cliente contestó otra cosa, no se arma el resumen dando uno por elegido.

/** El último mensaje del bot pregunta si retira o se lo enviamos. */
export function esperaRetiroOEnvio(ultimoBot: string): boolean {
  const t = String(ultimoBot ?? '');
  return /¿[^?]*\bretir\w*[^?]*\b(env[ií]\w*|domicilio)[^?]*\?/i.test(t) || /¿[^?]*\b(env[ií]\w*|domicilio)[^?]*\bretir\w*[^?]*\?/i.test(t);
}

/** El mensaje del cliente elige retiro o envío (o da una dirección). */
export function eligeRetiroOEnvio(texto: string): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(retir\w*|busc\w*|paso|pasamos|voy|vamos|sucursal|local|saint|castex|st)\b/.test(t)) return true;
  if (/\b(envi\w*|mand\w*|traer\w*|traelo|domicilio|delivery|a casa|a mi casa|entrega\w*)\b/.test(t)) return true;
  // una dirección: calle + número
  return /[a-z]{3,}\s+\d{2,5}\b/.test(t) && !/^\s*\d+\s/.test(t) && !/\b(ml|cc|l|lt|kg|gr|litros?)\b/.test(t);
}

/**
 * ¿El cliente eligió ESTA modalidad en algún mensaje? Retiro: lo dijo con
 * palabras (retiro, paso a buscar, por la sucursal…). Envío: lo pidió, o la
 * dirección del pedido aparece en lo que escribió. Una cantidad con medida
 * ("Branca 750") no es una dirección (banco 25/9/2026).
 */
export function eligioModalidad(tipo: string, direccion: string, mensajes: string[]): boolean {
  const norm = (x: string) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const textos = mensajes.map(norm);
  if (tipo === 'pickup') return textos.some((t) => /\b(retir\w*|busc\w*|paso|pasamos|voy|vamos|sucursal|local|saint|castex)\b/.test(t));
  if (textos.some((t) => /\b(envi\w*|mand\w*|traer\w*|traelo|domicilio|delivery|a casa|a mi casa|entrega\w*)\b/.test(t))) return true;
  const calleNumero = norm(direccion).match(/([a-z]{3,})\s+(\d{1,5})\b/);
  return !!calleNumero && textos.some((t) => t.includes(calleNumero[1]) && t.includes(calleNumero[2]));
}
