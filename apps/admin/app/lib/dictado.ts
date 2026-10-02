// La cuenta del dictado por voz (BotonMicrofono). Vive en el panel porque corre
// en el navegador; se prueba desde la API (apps/api/src/comun/dictado.spec.ts).
//
// 2/10/2026, «los audios se cortan a los 5 segundos»: el micrófono del panel
// escuchaba con continuous = false, así que el navegador lo cortaba en la
// primera pausa, y al volver a tocarlo lo nuevo BORRABA lo ya dictado (los
// llamadores pasaban setTexto). Ahora se escucha de corrido, se reinicia si el
// navegador corta solo y todo se SUMA a lo que ya había en la caja.
//
// Revisión adversarial del mismo día (lo que se corrigió acá):
// - la deduplicación va POR SESIÓN de reconocimiento: Chrome de Android manda
//   en cada resultado todo lo dicho EN ESA SESIÓN, y comparar contra lo de las
//   sesiones anteriores duplicaba frases después de cada reinicio;
// - se compara por palabras enteras, no por letras;
// - lo que ya estaba en la caja (base) se respeta tal cual, con sus renglones.

const limpiar = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim();
const palabras = (t: string) =>
  limpiar(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;:!?¡¿"()]/g, '').split(' ').filter(Boolean);

// Suma un pedazo nuevo a lo que ya hay sin repetirlo (palabra por palabra):
// si lo nuevo empieza con todo lo anterior (Android: "hola" → "hola necesito"),
// queda lo nuevo; si lo anterior ya termina con lo nuevo, no se agrega.
export function sumarDictado(previo: string, nuevo: string): string {
  const a = limpiar(previo);
  const b = limpiar(nuevo);
  if (!b) return a;
  if (!a) return b;
  const pa = palabras(a);
  const pb = palabras(b);
  if (pb.length >= pa.length && pa.every((w, i) => pb[i] === w)) return b;
  if (pa.length >= pb.length && pb.every((w, i) => pa[pa.length - pb.length + i] === w)) return a;
  return `${a} ${b}`;
}

type Resultado = { isFinal: boolean; 0: { transcript: string } };

// Procesa un evento onresult DE UNA SESIÓN: suma los finales nuevos (desde
// resultIndex) a lo ya confirmado en esa sesión y devuelve el parcial en curso.
export function procesarResultados(
  sesion: string,
  resultados: ArrayLike<Resultado>,
  desde: number,
): { sesion: string; parcial: string } {
  let conf = sesion;
  let parcial = '';
  for (let i = Math.max(0, desde); i < resultados.length; i++) {
    const r = resultados[i];
    const t = r?.[0]?.transcript ?? '';
    if (r?.isFinal) conf = sumarDictado(conf, t);
    else parcial = sumarDictado(parcial, t);
  }
  return { sesion: conf, parcial };
}

// Al terminar una sesión (el navegador cortó y se reinicia): lo de esa sesión,
// y el parcial que haya quedado sin confirmar, pasan a lo dictado antes. Entre
// sesiones se concatena: la deduplicación es solo dentro de cada una.
export function cerrarSesion(previo: string, sesion: string, parcial: string): string {
  const dichoEnSesion = sumarDictado(sesion, parcial);
  return [limpiar(previo), dichoEnSesion].filter(Boolean).join(' ');
}

// Lo que se muestra en la caja: lo que había antes de tocar el micrófono (tal
// cual, con sus renglones), más lo dictado en sesiones anteriores, más la
// sesión actual y lo que se está diciendo ahora.
export function textoDictado(base: string, previo: string, sesion: string, parcial: string): string {
  const dicho = [limpiar(previo), sumarDictado(sesion, parcial)].filter(Boolean).join(' ');
  const b = String(base ?? '').replace(/\s+$/, '');
  if (!dicho) return b;
  if (!b) return dicho;
  return `${b}${/\n$/.test(String(base ?? '')) ? '\n' : ' '}${dicho}`;
}

// ¿La caja cambió desde afuera mientras se dictaba? (se envió y se vació, o la
// persona escribió a mano). `emitidos` son los últimos textos que puso el
// propio dictado: React puede mostrar uno anterior antes de actualizarse.
export function cambioExterno(textoActual: string, emitidos: readonly string[]): boolean {
  return !emitidos.includes(String(textoActual ?? ''));
}
