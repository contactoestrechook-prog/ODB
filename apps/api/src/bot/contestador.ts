// CONTESTADORES AUTOMÁTICOS DEL OTRO LADO (24/9/2026). Un número de otra
// empresa con bot de menú ("*Tocá la opción* del tema…", "Perdón, sólo puedo
// responderte si tocás un botón") y nuestro bot se pusieron a charlar en ronda:
// cada respuesta de uno disparaba la del otro. A una máquina no se le contesta:
// el mensaje queda en el hilo y se calla. Si después escribe una persona, se la
// atiende normal (la detección es por mensaje, no marca al número para siempre).

const RE_FRASE_DE_BOT = new RegExp([
  'toc[aá] (?:la |una )?opci[oó]n',
  'toc[aá]s? (?:un |el )?bot[oó]n',
  'eleg[ií] (?:una |la )?opci[oó]n',
  'seleccion[aá] (?:una |la )?opci[oó]n',
  'seleccione (?:una |la )?opci[oó]n',
  'respond[eé] con (?:el )?n[uú]mero',
  'ingres[aá] (?:el )?n[uú]mero de (?:la )?opci[oó]n',
  'opci[oó]n (?:inv[aá]lida|incorrecta|no v[aá]lida)',
  's[oó]lo puedo responderte',
  'no (?:logro|pude|puedo) (?:comprenderte|entenderte)',
  'no (?:entend[ií]|comprend[ií]) tu (?:mensaje|consulta|respuesta)',
  'men[uú] principal',
  'volver al men[uú]',
  'escrib[ií] ["«*]?men[uú]',
  'mensaje autom[aá]tico',
  'respuesta autom[aá]tica',
  'soy (?:un |el )?(?:asistente|bot|robot) virtual',
  'nos pasa hasta a los mejores',
].join('|'), 'i');

/** El mensaje tiene la forma de un contestador automático de menú. */
export function esFraseDeBot(texto: string): boolean {
  return RE_FRASE_DE_BOT.test(String(texto ?? '').replace(/[*_~]/g, ''));
}

/**
 * ¿Del otro lado hay una máquina? Sí si este mensaje es una frase de bot, o si
 * el mismo texto (largo) ya llegó dos veces antes: una persona no repite tres
 * veces la misma oración entera.
 */
export function esContestadorAutomatico(texto: string, anterioresDelCliente: string[]): boolean {
  if (esFraseDeBot(texto)) return true;
  const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9áéíóúñü ]/g, '').replace(/\s+/g, ' ').trim();
  const t = norm(texto);
  if (t.length < 25) return false;
  return anterioresDelCliente.filter((a) => norm(a) === t).length >= 2;
}
