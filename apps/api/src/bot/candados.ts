// ============================================================
// CANDADOS (9/10/2026). Leandro: «corregí las cosas para siempre, no pueden
// seguir pasando estas cosas, poné candados definitivos».
//
// No dependen de que el modelo obedezca el prompt: se aplican en código, a la
// respuesta ya escrita, justo antes de mandarla.
//
// 1. Nunca un total sin su lista. Si en el turno se cotizó el pedido y la
//    respuesta da un total pero no trae todos los renglones, la lista se arma
//    con los datos de la cotización (no con lo que escribió el modelo) y sale
//    como placa. Caso: 14:51, «me pasás la cuenta final?» → «Saco la sal y sumo
//    1 × Absolut… Total: $133.600» sin la lista.
// 2. Nunca la misma oración dos veces. Lo que el bot ya dijo en los últimos
//    mensajes de la charla no se vuelve a decir. Caso: «Saco la sal y sumo 1 ×
//    Absolut vodka clásico…» a las 14:49 y otra vez a las 14:51. Los renglones
//    de una lista y el total no cuentan: una lista actualizada los repite.
// ============================================================

import { pesos } from './comercio';

type RenglonCotizado = { nombre?: string; renglon?: string; subtotal?: number; subtotalEfectivo?: number; error?: string; reemplazo_no_confirmado?: boolean; alcanzaElStock?: boolean };
export type Cotizacion = { renglones?: RenglonCotizado[]; total?: number; totalEfectivo?: number; hayFaltantes?: boolean; reemplazoSinConfirmar?: unknown } | null | undefined;

const normal = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esRenglonDeLista = (l: string) => /^\s*[•·*-]\s/.test(l);
const esLineaDeTotal = (l: string) => /^\s*\*?\s*total\b/i.test(l);
const oraciones = (t: string) => t.split(/(?<=[.!?])\s+/).map((o) => o.trim()).filter(Boolean);

/** Candado 1: un total siempre viaja con su lista completa, armada desde la cotización del turno. */
export function totalConSuLista(respuesta: string, cot: Cotizacion): string {
  const r = String(respuesta ?? '');
  // solo con una cotización COMPLETA: con faltantes, un reemplazo sin aceptar o un renglón con
  // error el total es parcial, y armar la lista le mostraría al cliente algo que no se puede confirmar
  const todos = cot?.renglones ?? [];
  if (!cot || cot.hayFaltantes || cot.reemplazoSinConfirmar || todos.some((x) => x.error || x.reemplazo_no_confirmado || x.alcanzaElStock === false || !x.renglon || !x.nombre)) return r;
  const renglones = todos;
  if (!renglones.length || !(Number(cot.total) > 0)) return r;
  // ¿la respuesta da un total o un monto? sin plata en el texto, no hay nada que proteger
  if (!/\btotal\b|\$\s?\d/i.test(r)) return r;
  // ¿ya trae todos los renglones como lista? entonces está bien
  const lineas = r.split('\n');
  const listados = lineas.filter(esRenglonDeLista).map(normal);
  const estanTodos = renglones.every((x) => listados.some((l) => l.includes(normal(String(x.nombre)).slice(0, 18))));
  if (estanTodos && lineas.some(esLineaDeTotal)) return r;

  const lista = renglones.map((x) => `• ${x.nombre} — ${x.renglon}${x.subtotalEfectivo != null && x.subtotal != null && x.subtotalEfectivo < x.subtotal ? ` ($${pesos(x.subtotalEfectivo)} en efectivo o transferencia)` : ''}`);
  const total = `Total: $${pesos(Number(cot.total))}${cot.totalEfectivo != null && cot.totalEfectivo < Number(cot.total) ? `, o $${pesos(cot.totalEfectivo)} en efectivo o transferencia` : ''}`;
  // de lo que escribió el modelo se va SOLO lo que la lista reemplaza: renglones (cantidad × precio)
  // y los montos del total o de los renglones. Quedan las preguntas, el mínimo, el envío y el retiro.
  const montos = [cot.total, cot.totalEfectivo, ...renglones.flatMap((x) => [x.subtotal, x.subtotalEfectivo])]
    .filter((n): n is number => Number(n) > 0).map((n) => `$${pesos(Number(n))}`);
  const reemplazada = (o: string) => !/\?\s*$/.test(o) && (/^\*?\s*total\b/i.test(o) || /\d\s*[×x]\s|c\/u/i.test(o) || montos.some((m) => new RegExp(`${m.replace(/[$.]/g, (c) => `\\${c}`)}(?!\\d)`).test(o)));
  // la frase que presentaba la lista («Así queda el pedido:») queda colgada: se va (9/10/2026,
  // charla de Leandro: «Así queda el pedido: El envío es sin cargo. ¿Lo retirás…?»)
  const RE_PRESENTA_LISTA = /^(?:as[ií] (?:queda|quedar[ií]a)(?: (?:el|tu) pedido)?|(?:el |tu )?pedido (?:queda|quedar[ií]a)(?: as[ií])?|qued(?:a|ar[ií]a) as[ií]|te paso (?:la lista|el detalle|el resumen|c[oó]mo queda)|(?:el )?(?:detalle|resumen)(?: del pedido)?|la lista(?: queda)?)\s*:\s*/i;
  const resto = lineas
    .filter((l) => !esRenglonDeLista(l))
    .flatMap(oraciones)
    .map((o) => o.replace(RE_PRESENTA_LISTA, ''))
    .filter((o) => o.trim() && !reemplazada(o))
    .map((o) => o[0].toUpperCase() + o.slice(1))
    .join(' ')
    .trim();
  return [lista.join('\n'), total, resto].filter(Boolean).join('\n\n');
}

/** Candado 2: las oraciones que el bot ya dijo en sus últimos mensajes no se repiten. */
export function sinOracionesRepetidas(respuesta: string, dichoAntes: string[]): string {
  const r = String(respuesta ?? '');
  const ya = new Set(
    (dichoAntes ?? []).flatMap((m) => String(m ?? '').split('\n'))
      .filter((l) => !esRenglonDeLista(l) && !esLineaDeTotal(l))
      .flatMap(oraciones)
      .map(normal)
      .filter((o) => o.length >= 12),
  );
  if (!ya.size) return r;
  const salida = r.split('\n').map((l) => {
    if (esRenglonDeLista(l) || esLineaDeTotal(l) || !l.trim()) return l;
    // una pregunta nunca se saca: si sigue pendiente, el cliente tiene que verla
    return oraciones(l).filter((o) => /\?\s*$/.test(o) || !ya.has(normal(o))).join(' ');
  });
  const limpia = salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // si todo ya estaba dicho, no se manda un mensaje vacío: va lo que había
  return limpia || r;
}

