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

// Cuántas palabras de `a` aparecen en `b` en el mismo orden (subsecuencia común).
function enOrden(a: string[], b: string[]): number {
  const fila = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(fila[j], fila[j - 1]);
      diag = arriba;
    }
  }
  return fila[b.length];
}

// ¿`nuevo` es una versión ampliada (y quizás corregida) de `previo`? Chrome de
// Android, con escucha continua, manda en cada resultado TODO lo dicho en la
// sesión, y al hacerlo corrige palabras ("necesita" → "necesito", "dos" → "2",
// "ola" → "hola"). Revisión del 2/10: con una comparación exacta, cada
// corrección duplicaba la frase y la bola crecía. Ahora se acepta como la misma
// frase si arranca igual y conserva casi todas las palabras en orden.
export function esAmpliacion(previo: string, nuevo: string): boolean {
  const pa = palabras(previo);
  const pb = palabras(nuevo);
  if (!pa.length) return true;
  if (pb.length < pa.length - 1 || pa[0] !== pb[0]) return false;
  const comunes = enOrden(pa, pb.slice(0, pa.length + 2));
  return pa.length <= 3 ? comunes >= pa.length - 1 : comunes >= Math.ceil(pa.length * 0.7);
}

// Suma un pedazo nuevo a lo que ya hay sin repetirlo (palabra por palabra):
// si lo nuevo es lo anterior ampliado (Android: "hola" → "hola necesito"),
// queda lo nuevo; si lo anterior ya termina con lo nuevo (3 palabras o más,
// para no comerse un "dos" que se dijo dos veces), no se agrega.
export function sumarDictado(previo: string, nuevo: string): string {
  const a = limpiar(previo);
  const b = limpiar(nuevo);
  if (!b) return a;
  if (!a) return b;
  const pa = palabras(a);
  const pb = palabras(b);
  if (pb.length >= pa.length && pa.every((w, i) => pb[i] === w)) return b;
  if (pb.length >= 3 && pa.length >= pb.length && pb.every((w, i) => pa[pa.length - pb.length + i] === w)) return a;
  return `${a} ${b}`;
}

// Dentro de UNA sesión: un final nuevo que es la sesión ampliada o corregida
// (modo acumulado de Android) reemplaza; si no, se suma (Chrome de escritorio
// manda cada pausa como un final aparte).
function sumarEnSesion(sesion: string, final: string): string {
  const a = limpiar(sesion);
  const b = limpiar(final);
  if (!b) return a;
  if (!a) return b;
  if (palabras(b).length >= palabras(a).length && esAmpliacion(a, b)) return b;
  return sumarDictado(a, b);
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
    if (r?.isFinal) conf = sumarEnSesion(conf, t);
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
