// EL "NADA MÁS" CIERRA EL PEDIDO (3/10/2026). Pedido de Leandro: "una vez que
// ya dijo nada más no tiene que preguntar todo el tiempo si lo confirma". El
// bot anota la lista sin precios y pregunta "¿Está completo el pedido o querés
// sumar algo?". Si el cliente la cierra ("solo eso", "nada más", "es todo", o
// un "sí" a esa pregunta), el pedido se confirma en el mismo turno en que
// queda preparado, sin "¿Lo confirmo?". Si falta un dato (retiro o envío, la
// dirección, el día), se pregunta SOLO eso y, con el dato, se confirma sin
// volver a preguntar.
//
// Estricto a propósito: crear un pedido sin "¿Lo confirmo?" solo vale con un
// cierre sin vueltas. Ante la duda, NO cierra: vuelve el resumen con "¿Lo
// confirmo?" de siempre, que es el lado seguro.
//
// Lo que acá es "cierra la lista" tiene su espejo en SQL (la RPC
// confirmar_cotizacion_bot con p_modo 'completo', db/migracion-bot-pedido-completo.sql):
// si se toca una, se toca la otra. Desde el 5/10/2026 la RPC vigente es la de
// db/migracion-bot-pedido-comprobante.sql (trae el mismo modo 'completo'): un
// cambio va en una migración nueva sobre esa, nunca volviendo a correr la del 3/10.

import { RE_PREGUNTA_COMPLETO } from './completo';
import { cantidadesPedidas } from './formatos';
import { nombreLimpio } from './prolijo';

/**
 * Interruptor del "nada más confirma" y de la pregunta "¿A nombre de quién lo
 * retiran?" (3/10/2026). APAGADO: la verificación encontró caminos que podían
 * crear un pedido que el cliente no quiso (un "Si" seguido de "y 2 hielos", un
 * "Cancelalo" tomado como nombre…). Se prende con ODB_NADA_MAS_CONFIRMA=1 cuando
 * estén corregidos y medidos con el banco de pruebas.
 */
export const nadaMasConfirma = () => process.env.ODB_NADA_MAS_CONFIRMA === '1';
export const NADA_MAS_CONFIRMA = nadaMasConfirma();

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const FIN = '(?=$|[\\s,.!…])';

/** Frases que cierran la lista ("solo eso", "nada más"…). */
const FRASES_DE_CIERRE = 'es todo|eso es todo|eso nomas|eso nada mas|eso solo|solo eso|nada mas|por ahora nada mas|por ahora eso|por ahora es todo|con eso (?:esta|alcanza|estamos|va|estoy)|ya esta|esta completo|completo|asi esta bien|esta bien asi|asi nomas';
const RE_FRASE_DE_CIERRE = new RegExp(`^(?:${FRASES_DE_CIERRE})${FIN}`);
/** Un sí corto: cierra solo si contesta "¿Está completo…?" con la lista a la vista. */
const RE_SI_CORTO = new RegExp(`^(?:si+|si ?si|dale|ok|okey|listo|perfecto|genial|barbaro|joya|de una|confirmo|confirmalo|👍|👌)${FIN}`);
/** Lo único que puede venir después del cierre: agradecer o volver a decir que sí. */
const RE_SOLO_RELLENO = new RegExp(`^[\\s,.!…]*(?:(?:gracias+|muchas gracias|mil gracias|por ahora|nomas|nada mas|es todo|eso es todo|eso|asi|asi esta bien|esta bien|todo bien|bien|dale|ok|okey|listo|perfecto|genial|joya|barbaro|de una|confirmo|confirmalo|si+|👍|👌|🙏|🙌|😊|🙂)${FIN}[\\s,.!…]*)*$`);
/** Lo que indica un cambio, una duda o una postergación: no cierra. */
const RE_NO_CIERRA = /\b(no|falta\w*|pero|tambien|sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|mejor|otr[oa]s?|despues|todavia|espera\w*|pienso|veo|cancel\w*)\b|en vez|te (confirmo|aviso)/;
/** Después del cierre, una negativa o una postergación lo anula ("no, esperá", "lo pienso"). */
const RE_ANULA = /\b(no|nop|cancel\w*|esper\w*|para|pienso|pensarlo|lo veo|te aviso|aviso|despues|todavia|consult\w*|dejalo|deja|olvidate)\b|te confirmo|lo confirmo|lo hablo/;

/** "Pedido PICKUP-… confirmado" (aunque venga con algo antepuesto). */
export function esConfirmacionDePedido(texto: unknown): boolean {
  const t = String(texto ?? '');
  return /\b(?:DOM|RET|PICKUP)-[A-Z0-9]{4,}\b/.test(t) && /\bconfirmad[oa]\b/i.test(t) && !/\bcancelad[oa]\b/i.test(t);
}

