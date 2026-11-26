// QUIÉN ESCRIBE Y SU CUENTA CORRIENTE (26/11/2026). Leandro: «necesito que el sistema reconozca
// las personas que tengan cuenta corriente así el bot puede gestionar el pedido». Ver
// BotService.identificarCliente. Funciones puras, con pruebas en identificar-cliente.spec.ts.

export type FichaCliente = {
  id: string; nombre: string | null; cta_cte_habilitada?: boolean | null; saldo_cta_cte?: number | string | null;
  cuenta_corriente_de?: string | null; [k: string]: unknown;
};
export type FichaTitular = { id: string; nombre: string | null; razon_social?: string | null; cta_cte_habilitada?: boolean | null; saldo_cta_cte?: number | string | null };
export type CuentaDelQueEscribe = { titularId: string; titular: string; propia: boolean; saldo: number };

/**
 * Si un teléfono está en varias fichas (pasa: la de la persona y la de la casa), la que tiene
 * cuenta corriente, después la que está unida a una, y si no la primera.
 */
export function fichaDelQueEscribe<T extends FichaCliente>(fichas: T[]): T | null {
  if (!fichas.length) return null;
  return fichas.find((f) => f.cta_cte_habilitada === true) ?? fichas.find((f) => !!f.cuenta_corriente_de) ?? fichas[0];
}

/** La cuenta corriente con la que puede comprar: la suya, o la de la ficha a la que está unida (si está abierta). */
export function cuentaCorrienteDe(ficha: FichaCliente, titular: FichaTitular | null): CuentaDelQueEscribe | null {
  if (ficha.cta_cte_habilitada === true) {
    return { titularId: ficha.id, titular: String(ficha.nombre ?? '').trim(), propia: true, saldo: Number(ficha.saldo_cta_cte ?? 0) };
  }
  if (ficha.cuenta_corriente_de && titular && titular.id === ficha.cuenta_corriente_de && titular.cta_cte_habilitada === true) {
    return { titularId: titular.id, titular: String(titular.razon_social || titular.nombre || '').trim(), propia: false, saldo: Number(titular.saldo_cta_cte ?? 0) };
  }
  return null;
}

/** Lo que el bot tiene que saber para anotar el pedido a cuenta corriente (lo lee el modelo). */
export const TEXTO_PAGA_CTA_CTE = (c: Pick<CuentaDelQueEscribe, 'titular' | 'propia'>) =>
  `Puede pagar con ${c.propia ? 'su cuenta corriente' : `la cuenta corriente de ${c.titular}`}. Si lo pide o dice "cta cte", aceptalo sin consultar: en notas poné "Paga con cuenta corriente" y no le mandes alias ni le pidas transferencia.`;

/** El cierre del pedido confirmado que va a cuenta corriente. */
export function cierreCuentaCorriente(c: Pick<CuentaDelQueEscribe, 'titular' | 'propia'>, envio: string): string {
  return `${envio}Va a ${c.propia || !c.titular ? 'tu cuenta corriente' : `la cuenta corriente de ${c.titular}`}: no tenés que pagar ahora.`;
}
