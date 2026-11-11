// Lee, en el navegador, los dos archivos que exporta el sistema del local (el
// Crack): stock.csv y ventas.csv. El de ventas pesa ~37 MB porque trae un año de
// tickets: acá se achica a «unidades por día y producto» de los días que
// faltan, y eso es lo único que viaja al servidor.
//
// Reglas de lectura, las mismas de la carga del 10/11/2026 (scripts/sistema-viejo):
//  - vienen en Windows-1252, separados por punto y coma;
//  - las columnas se buscan por su encabezado, no por su lugar: cambian;
//  - los números vienen con coma decimal y punto de miles («35,855», «1.250,5»).

export type StockLeido = {
  sucursal: string;
  /** fecha y hora del corte, con zona de Argentina: 2026-11-10T11:20:16-03:00 */
  corte: string | null;
  filas: { codigo: string; cantidad: number }[];
  lineas: number;
  otrasSucursales: string[];
};

export type VentasLeidas = {
  sucursal: string;
  ventas: { fecha: string; codigo: string; unidades: number }[];
  /** renglones de ticket leídos (todos, no solo los que se mandan) */
  lineas: number;
  /** el último día que trae el archivo */
  hasta: string | null;
  otrasSucursales: string[];
};

const llave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function numeroDelLocal(s: string | undefined): number {
  const t = String(s ?? '').trim();
  if (!t || t === '-') return 0;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** «10/11/2026» → «2026-11-10». null si no es una fecha. */
export function fechaDelLocal(s: string | undefined): string | null {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** «10/11/2026 11:20:16» → «2026-11-10T11:20:16-03:00». */
export function corteDelLocal(s: string | undefined): string | null {
  const dia = fechaDelLocal(s);
  const h = String(s ?? '').trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  if (!dia) return null;
  return `${dia}T${(h?.[1] ?? '00').padStart(2, '0')}:${h?.[2] ?? '00'}:${h?.[3] ?? '00'}-03:00`;
}

export function textoDelArchivo(datos: ArrayBuffer | Uint8Array): string {
  return new TextDecoder('windows-1252').decode(datos).replace(/^﻿/, '');
}

function columnas(encabezado: string, buscadas: Record<string, string[]>): Record<string, number> | null {
  const nombres = encabezado.split(';').map(llave);
  const salida: Record<string, number> = {};
  for (const [clave, opciones] of Object.entries(buscadas)) {
    const i = nombres.findIndex((n) => opciones.some((o) => n === o || n.startsWith(o)));
    if (i < 0) return null;
    salida[clave] = i;
  }
  return salida;
}

const laMasComun = (cuenta: Map<string, number>) => [...cuenta].sort((a, b) => b[1] - a[1]).map(([s]) => s);

/** stock.csv: Código interno; sucursal; cantidad a la fecha; fecha y hora del corte; … */
export function leerStock(texto: string): StockLeido | { error: string } {
  const lineas = texto.split(/\r?\n/);
  const col = columnas(lineas[0] ?? '', { codigo: ['codigo interno', 'codigo'], sucursal: ['sucursal'], cantidad: ['cantidad a la fecha', 'cantidad'], corte: ['fecha y hora del corte', 'fecha'] });
  if (!col) return { error: 'No es el archivo de stock: tiene que traer las columnas «Código interno», «sucursal», «cantidad a la fecha» y «fecha y hora del corte».' };
  const porSucursal = new Map<string, number>();
  const filas: { sucursal: string; codigo: string; cantidad: number }[] = [];
  let corte: string | null = null;
  for (let i = 1; i < lineas.length; i++) {
    if (!lineas[i]) continue;
    const c = lineas[i].split(';');
    const codigo = (c[col.codigo] ?? '').trim();
    if (!codigo) continue;
    const sucursal = (c[col.sucursal] ?? '').trim();
    porSucursal.set(sucursal, (porSucursal.get(sucursal) ?? 0) + 1);
    filas.push({ sucursal, codigo, cantidad: numeroDelLocal(c[col.cantidad]) });
    corte ??= corteDelLocal(c[col.corte]);
  }
  const [sucursal = '', ...otras] = laMasComun(porSucursal);
  return { sucursal, corte, filas: filas.filter((f) => f.sucursal === sucursal).map(({ codigo, cantidad }) => ({ codigo, cantidad })), lineas: filas.length, otrasSucursales: otras };
}

/**
 * ventas.csv: Fecha; sucursal; número de ticket o factura; código del producto; CANTIDAD; …
 * Devuelve las unidades por día y producto de los días POSTERIORES a `despuesDe`
 * (lo ya cargado). Sin `despuesDe`, los últimos 60 días.
 */
export function leerVentas(texto: string, despuesDe: string | null): VentasLeidas | { error: string } {
  const lineas = texto.split(/\r?\n/);
  const col = columnas(lineas[0] ?? '', { fecha: ['fecha'], sucursal: ['sucursal'], codigo: ['codigo del producto', 'codigo'], cantidad: ['cantidad'] });
  if (!col) return { error: 'No es el archivo de ventas: tiene que traer las columnas «Fecha», «sucursal», «código del producto» y «CANTIDAD».' };
  const porSucursal = new Map<string, number>();
  const suma = new Map<string, number>();
  const sucursalDe = new Map<string, string>();
  let hasta: string | null = null;
  let leidas = 0;
  const cacheFecha = new Map<string, string | null>();
  for (let i = 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l) continue;
    const c = l.split(';');
    let fecha = cacheFecha.get(c[col.fecha]);
    if (fecha === undefined) { fecha = fechaDelLocal(c[col.fecha]); cacheFecha.set(c[col.fecha], fecha); }
    if (!fecha) continue;
    leidas++;
    const sucursal = (c[col.sucursal] ?? '').trim();
    porSucursal.set(sucursal, (porSucursal.get(sucursal) ?? 0) + 1);
    if (!hasta || fecha > hasta) hasta = fecha;
    if (despuesDe && fecha <= despuesDe) continue;
    const codigo = (c[col.codigo] ?? '').trim();
    if (!codigo) continue;
    const clave = `${fecha}|${codigo}`;
    suma.set(clave, (suma.get(clave) ?? 0) + numeroDelLocal(c[col.cantidad]));
    sucursalDe.set(clave, sucursal);
  }
  const [sucursal = '', ...otras] = laMasComun(porSucursal);
  // sin fecha de lo ya cargado: los últimos 60 días, para no mandar el año entero
  const piso = despuesDe ?? (hasta ? new Date(Date.parse(`${hasta}T00:00:00Z`) - 60 * 86400_000).toISOString().slice(0, 10) : '');
  const ventas = [...suma]
    .filter(([clave]) => sucursalDe.get(clave) === sucursal && clave.slice(0, 10) > piso)
    .map(([clave, unidades]) => ({ fecha: clave.slice(0, 10), codigo: clave.slice(11), unidades: Math.round(unidades * 1000) / 1000 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo));
  return { sucursal, ventas, lineas: leidas, hasta, otrasSucursales: otras };
}

/** «Sant Thomas» del archivo ↔ «Suc Sant Thomas» / «Saint Thomas» de NÚCLEO. */
export function mismoLocal(a: string, b: string): boolean {
  const n = (s: string) => llave(s).replace(/^suc /, '').replace(/^saint /, 'sant ');
  return !!n(a) && n(a) === n(b);
}
