// EL "NADA MÁS" CIERRA EL PEDIDO (3/10/2026). Pedido de Leandro: "una vez que
// ya dijo nada más no tiene que preguntar todo el tiempo si lo confirma". El
// bot anota la lista sin precios y pregunta "¿Está completo el pedido o querés
// sumar algo?". Si el cliente la cierra ("solo eso", "nada más", "es todo", o
// un "sí" a esa pregunta), el pedido se confirma en el mismo turno en que
// queda preparado, sin "¿Lo confirmo?". Si falta un dato (retiro o envío, la
// dirección, el día), se pregunta SOLO eso y, con el dato, se confirma sin
// volver a preguntar.
//
// Lo que acá es "cierra la lista" tiene su espejo en SQL (la RPC
// confirmar_cotizacion_bot con p_modo 'completo', db/migracion-bot-pedido-completo.sql):
// si se toca una, se toca la otra.

import { RE_PREGUNTA_COMPLETO } from './completo';
import { cantidadesPedidas } from './formatos';
import { nombreLimpio } from './prolijo';

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Frases que cierran la lista ("solo eso", "nada más"…). */
const RE_FRASE_DE_CIERRE = /^(es todo|eso es todo|eso nomas|eso solo|solo eso|nada mas|con eso (esta|alcanza|estamos|va)|por ahora eso|ya esta|esta completo|completo|asi esta bien|asi nomas)(\b|[\s,.!…]|$)/;
/** Un sí corto: cierra solo si contesta "¿Está completo…?". */
const RE_SI_CORTO = /^(si+|sisi|si si|dale|ok|okey|listo|perfecto|genial|barbaro|joya|de una|confirmo|confirmalo|👍|👌)(\b|[\s,.!…]|$)/;
/** Lo que indica un cambio, una duda o una postergación: no cierra. */
const RE_NO_CIERRA = /\b(no|falta\w*|pero|tambien|sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|mejor|otr[oa]s?|despues|todavia|espera\w*|pienso|veo|cancel\w*)\b|en vez|te (confirmo|aviso)/;

/**
 * ¿Este mensaje del cliente cierra la lista? `ultimoBot` es el mensaje del bot
 * al que contesta. Estricta a propósito: crear el pedido sin "¿Lo confirmo?"
 * solo vale con un cierre sin vueltas.
 */
export function cierraLaLista(texto: string, ultimoBot: string): boolean {
  const crudo = String(texto ?? '').trim();
  if (!crudo || crudo.includes('?')) return false; // "es todo? cuánto sale?"
  if (crudo.split(/\s+/).length > 8) return false;
  // "no, nada más" cierra: el "no" del principio se saca antes de buscar cambios
  const resto = norm(crudo).replace(/^no\b[\s,.!]*/, '');
  if (RE_NO_CIERRA.test(resto)) return false;
  if (RE_FRASE_DE_CIERRE.test(resto)) return true;
  // un sí corto, solo contestando la pregunta de si está completo ("no" o "no
  // gracias" a "¿…o querés sumar algo?" es ambiguo: no cierra, igual que en SQL)
  return RE_PREGUNTA_COMPLETO.test(String(ultimoBot ?? '')) && RE_SI_CORTO.test(resto);
}

/** ¿El mensaje cambia el contenido del pedido (suma, saca, cambia un producto)? */
export function cambiaElContenido(texto: string): boolean {
  const t = norm(texto);
  if (/\b(sum\w*|agreg\w*|cambi\w*|saca\w*|quita\w*|reemplaz\w*|tambien|otr[oa]s?|mejor)\b|en vez|en lugar/.test(t)) return true;
  return cantidadesPedidas(texto).length > 0;
}

type Mensaje = { role: string; content: unknown };

/**
 * La frase con la que el cliente cerró la lista, si sigue vigente: es el
 * último cierre (incluido el mensaje actual) sin un cambio de contenido
 * después y sin un pedido ya confirmado después. null: no hay lista cerrada.
 */
export function listaCerrada(historial: Mensaje[], texto: string): string | null {
  const mensajes: Mensaje[] = [...(historial ?? []), { role: 'user', content: texto }];
  let vistos = 0;
  for (let i = mensajes.length - 1; i >= 0 && vistos < 8; i--) {
    const m = mensajes[i];
    const contenido = String(m.content ?? '');
    if (m.role === 'assistant') {
      if (/^Pedido \S+ confirmado\./.test(contenido.trim())) return null;
      continue;
    }
    if (m.role !== 'user') continue;
    vistos++;
    const anteriorBot = [...mensajes.slice(0, i)].reverse().find((x) => x.role === 'assistant');
    if (cierraLaLista(contenido, String(anteriorBot?.content ?? ''))) return contenido.trim();
    if (cambiaElContenido(contenido)) return null;
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

/**
 * El nombre en la respuesta a "¿A nombre de quién lo retiran?": "Juan Pérez",
 * "a nombre de Ana", "lo retira Carlos", "soy Marta". null si no es un nombre.
 */
export function nombreDeQuienRetira(texto: string): string | null {
  let t = String(texto ?? '').trim().replace(/[.!¡]+$/g, '').replace(/^(hola|buenas|dale|ok|listo|si|sí)[\s,]+/i, '');
  t = t.replace(/^(a nombre de|lo (?:retira|retiro|retiramos|busca|paso a buscar)|la retira|lo va a retirar|va a retirar|retira|soy|me llamo|mi nombre es|es|de)\s+/i, '');
  t = t.replace(/^(yo,?\s+)/i, '');
  if (/^(yo|mi (esposa|esposo|marido|mujer|hijo|hija|mama|mamá|papa|papá|hermano|hermana))$/i.test(t)) return null;
  const n = nombreLimpio(t);
  if (!n || n.split(/\s+/).length > 4) return null;
  // palabras que no son nombres ("mañana", "gracias", "efectivo")
  if (/^(manana|mañana|gracias|efectivo|tarjeta|transferencia|despues|después|hoy|ahora|nada|no|si|sí|ok|dale)$/i.test(n)) return null;
  return n.replace(/(^|[\s'’-])(\p{L})/gu, (_m, antes: string, letra: string) => antes + letra.toUpperCase());
}

/** "2026-10-04" + "mañana" → "el domingo 4/10 por la mañana" (null sin fecha). */
export function cuandoLegible(fecha: string | null | undefined, franja: string | null | undefined): string | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return franja ? `por la ${franja}` : null;
  const d = new Date(`${fecha}T12:00:00-03:00`);
  const zona = { timeZone: 'America/Argentina/Buenos_Aires' } as const;
  const dia = `${d.toLocaleDateString('es-AR', { weekday: 'long', ...zona })} ${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', ...zona })}`;
  return `el ${dia}${franja ? ` por la ${franja}` : ''}`;
}