/** ¿El mensaje del bot es una lista anotada sin precios ("• 3 × Combo Picada Box")? */
export function muestraListaSinPrecios(texto: unknown): boolean {
  const t = String(texto ?? '');
  return /\b\d+(?:[.,]\d+)?\s*(?:kg\s*)?[×x]\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t) && !/\$\s?\d/.test(t);
}

const RE_LO_CONFIRMO = /¿\s*lo confirmo\?/i;

/**
 * ¿Este mensaje del cliente cierra la lista? `ultimoBot` es el mensaje del bot
 * al que contesta.
 */
export function cierraLaLista(texto: string, ultimoBot: string): boolean {
  const crudo = String(texto ?? '').trim();
  const bot = String(ultimoBot ?? '');
  if (!crudo || crudo.includes('?')) return false; // "es todo? cuánto sale?"
  if (crudo.split(/\s+/).length > 8) return false;
  // contestando "¿Lo confirmo?", "no, nada más" quiere decir que NO; y después
  // de un pedido confirmado, "ya está, gracias" es un saludo, no otra lista
  if (RE_LO_CONFIRMO.test(bot) || esConfirmacionDePedido(bot)) return false;
  if (cantidadesPedidas(crudo).length) return false; // "ok, 2 cocas"
  // "no, nada más" cierra: el "no" del principio se saca antes de buscar cambios
  const resto = norm(crudo).replace(/^(?:no|nop|nah)\b[\s,.!]*/, '');
  if (RE_NO_CIERRA.test(resto)) return false;
  const frase = RE_FRASE_DE_CIERRE.exec(resto);
  if (frase) return RE_SOLO_RELLENO.test(resto.slice(frase[0].length));
  // un sí corto, solo contestando "¿Está completo…?" con la lista a la vista
  // (un 👍 a "¿Te ayudo con algo más?" no es un pedido)
  const si = RE_SI_CORTO.exec(resto);
  return !!si && RE_PREGUNTA_COMPLETO.test(bot) && muestraListaSinPrecios(bot) && RE_SOLO_RELLENO.test(resto.slice(si[0].length));
}

/** ¿El mensaje cambia el contenido del pedido (suma, saca, cambia un producto)? */
export function cambiaElContenido(texto: string): boolean {
  const t = norm(texto);
  if (/\b(sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|reemplaz\w*|tambien|poneme|ponele)\b|en vez|en lugar|\bmejor (que sean|\d|un|una|dos|tres)\b|\botr[oa]s? (\d|un|una|mas)\b|\b(y|mas) (un|una|unos|unas|\d+)\b/.test(t)) return true;
  // las fechas y las horas no son cantidades ("15 de octubre", "4/10", "11 hs")
  const sinFechas = String(texto ?? '')
    .replace(/\b\d{1,2}\s+de\s+[a-záéíóúñ]+/gi, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:hs?|horas?)\b/gi, ' ');
  return cantidadesPedidas(sinFechas).length > 0;
}

/** Después de cerrar la lista, ¿la anula? (una negativa, una espera, una duda) */
export function anulaElCierre(texto: string): boolean {
  return RE_ANULA.test(norm(texto));
}

type Mensaje = { role: string; content: unknown };

/**
 * La frase con la que el cliente cerró la lista, si sigue vigente: es el
 * último cierre (incluido el mensaje actual) sin nada después que lo anule:
 * un cambio de contenido, una negativa o una espera, un resumen con "¿Lo
 * confirmo?" (desde ahí rige el "sí" de siempre) o un pedido ya confirmado.
 * Con `soloEsteMensaje` (la charla estuvo quieta horas), solo cuenta el
 * mensaje actual. null: no hay lista cerrada.
 */
export function listaCerrada(historial: Mensaje[], texto: string, opciones: { soloEsteMensaje?: boolean } = {}): string | null {
  const mensajes: Mensaje[] = [...(historial ?? []), { role: 'user', content: texto }];
  let vistos = 0;
  for (let i = mensajes.length - 1; i >= 0 && vistos < 8; i--) {
    const m = mensajes[i];
    const contenido = String(m.content ?? '');
    if (m.role === 'assistant') {
      if (esConfirmacionDePedido(contenido) || RE_LO_CONFIRMO.test(contenido)) return null;
      continue;
    }
    if (m.role !== 'user') continue;
    vistos++;
    const anteriorBot = [...mensajes.slice(0, i)].reverse().find((x) => x.role === 'assistant');
    if (cierraLaLista(contenido, String(anteriorBot?.content ?? ''))) return contenido.trim();
    if (opciones.soloEsteMensaje) return null;
    if (cambiaElContenido(contenido) || anulaElCierre(contenido)) return null;
  }
  return null;
}

