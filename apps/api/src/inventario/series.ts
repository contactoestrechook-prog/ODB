// ============================================================
// INVENTARIO DE UN PRODUCTO (5/11/2026) — las cuentas de la pantalla
// «Inventario» (Leandro: «un botón de inventario de producto con buscador, muy
// buenas gráficas»). Todo sale de lo que ya está en la base:
//
//  - Cuánto hubo: `movimientos_stock` guarda cada cambio con su signo y la suma
//    de un producto en una sucursal da el stock de hoy (comprobado en las 8.547
//    filas de `stock`). El nivel de cada día se arma hacia atrás desde hoy.
//    La «apertura» (11/8/2026) NO es un cambio de stock: es el asiento que se
//    cargó para que la suma diera el stock que ya había. Coca lata en Saint
//    Thomas: sincronización −93 a las 11:23 y apertura +93 a las 12:41; el
//    stock pasó de 93 a 0 una sola vez. Si la apertura contara, daría −93.
//  - Cuánto se vende: `ventas_historicas` trae las unidades por período del
//    sistema viejo, y los períodos no duran lo mismo (de 3 a 31 días). Se
//    comparan por día; el período sin renglón es un período sin ventas.
//  - A cuánto se compra y a cuánto se vende: `costos_historial` y `precios`
//    son escalones (un valor vale hasta que se carga el siguiente).
//
// Funciones puras; las pruebas están en series.spec.ts.
// ============================================================

export type MovimientoCrudo = {
  id: number;
  sucursal_id: string;
  tipo: string;
  cantidad: number | string;
  motivo?: string | null;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
  creado_en: string;
  usuario?: { nombre?: string | null } | null;
};

export type Paso = {
  id: number;
  en: string;
  sucursalId: string;
  /** qué fue, en palabras */
  que: string;
  /** cuánto cambió el stock (0 en la apertura) */
  cambio: number;
  /** cuánto quedó después */
  saldo: number;
  motivo: string | null;
  quien: string | null;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** las cantidades van con tres decimales (se vende por peso) */
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** «Suc Sant Thomas» → «Saint Thomas», como la nombran Mesa de compras y el Analista. */
export function nombreSucursal(nombre: unknown): string {
  const corto = String(nombre ?? '').replace(/^suc(ursal)?\.?\s+/i, '').trim();
  if (/^sant thomas$/i.test(corto)) return 'Saint Thomas';
  if (/^santa ines$/i.test(corto)) return 'Santa Inés';
  return corto;
}

const esApertura = (m: MovimientoCrudo) => m.referencia_tipo === 'apertura';

/** Qué fue cada movimiento, en las palabras del local. */
export function queFue(m: Pick<MovimientoCrudo, 'tipo' | 'referencia_tipo' | 'motivo'>): string {
  const ref = m.referencia_tipo ?? '';
  switch (m.tipo) {
    case 'compra':
      return 'Compra';
    case 'venta':
      return 'Venta';
    case 'devolucion':
      return 'Devolución de una venta';
    case 'merma':
      return 'Merma';
    case 'reserva':
      return 'Reservado para un pedido';
    case 'liberacion_reserva':
      return 'Se liberó la reserva de un pedido';
    case 'transferencia_salida':
      return 'Salió a la otra sucursal';
    case 'transferencia_entrada':
      return 'Llegó de la otra sucursal';
    case 'ajuste':
      if (ref === 'apertura') return 'Apertura del inventario';
      if (ref === 'importacion') return /^alta/i.test(m.motivo ?? '') ? 'Alta desde el sistema viejo' : 'Sincronización con el sistema viejo';
      if (ref === 'baja_catalogo') return 'Baja de catálogo';
      if (ref === 'venta_prueba') return 'Faltante detectado en la caja';
      if (ref === 'arqueo' || ref === 'conteo') return 'Conteo de stock';
      if (ref === 'fraccionamiento' || ref === 'carga_pozo') return 'Fraccionado';
      return 'Ajuste';
    default: {
      const t = String(m.tipo ?? '').replace(/_/g, ' ').trim();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Movimiento';
    }
  }
}

/**
 * El stock de UNA sucursal después de cada movimiento, armado hacia atrás desde
 * el stock de hoy. `inicial` es lo que había antes del primer movimiento.
 */
export function nivelEnElTiempo(movimientos: MovimientoCrudo[], stockHoy: number): { inicial: number; pasos: Paso[] } {
  const orden = [...movimientos].sort((a, b) => a.id - b.id);
  const pasos: Paso[] = new Array(orden.length);
  let saldo = r3(n(stockHoy));
  for (let i = orden.length - 1; i >= 0; i--) {
    const m = orden[i];
    const cambio = esApertura(m) ? 0 : r3(n(m.cantidad));
    pasos[i] = {
      id: m.id,
      en: m.creado_en,
      sucursalId: m.sucursal_id,
      que: queFue(m),
      cambio,
      saldo,
      motivo: m.motivo?.trim() || null,
      quien: m.usuario?.nombre?.trim() || null,
    };
    saldo = r3(saldo - cambio);
  }
  return { inicial: saldo, pasos };
}

export type Periodo = { desde: string; hasta: string };
export type VentaDelPeriodo = Periodo & { dias: number; unidades: number; porDia: number };

const DIA = 86_400_000;
const aDia = (s: string) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
/** cuántos días tiene un período, contando los dos extremos */
export const diasDelPeriodo = (p: Periodo) => Math.max(1, Math.round((aDia(p.hasta) - aDia(p.desde)) / DIA) + 1);

/**
 * Las unidades vendidas en cada período de UNA sucursal, con su ritmo por día.
 * `periodos` son todos los que tiene cargados la sucursal: el que no tiene
 * renglón del producto queda en cero (no se vendió), no se saltea.
 */
export function ventasPorPeriodo(periodos: Periodo[], filas: (Periodo & { unidades: number | string })[]): VentaDelPeriodo[] {
  const clave = (p: Periodo) => `${String(p.desde).slice(0, 10)}|${String(p.hasta).slice(0, 10)}`;
  const vendidas = new Map<string, number>();
  for (const f of filas ?? []) vendidas.set(clave(f), (vendidas.get(clave(f)) ?? 0) + n(f.unidades));
  // un renglón de un período que no está en la lista (no debería pasar) no se pierde
  const todos = new Map<string, Periodo>();
  for (const p of [...(periodos ?? []), ...(filas ?? [])]) todos.set(clave(p), { desde: String(p.desde).slice(0, 10), hasta: String(p.hasta).slice(0, 10) });
  return [...todos.values()]
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.hasta.localeCompare(b.hasta))
    .map((p) => {
      const dias = diasDelPeriodo(p);
      const unidades = r3(vendidas.get(clave(p)) ?? 0);
      return { ...p, dias, unidades, porDia: r2(unidades / dias) };
    });
}

