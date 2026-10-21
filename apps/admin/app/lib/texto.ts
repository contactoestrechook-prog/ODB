// Última barrera del panel contra el texto basura (21/10/2026, Envíos: «misma
// basura»). La API ya limpia al guardar y al mostrar; esto cubre lo que llegue
// por otro lado (una pantalla vieja, un dato anterior al arreglo).
//
// Es COPIA de apps/api/src/comun/texto-limpio.ts (el panel no puede importar de
// la API) y de la función texto_sin_marcado de la base
// (db/migracion-envios-pro.sql): si la regla cambia, cambia en los tres.

// El comienzo de algo que es marcado y no texto de una persona: las etiquetas
// del modelo, un cierre «</algo», una etiqueta con atributos entre comillas o
// una de HTML conocida. Una palabra cualquiera entre < > («<azul>», «<A>») NO
// es marcado: la escribió una persona. La barra puede venir escapada
// («<\/antml…», visto en producción en septiembre).
const APERTURA_MARCADO =
  /<\s*\\*\/?\s*(?:antml|parameter|invoke|function)|<\\*\/\s*[a-z]|<[a-z][a-z0-9_:.-]*\s+[a-z0-9_:.-]+\s*=\s*["']|<(?:br|hr|div|span|img|strong|em|ul|ol|li|table|tbody|thead|tr|td|th|h[1-6]|pre|code|small|font|center|script|style|iframe|svg|html|head|body|meta|button|input|form|textarea|select|option|label)\s*\/?>/i;

// Las de una letra («<b>», «<i>»…) solo en minúscula, como las escribe una máquina.
const ETIQUETA_DE_UNA_LETRA = /<[abipsu]\s*\/?>/;

function inicioDelMarcado(t: string): number {
  const posiciones = [APERTURA_MARCADO.exec(t)?.index, ETIQUETA_DE_UNA_LETRA.exec(t)?.index].filter((p): p is number => p !== undefined);
  return posiciones.length ? Math.min(...posiciones) : -1;
}

// Invisibles y de control. Quedan: tabulador, salto de línea, retorno de carro
// (se normalizan después) y el unidor de ancho cero (\u200D) que arma los
// emojis compuestos de los nombres de WhatsApp.
const INVISIBLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2060-\u2064\uFEFF]/g;

// Lo que el modelo (o alguien apurado) pone cuando no hay dato.
const RELLENO = /^(?:null|undefined|none|n\/?a|na|vac[ií]o|ningun[ao]|sin (?:notas|indicaciones|datos|aclaraciones)|-+|—|–|\.+)$/i;

// Un rótulo solo, sin nada atrás: «WhatsApp: </antml…» queda en «WhatsApp».
const ROTULO_SOLO = /^(?:whatsapp|notas?|indicaciones|observaciones|comentarios?|aclaraci[oó]n(?:es)?|direcci[oó]n|nombre)$/i;

type OpcionesLimpieza = {
  /** Nombres y direcciones: todo en un renglón y sin apartes entre < >. */
  unaLinea?: boolean;
};

/** El texto sin restos de marcado ni relleno. Nunca devuelve null: '' si no queda nada. */
export function sinRestosDeMarcado(v: unknown, { unaLinea = false }: OpcionesLimpieza = {}): string {
  if (v === null || v === undefined) return '';
  let t = String(v).replace(INVISIBLES, '');
  const corte = inicioDelMarcado(t);
  if (corte >= 0) t = t.slice(0, corte);
  t = unaLinea
    ? t.replace(/<([^<>]*)>/g, ' $1 ').replace(/\s+/g, ' ')
    : t.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.trim().replace(/[\s·:;,|\-–—]+$/u, '').trim();
  if (RELLENO.test(t) || ROTULO_SOLO.test(t)) return '';
  return t;
}

/** Lo que se muestra de un texto que pudo escribir el bot o un cliente: sin marcado ni relleno; null si no queda nada. */
export function textoVisible(v: unknown, opciones: OpcionesLimpieza = {}): string | null {
  return sinRestosDeMarcado(v, opciones) || null;
}