/** Lo que el bot anotó (sin precios): los renglones "• 3 × Combo Picada Box". */
export function loAnotado(textoBot: string): { cantidad: number; nombre: string }[] {
  const salida: { cantidad: number; nombre: string }[] = [];
  for (const cruda of String(textoBot ?? '').split('\n')) {
    const l = cruda.trim();
    if (/\$\s?\d/.test(l)) continue;
    const m = l.match(/^[•\-*]\s*(\d+(?:[.,]\d+)?)\s*(?:kg\s*)?[×x]\s*(.+)$/i);
    if (m) salida.push({ cantidad: Number(m[1].replace(',', '.')), nombre: m[2].replace(/\s+(Si algo no es|Si no es)\b.*$/i, '').trim() });
  }
  return salida;
}

/**
 * La última lista sin precios que el bot le mostró al cliente, si no hubo un
 * pedido confirmado después (mira los últimos 8 mensajes del bot).
 */
export function ultimaListaAnotada(historial: Mensaje[]): { cantidad: number; nombre: string }[] {
  for (const m of [...(historial ?? [])].reverse().filter((x) => x.role === 'assistant').slice(0, 8)) {
    const c = String(m.content ?? '');
    if (esConfirmacionDePedido(c)) return [];
    const l = loAnotado(c);
    if (l.length) return l;
  }
  return [];
}

/**
 * ¿Lo que se cotizó es lo que el cliente vio anotado? Mismas cantidades y
 * nombres que coinciden (las palabras del renglón anotado están en el nombre
 * cotizado), sin renglones de más ni de menos. Si el modelo cambió algo,
 * se vuelve a pedir confirmación.
 */
export function coincideConLoAnotado(anotado: { cantidad: number; nombre: string }[], cotizado: { cantidad: number; nombre: string }[]): boolean {
  if (!anotado.length || anotado.length !== cotizado.length) return false;
  const palabras = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const libres = [...cotizado];
  for (const a = anotado.slice(); a.length; ) {
    const r = a.shift()!;
    const pa = palabras(r.nombre);
    const i = libres.findIndex((c) => Math.abs(Number(c.cantidad) - r.cantidad) < 1e-9
      && (pa.length === 0 || pa.filter((w) => norm(c.nombre).includes(w)).length / pa.length >= 0.75));
    if (i < 0) return false;
    libres.splice(i, 1);
  }
  return true;
}

/** Productos que se arman a pedido (las picadas): al retirar, va a nombre de alguien. */
export const RE_ARMADO_A_PEDIDO = /\bpicadas?\b/i;

/** La pregunta del bot por el nombre de quien retira. */
export const PREGUNTA_NOMBRE_RETIRO = '¿A nombre de quién lo retiran?';
export const RE_PREGUNTA_NOMBRE_RETIRO = /¿\s*a nombre de qui[eé]n lo retir/i;

/** Palabras que no son parte de un nombre: si aparece una, no se anota nada. */
const NO_ES_NOMBRE = new Set(('a al la el los las lo le con de del en por para mi mis tu su nombre mismo misma mismos yo vos ' +
  'pago pagar pagamos tarjeta efectivo transferencia debito credito mercadopago alias ' +
  'manana tarde noche mediodia hoy ahora luego ya despues antes temprano hora horas ' +
  'lunes martes miercoles jueves viernes sabado domingo semana dia ' +
  'castex sucursal local canning retiro retira retirar retiramos busca buscar paso envio enviar casa ' +
  'todavia no se si ok dale gracias listo perfecto bueno que cuando como donde cual hijo hija esposa esposo marido mujer mama papa hermano hermana amigo amiga').split(' '));

/**
 * El nombre en la respuesta a "¿A nombre de quién lo retiran?": "Juan Pérez",
 * "a nombre de Ana", "lo retira Carlos", "soy Marta". null si no es claramente
 * un nombre ("a mi nombre", "yo mismo", "con tarjeta", "el sábado"): en ese
 * caso contesta el modelo, y no se anota nada.
 */
export function nombreDeQuienRetira(texto: string): string | null {
  let t = String(texto ?? '').trim().replace(/[.!¡]+$/g, '').replace(/^(hola|buenas|dale|ok|listo|si|sí)[\s,]+/i, '');
  t = t.replace(/^(a nombre de|lo (?:retira|retiro|retiramos|busca|paso a buscar)|la retira|lo va a retirar|va a retirar|retira|soy|me llamo|mi nombre es|es)\s+/i, '');
  if (!t || /[\d?@/:]/.test(t)) return null;
  const n = nombreLimpio(t);
  if (!n) return null;
  const palabras = n.split(/\s+/);
  if (palabras.length > 4) return null;
  if (palabras.some((w) => !/^\p{L}[\p{L}'’-]*$/u.test(w) || NO_ES_NOMBRE.has(norm(w)))) return null;
  return palabras.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// cuándo, en palabras: vive en comun/ (lo usa también el aviso a administración)
export { cuandoLegible } from '../comun/cuando';
