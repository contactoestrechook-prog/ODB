// ============================================================
// LA CUENTA DE LA FACTURA, TAMBIÉN EN EL SERVIDOR (11/11/2026).
//
// La cuenta única (9/11/2026, cuenta-factura.ts) corría solo en la pantalla de
// quien carga: el servidor registraba lo que la pantalla le mandaba. Una
// pestaña vieja o un error del panel podían registrar una factura que no
// cierra, y nadie se enteraba.
//
// Ahora la pantalla manda las partes con las que hizo la cuenta y el servidor
// la rehace con EL MISMO código (cuenta-factura.ts es copia exacta de la del
// panel; un test falla si dejan de ser iguales) contra el total que va a
// guardar. Si no cierra y nadie aceptó la diferencia con un motivo, no se
// registra nada: ni stock ni factura.
//
// El cruce de unidades (lo que la cuenta dice que entra contra lo que de
// verdad se manda al stock) por ahora solo se anota: cuando se vea que no da
// falsos avisos, pasa a frenar.
//
// Funciones puras.
// ============================================================
import { cuentaDeLaFactura, toleranciaDe, type Cuenta, type EntradaCuenta, type ParteRenglon, type TipoParte } from './cuenta-factura';

const TIPOS: TipoParte[] = ['entra', 'no_entra', 'volvio', 'falto', 'solo_precio', 'devuelto'];
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pesos = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/** Lo que mandó la pantalla, limpio: nada que no sea un número o un tipo conocido llega a la cuenta. */
export function limpiarCuenta(enviada: unknown): EntradaCuenta | null {
  const e = enviada as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || !Array.isArray(e.partes)) return null;
  const partes: ParteRenglon[] = [];
  for (const p of (e.partes as Record<string, unknown>[]).slice(0, 1000)) {
    const valor = num(p?.valor);
    const tipo = String(p?.tipo ?? '') as TipoParte;
    if (valor == null || !TIPOS.includes(tipo)) return null;
    const unidades = num(p?.unidades);
    partes.push({
      renglon: Math.round(num(p?.renglon) ?? 0),
      descripcion: String(p?.descripcion ?? '').slice(0, 200),
      tipo,
      valor,
      ...(unidades != null ? { unidades } : {}),
    });
  }
  const aceptada = e.aceptada as Record<string, unknown> | null | undefined;
  const monto = num(aceptada?.monto);
  const motivo = String(aceptada?.motivo ?? '').trim().slice(0, 300);
  return {
    total: num(e.total),
    partes,
    percepcionesFueraDelCosto: num(e.percepcionesFueraDelCosto) ?? 0,
    otrosDelPie: num(e.otrosDelPie) ?? 0,
    excesoPercepciones: num(e.excesoPercepciones) ?? 0,
    descuentosNoAplicados: num(e.descuentosNoAplicados) ?? 0,
    aceptada: monto != null && motivo ? { monto, motivo } : null,
  };
}

export type ControlCuenta = {
  cuenta: Cuenta;
  /** el motivo por el que no se registra; null si pasa */
  frena: string | null;
  /** lo que la cuenta dice que entra contra lo que se manda al stock, en unidades */
  cruce: { unidadesCuenta: number; unidadesAlStock: number; coincide: boolean };
};

/**
 * Rehace la cuenta contra el total que el servidor va a guardar. Devuelve null
 * si la pantalla no mandó la cuenta (una versión anterior del panel): ahí no
 * se frena nada, como hasta hoy.
 */
export function controlarCuenta(enviada: unknown, totalFactura: number, items: { cantidad: number; valorizaOc?: unknown }[]): ControlCuenta | null {
  const e = limpiarCuenta(enviada);
  if (!e) return null;
  const total = Number(totalFactura);
  const cuenta = cuentaDeLaFactura({ ...e, total });
  const redondear = (x: number) => Math.round(x * 1000) / 1000;
  const unidadesCuenta = redondear(e.partes.filter((p) => p.tipo === 'entra').reduce((s, p) => s + (p.unidades ?? 0), 0));
  const unidadesAlStock = redondear(items.filter((i) => !i.valorizaOc).reduce((s, i) => s + (Number(i.cantidad) || 0), 0));
  const cruce = { unidadesCuenta, unidadesAlStock, coincide: Math.abs(unidadesCuenta - unidadesAlStock) <= Math.max(0.01, unidadesAlStock * 0.005) };
  // la cuenta se hizo contra otro total: lo que se controló no es lo que se va a guardar
  if (e.total != null && total > 0 && Math.abs(e.total - total) > toleranciaDe(total)) {
    return { cuenta, cruce, frena: `La cuenta de la factura se hizo con un total de $${pesos(e.total)} y se está registrando $${pesos(total)}. Volvé a abrir la factura y registrala de nuevo: no se guardó nada.` };
  }
  if (cuenta.estado === 'no_cierra') {
    return { cuenta, cruce, frena: `La cuenta de la factura no cierra. ${cuenta.mensaje} No se registró nada: corregilo o aceptá la diferencia con un motivo.` };
  }
  return { cuenta, cruce, frena: null };
}
