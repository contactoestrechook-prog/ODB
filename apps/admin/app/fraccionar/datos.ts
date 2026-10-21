import { numero } from '../lib/formato';

// Lo que devuelve /api/fraccionar y las cuentas chicas de la pantalla.

export type Sucursal = {
  id: string;
  nombre: string;
  /** la sucursal todavía toma el stock de la planilla del sistema viejo (última carga) */
  sistemaViejo?: { referencia: string; fecha: string } | null;
};

export type Pozo = {
  id: string;
  sku: string;
  nombre: string;
  /** true: el pozo se cuenta en kilos (horma de queso); false: por unidad (huevos) */
  porPeso: boolean;
  costo: number | null;
  activo: boolean;
  /** tiene código del sistema viejo: donde se carga la planilla, ella le pisa el stock */
  sistemaViejo?: boolean;
  stock: Record<string, number>;
};

export type Presentacion = {
  id: string;
  sku: string;
  nombre: string;
  /** cuánto del pozo lleva cada una (unidades o kilos) */
  unidades: number;
  precio: number | null;
  sistemaViejo?: boolean;
  stock: Record<string, number>;
  /** cuántas se pueden armar con lo que hay en el pozo, por sucursal (lo calcula la API) */
  alcanza: Record<string, number>;
};

export type Grupo = { pozo: Pozo; presentaciones: Presentacion[] };

export type EntradaHistorial = {
  id: string;
  tipo: 'armado' | 'apertura' | 'carga';
  cuando: string;
  quien: string | null;
  pozo: { sku: string; nombre: string; porPeso: boolean };
  presentacion: { sku: string; nombre: string } | null;
  paquetes: number | null;
  unidades: number;
  motivo: string | null;
};

/** "360 unidades", "1 unidad", "12,5 kg" (corto: "360 u."). */
export function cantidadDelPozo(n: number, porPeso: boolean, corto = false): string {
  if (porPeso) return `${numero(n, 3)} kg`;
  // un pozo "por unidad" con decimales (un queso mal cargado) se muestra como
  // es: redondear 71,525 a 72 escondía el problema
  const cifra = numero(n, Number.isInteger(n) ? 0 : 3);
  if (corto) return `${cifra} u.`;
  return `${cifra} ${n === 1 ? 'unidad' : 'unidades'}`;
}

/** Lo que lleva una presentación: "12 u." o "0,25 kg". */
export function lleva(p: Presentacion, porPeso: boolean): string {
  return cantidadDelPozo(p.unidades, porPeso, true);
}

/** Número escrito con coma o punto decimal ("0,25"); null si no es un número. */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lo que entra o lleva un pozo. Por kilo: "0,25" o "0.25". Por unidad, el
 * punto con grupos de 3 es de miles ("1.000" = mil) y cualquier otra coma o
 * punto es un decimal, que se devuelve tal cual para que el campo diga "va
 * sin decimales" (antes se borraba la coma: "0,25" quedaba en 25 sin aviso).
 */
export function leerCantidadPozo(texto: string, porPeso: boolean): number | null {
  const t = texto.trim();
  if (!porPeso && /^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return leerNumero(t);
}

/** Solo dígitos, coma y punto (los campos de cantidad no aceptan otra cosa). */
export const soloCifras = (texto: string) => texto.replace(/[^\d.,]/g, '');

/**
 * Un pozo cargado "por unidad" que en realidad se cuenta en kilos: su stock
 * tiene decimales o el nombre dice "x fracción", "al peso"… (los quesos del
 * sistema viejo vienen así: 71,525 de Fontina "por unidad").
 */
export function pareceKilos(nombre: string, stocks: (number | null | undefined)[]): boolean {
  if (stocks.some((n) => n != null && Number.isFinite(Number(n)) && !Number.isInteger(Number(n)))) return true;
  return /\bx\s*fracc|fraccionad|al peso|\bpor kilo|\bx\s*kg\b/i.test(nombre);
}

/** Lo que la planilla del sistema viejo pisa en esa sucursal: ahí no se mueve. */
export function pisaElSistemaViejo(sucursal: Sucursal, pozo: Pozo, p?: Presentacion): boolean {
  return !!sucursal.sistemaViejo && (!!pozo.sistemaViejo || !!p?.sistemaViejo);
}

/** "el 1/10" */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}/${d.getMonth() + 1}`;
}

/** Precio como se escribe acá: "2.500" son dos mil quinientos. null si no es un precio. */
export function leerPrecio(texto: string): number | null {
  let t = texto.replace(/[$\s]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** El stock de todas las sucursales junto (solo lo positivo). */
export function sumaStock(stock: Record<string, number>): number {
  return Object.values(stock ?? {}).reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0);
}

/** POST a /api/fraccionar. Devuelve los datos o el mensaje de error de la API. */
export async function enviar(cuerpo: Record<string, unknown>): Promise<{ ok: true; datos: any } | { ok: false; mensaje: string }> {
  try {
    const res = await fetch('/api/fraccionar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = datos?.message;
      return { ok: false, mensaje: Array.isArray(m) ? m.join('. ') : (m ?? 'No se pudo guardar') };
    }
    return { ok: true, datos };
  } catch {
    return { ok: false, mensaje: 'No hay conexión con el sistema. Probá de nuevo en un rato.' };
  }
}

/** El PIN de supervisor, por el mismo camino que la caja y los ajustes de stock. */
export async function pedirAutorizacion(pin: string): Promise<{ ok: true; token: string } | { ok: false; mensaje: string }> {
  try {
    const res = await fetch('/api/caja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'autorizar', pin }),
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok || !datos?.token) return { ok: false, mensaje: datos?.message ?? 'PIN incorrecto' };
    return { ok: true, token: datos.token };
  } catch {
    return { ok: false, mensaje: 'No hay conexión con el sistema. Probá de nuevo en un rato.' };
  }
}
