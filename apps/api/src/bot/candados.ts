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

type RenglonCotizado = { nombre?: string; renglon?: string; subtotal?: number; subtotalEfectivo?: number; error?: string };
export type Cotizacion = { renglones?: RenglonCotizado[]; total?: number; totalEfectivo?: number } | null | undefined;

const normal = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esRenglonDeLista = (l: string) => /^\s*[•·*-]\s/.test(l);
const esLineaDeTotal = (l: string) => /^\s*\*?\s*total\b/i.test(l);
const oraciones = (t: string) => t.split(/(?<=[.!?])\s+/).map((o) => o.trim()).filter(Boolean);

/** Candado 1: un total siempre viaja con su lista completa, armada desde la cotización del turno. */
export function totalConSuLista(respuesta: string, cot: Cotizacion): string {
  const r = String(respuesta ?? '');
  const renglones = (cot?.renglones ?? []).filter((x) => !x.error && x.renglon && x.nombre);
  if (!cot || !renglones.length || !(Number(cot.total) > 0)) return r;
  // ¿la respuesta da un total o un monto? sin plata en el texto, no hay nada que proteger
  if (!/\btotal\b|\$\s?\d/i.test(r)) return r;
  // ¿ya trae todos los renglones como lista? entonces está bien
  const lineas = r.split('\n');
  const listados = lineas.filter(esRenglonDeLista).map(normal);
  const estanTodos = renglones.every((x) => listados.some((l) => l.includes(normal(String(x.nombre)).slice(0, 18))));
  if (estanTodos && lineas.some(esLineaDeTotal)) return r;

  const lista = renglones.map((x) => `• ${x.nombre} — ${x.renglon}${x.subtotalEfectivo != null && x.subtotal != null && x.subtotalEfectivo < x.subtotal ? ` ($${pesos(x.subtotalEfectivo)} en efectivo o transferencia)` : ''}`);
  const total = `Total: $${pesos(Number(cot.total))}${cot.totalEfectivo != null && cot.totalEfectivo < Number(cot.total) ? `, o $${pesos(cot.totalEfectivo)} en efectivo o transferencia` : ''}`;
  // de lo que escribió el modelo queda lo que no es lista ni plata (la pregunta, el retiro)
  // (del renglón del total se va solo lo que tiene montos: la pregunta que lo sigue queda)
  const resto = lineas
    .filter((l) => !esRenglonDeLista(l))
    .flatMap(oraciones)
    .filter((o) => !/\$\s?\d/.test(o) && !/\d\s*[×x]\s/.test(o))
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
    return oraciones(l).filter((o) => !ya.has(normal(o))).join(' ');
  });
  const limpia = salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // si todo ya estaba dicho, no se manda un mensaje vacío: va lo que había
  return limpia || r;
}
