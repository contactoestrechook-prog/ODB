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

// ---------- POR LA DIRECCIÓN (26/11/2026) ----------
// Leandro: «me gustaría que todos los clientes que tengan cuenta corriente sean reconocidos
// también por su dirección, como en este caso». En ODB la dirección de cada cuenta está en el
// NOMBRE («St Thomas 470 (Salvador)», «Horqueta 161», «St Thomas Oeste 655»): el campo
// domicilio dice «Canning, Buenos Aires». Las fichas de quienes escriben también la llevan en
// el nombre («Cristina St Thomas 470»), y el cliente la dice al pedir el envío.
// Cuidado: decir una dirección no prueba ser de esa casa. Reconocido SOLO por la dirección, la
// cuenta corriente vale con envío a esa misma casa (lo controla crearPedido); retirar o mandarlo
// a otro lado se consulta.

const sinTildesMin = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type Direccion = { calle: string[]; numero: string };

/**
 * «St Thomas 470 (Salvador)» → calle [st, thomas], número 470. Toma el ÚLTIMO número de 1 a 5
 * cifras con una palabra antes (un teléfono o un DNI no cuentan) y hasta dos palabras antes de él.
 * Lo que va entre paréntesis («(Salvador)», «(464)») no es dirección.
 */
export function direccionDe(texto: string | null | undefined): Direccion | null {
  const s = sinTildesMin(String(texto ?? ''))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\b(nro|n|numero|num|lote|lt|casa|uf|depto|dpto|piso)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const t = s.split(' ').filter(Boolean);
  for (let i = t.length - 1; i >= 1; i--) {
    if (!/^\d{1,5}$/.test(t[i]) || !/^[a-zñ]{2,}$/.test(t[i - 1])) continue;
    const calle: string[] = [];
    for (let j = i - 1; j >= 0 && calle.length < 2 && /^[a-zñ]+$/.test(t[j]); j--) calle.unshift(t[j]);
    return { calle, numero: String(Number(t[i])) };
  }
  return null;
}

/**
 * ¿Es la misma casa? El mismo número y la calle de una termina como la de la otra: «Horqueta 161»
 * es «Juan Horqueta 161»; «St Thomas 470» NO es «St Thomas Oeste 470» ni «St Thomas 471».
 */
export function mismaDireccion(a: Direccion | null, b: Direccion | null): boolean {
  if (!a || !b || a.numero !== b.numero || !a.calle.length || !b.calle.length) return false;
  const [corta, larga] = a.calle.length <= b.calle.length ? [a.calle, b.calle] : [b.calle, a.calle];
  return corta.every((w, k) => larga[larga.length - corta.length + k] === w);
}

export type CuentaConDireccion = { id: string; nombre: string | null; razon_social?: string | null; domicilio?: string | null; saldo_cta_cte?: number | string | null };
export type CuentaPorDireccion = { titularId: string; titular: string; saldo: number; direccion: string };

/**
 * La cuenta corriente de la casa que nombran estos textos (la dirección dicha, el nombre de la
 * ficha, el de WhatsApp). Solo si es UNA: dos cuentas en la misma dirección no se adivinan.
 */
export function cuentaPorDireccion(textos: (string | null | undefined)[], cuentas: CuentaConDireccion[]): CuentaPorDireccion | null {
  const dichas = textos.map((t) => ({ t: String(t ?? ''), d: direccionDe(t) })).filter((x) => x.d);
  if (!dichas.length) return null;
  const halladas = new Map<string, CuentaPorDireccion>();
  for (const c of cuentas) {
    const dc = direccionDe(c.razon_social || c.nombre) ?? direccionDe(c.domicilio);
    const dicha = dichas.find((x) => mismaDireccion(x.d, dc));
    if (!dc || !dicha) continue;
    halladas.set(c.id, {
      titularId: c.id, titular: String(c.razon_social || c.nombre || '').trim(), saldo: Number(c.saldo_cta_cte ?? 0),
      direccion: `${[...dc.calle].map((w) => (w === 'st' ? 'St' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')} ${dc.numero}`,
    });
  }
  return halladas.size === 1 ? [...halladas.values()][0] : null;
}

/** Lo que el bot tiene que saber cuando la cuenta se reconoce solo por la dirección. */
export const TEXTO_PAGA_CTA_CTE_POR_DIRECCION = (c: Pick<CuentaPorDireccion, 'titular' | 'direccion'>) =>
  `Se lo reconoce por la dirección ${c.direccion}: puede pagar con la cuenta corriente de ${c.titular} SOLO si el pedido es con envío a ${c.direccion}. Si lo pide así, en notas poné "Paga con cuenta corriente" y no le mandes alias ni le pidas transferencia. Si quiere retirar o mandarlo a otra dirección, la cuenta corriente no va: consultá a la caja.`;

/** El cierre del pedido confirmado que va a cuenta corriente. */
export function cierreCuentaCorriente(c: Pick<CuentaDelQueEscribe, 'titular' | 'propia'>, envio: string): string {
  return `${envio}Va a ${c.propia || !c.titular ? 'tu cuenta corriente' : `la cuenta corriente de ${c.titular}`}: no tenés que pagar ahora.`;
}