export type Escalon<T = unknown> = { en: string; valor: number } & T;

/**
 * Una serie de plata (costo o precio) como escalones: en orden, sin ceros y sin
 * repetir el mismo valor dos veces seguidas (una carga que no cambió nada no es
 * un escalón).
 */
export function escalones<T extends { en: string; valor: number | string }>(puntos: T[]): (T & { valor: number })[] {
  const salida: (T & { valor: number })[] = [];
  const orden = [...(puntos ?? [])].sort((a, b) => Date.parse(a.en) - Date.parse(b.en));
  for (const p of orden) {
    const valor = r2(n(p.valor));
    if (!(valor > 0) || !Number.isFinite(Date.parse(p.en))) continue;
    if (salida.length && salida[salida.length - 1].valor === valor) continue;
    salida.push({ ...p, valor });
  }
  return salida;
}

/** Cuánto se le gana, sobre el costo (la misma cuenta que la ficha del producto). */
export function margenSobreCosto(precio: unknown, costo: unknown): number | null {
  const p = n(precio), c = n(costo);
  if (!(p > 0) || !(c > 0)) return null;
  return Math.round(((p - c) / c) * 100);
}

/** El origen de un costo, en palabras. */
export function origenDelCosto(origen: unknown): string {
  const o = String(origen ?? '').trim();
  if (!o) return 'cargado a mano';
  if (/^export|^access|^stock/i.test(o)) return 'sistema viejo';
  // 'lista_pdf' lo graba aplicar_lista_con_precio: la carga de una factura o de una lista con precio
  if (o === 'lista_pdf') return 'comprobante cargado';
  if (o === 'lista_archivo') return 'lista del proveedor';
  if (/factura|comprobante|compra|remito/i.test(o)) return 'comprobante cargado';
  if (/manual/i.test(o)) return 'cargado a mano';
  return o.replace(/_/g, ' ');
}
