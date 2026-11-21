// DE QUÉ LADO HABLA CADA UNO en la charla de un pedido (21/11/2026) — lógica
// pura, sin base ni red.
//
// Juan Pablo, 20/11/2026: «si le tienen que hacer una consulta a la persona que
// se los asignó… tiene que estar previsto desde la app». El pedido tiene dos
// lados: quien lo ARMA (a quien está asignado) y la CAJA (quien se lo asignó y
// cualquiera que maneje los pedidos de todos: caja, encargados, dueños,
// administración). El que solo arma y no tiene ese pedido no entra a su charla.

import { rolesDe } from '../auth/roles';

export type Lado = 'armado' | 'caja';

/** Los que manejan los pedidos de todos (los mismos que no son «solo arma»). */
const MANEJAN_PEDIDOS = ['dueno', 'gerente', 'administrativo', 'cajero'];

/** Lo mínimo que tiene que decir el motivo de una devolución. */
export const MOTIVO_MINIMO = 3;

export function ladoDe(
  pedido: { asignado_a?: string | null },
  quien: { sub?: string; rol?: string | null; roles?: unknown } | null | undefined,
): Lado | null {
  if (!quien?.sub) return null;
  // el que lo arma habla como armador aunque también sea de la caja
  if (pedido.asignado_a && pedido.asignado_a === quien.sub) return 'armado';
  return rolesDe(quien).some((r) => MANEJAN_PEDIDOS.includes(r)) ? 'caja' : null;
}

/** El texto de un mensaje o de un motivo: sin saltos ni espacios de más, con tope. */
export function limpiarMensaje(texto: unknown): string {
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
}
