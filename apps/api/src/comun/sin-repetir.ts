import { normalizarTexto } from './busqueda';

// LO QUE EL MODELO DIJO ANTES DE UNA HERRAMIENTA Y LO QUE DICE AL FINAL, SIN
// REPETIR (revisión del 6/10/2026, Opus 5.5).
//
// El bot y el agente de compras juntan lo que el modelo escribe en cada vuelta:
// antes el modelo contestaba algo («Anotado a nombre de Pablo.»), llamaba una
// herramienta y cerraba corto («El Malbec sale $5.000.»), y si se tomaba solo
// lo último, lo primero se perdía. Desde el 6/10 el prompt le pide el mensaje
// COMPLETO al final («si ya le contestaste algo y después llamaste una
// herramienta, repetilo»), porque en Opus 5.5 lo escrito entre herramientas
// suele volver dentro del razonamiento, vacío. Pero las notas cortas (una o dos
// oraciones) siguen llegando como texto: pegar lo de antes con el final ahora
// juntaba el original con su repetición («Anotado a nombre de Pablo.» y abajo
// «Anotado, Pablo. Retirás mañana.»), y con ODB_BOT_MODELO de vuelta en Opus 5
// pasaba siempre.
//
// La regla: un final largo (60 caracteres o más) ya es el mensaje entero y va
// solo, como siempre. Un final corto lleva adelante SOLO las oraciones de antes
// que no dice: una oración cuyas palabras están casi todas en el final (60 % o
// más) ya está dicha. Sin final, lo de antes tal cual (sin duplicados).

// palabras que no dicen nada propio (las de menos de 3 letras ya quedan afuera)
const VACIAS = new Set(('los las les que con por para una uno unos unas del como pero mas sus muy esta este esto eso esa ese ' +
  'hay son ser fue vos te tu sos ahi aca alla bien todo toda todos todas').split(' '));

function palabras(texto: string): string[] {
  return normalizarTexto(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !VACIAS.has(w));
}

/** Las oraciones de un texto, por renglón (para no romper una lista). */
function renglones(texto: string): string[][] {
  return texto.split('\n').map((r) => r.split(/(?<=[.!?])\s+/).filter((o) => o.trim()));
}

/** ¿El final ya dice esta oración (con otras palabras o tal cual)? */
export function yaLoDice(oracion: string, final: string): boolean {
  const p = palabras(oracion);
  if (!p.length) return true; // «Ok.», «Dale.»: nada propio que se pierda
  const delFinal = new Set(palabras(final));
  return p.filter((w) => delFinal.has(w)).length / p.length >= 0.6;
}

/**
 * Lo que sale: el final, con adelante lo de antes que el final no dice.
 * `antes` son los textos de las vueltas anteriores, en orden.
 */
export function unirConLoDicho(antes: string[], final: string, largoSuficiente = 60): string {
  const f = String(final ?? '').trim();
  const previos = [...new Set(antes.map((t) => String(t ?? '').trim()).filter(Boolean))].join('\n\n');
  if (!f) return previos;
  if (f.length >= largoSuficiente || !previos) return f;
  const quedan = renglones(previos)
    .map((r) => r.filter((o) => !yaLoDice(o, f)).join(' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return quedan ? `${quedan}\n\n${f}` : f;
}
