// UNA sola regla para sacar de un texto lo que no escribió una persona
// (Leandro, 21/10/2026: «misma basura» en Envíos).
//
// El caso: DOM-YD5GNY mostraba «Indicaciones: WhatsApp: </antml name
// diretipo">domicilio». No era un teléfono mal cargado: era el bot de agosto
// escribiendo un pedazo de su propia sintaxis de herramientas en el campo notas
// (el cierre de "notas" y el parámetro siguiente, tipo = domicilio), con la
// etiqueta del canal adelante. Había cuatro limpiezas distintas, cada una con
// su regla; esta las reemplaza:
//
// - Saca los caracteres invisibles y de control (deja saltos de línea; deja el
//   unidor de los emojis compuestos).
// - CORTA desde la primera apertura de marcado: las etiquetas del modelo
//   («</antml…», «<parameter», «<invoke», «<function…»), un cierre («</algo»),
//   una etiqueta con atributos entre comillas («<x a="…»), una etiqueta de HTML
//   conocida («<div>», «<br/>») o una de una letra en minúscula («<b>», «<i>»).
//   Corta en vez de borrar la etiqueta porque lo que viene después es OTRO
//   campo, no la continuación de la nota.
//   Una palabra cualquiera entre < > NO es marcado (21/10/2026, revisión):
//   «Lote 12 <azul> rejas», «Tocar timbre <urgente> y dejar en guardia» o
//   «Casa <A> timbre 2» los escribió una persona y antes se cortaban.
// - En nombres y direcciones (una línea) un aparte entre < > que empieza con
//   letra pierde los signos («<casa con portón>» → «casa con portón»); lo que
//   no empieza con letra queda entero, aunque haya un < y un > en el mismo
//   renglón («Juli <3, lote 95 > portón», «Entrar <- portón negro -> no el
//   blanco»; antes se comía los signos de los dos). Se repite hasta que no
//   quede ninguno, así limpiar dos veces da lo mismo que una: el disparador de
//   la base limpia de nuevo cada vez que se guarda (antes «x <y <z> w> v» se
//   iba gastando de a un par por guardado).
// - Saca separadores que quedaron colgando al final («WhatsApp:», «… ·»).
// - Un relleno («null», «N/A», «vacío») o una etiqueta sola («WhatsApp»,
//   «Notas») no es un dato: queda vacío.
//
// Respeta lo legítimo: «Lote 95 <casa con portón negro>», «Pedido > $70.000»,
// las comillas de «Foodtruck "Rincón"» y las citas «[esperando] > Buen día».
//
// La misma regla está en la base (db/migracion-envios-pro.sql,
// texto_sin_marcado) y en el panel (apps/admin/app/lib/texto.ts): si cambia
// acá, cambia en los tres lugares.

// El comienzo de algo que es marcado y no texto de una persona. La barra puede
// venir escapada («<\/antml…», visto en producción en septiembre). La clase de
// caracteres es [a-z0-9_:.-] acá, en el panel y en la base: antes la API usaba
// \w (sin tildes) y la base [[:alnum:]] (con tildes), y «<portón>» se cortaba
// en un lado y en el otro no.
export const APERTURA_MARCADO =
  /<\s*\\*\/?\s*(?:antml|parameter|invoke|function)|<\\*\/\s*[a-z]|<[a-z][a-z0-9_:.-]*\s+[a-z0-9_:.-]+\s*=\s*["']|<(?:br|hr|div|span|img|strong|em|ul|ol|li|table|tbody|thead|tr|td|th|h[1-6]|pre|code|small|font|center|script|style|iframe|svg|html|head|body|meta|button|input|form|textarea|select|option|label)\s*\/?>/i;

// Las de una letra («<b>», «<i>», «<a>»…) solo en minúscula, como las escribe
// una máquina: «Casa <A> timbre 2» es una persona.
export const ETIQUETA_DE_UNA_LETRA = /<[abipsu]\s*\/?>/;

/** Dónde empieza el marcado (-1 si no hay). */
export function inicioDelMarcado(t: string): number {
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

// Un aparte entre < > que empieza con letra (ver arriba).
const APARTE = /<(\p{L}[^<>]*)>/gu;

/** Saca los signos de los apartes hasta que no quede ninguno (idempotente). */
function sinApartes(t: string): string {
  let antes: string;
  do {
    antes = t;
    t = t.replace(APARTE, ' $1 ');
  } while (t !== antes);
  return t;
}

export type OpcionesLimpieza = {
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
    ? sinApartes(t).replace(/\s+/g, ' ')
    : t.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.trim().replace(/[\s·:;,|\-–—]+$/u, '').trim();
  if (RELLENO.test(t) || ROTULO_SOLO.test(t)) return '';
  return t;
}

/**
 * Une pedazos de una nota limpiando CADA UNO antes: la regla corta desde la
 * primera etiqueta, así que una etiqueta en lo que escribió el cliente se
 * llevaba también lo que el sistema agrega detrás («SIN MATCHEAR: …», la
 * forma de pago). Ya limpios, la limpieza del total (la API y el disparador
 * de la base) no corta nada.
 */
export function unirLimpio(partes: unknown[], separador = ' · '): string {
  return partes.map((p) => sinRestosDeMarcado(p)).filter(Boolean).join(separador);
}

/** Igual que sinRestosDeMarcado, pero null cuando no queda nada (para grabar en la base). */
export function textoONulo(v: unknown, opciones: OpcionesLimpieza = {}): string | null {
  return sinRestosDeMarcado(v, opciones) || null;
}

/**
 * Limpia EN SU LUGAR todos los textos de lo que manda una herramienta del bot
 * (también los de listas y objetos adentro). Una sola pasada a la entrada:
 * así ninguna herramienta guarda restos de la sintaxis del modelo.
 */
export function limpiarEntradaDeHerramienta<T>(entrada: T): T {
  const limpiar = (x: any): any => {
    if (typeof x === 'string') return sinRestosDeMarcado(x);
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i++) x[i] = limpiar(x[i]);
      return x;
    }
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) x[k] = limpiar(x[k]);
      return x;
    }
    return x;
  };
  return limpiar(entrada);
}
