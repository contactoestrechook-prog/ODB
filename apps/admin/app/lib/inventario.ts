// ============================================================
// INVENTARIO DE UN PRODUCTO (5/11/2026) — las cuentas de la pantalla: las
// escalas y las marcas de los gráficos y las palabras de cada estado. Lo que
// llega del servidor se arma en apps/api/src/inventario (series.ts).
//
// Funciones puras; se prueban en apps/api/src/inventario/pantalla.spec.ts.
// ============================================================

export type SucursalInventario = {
  id: string;
  nombre: string;
  stock: number;
  ubicacion: string | null;
  minimo: number;
  enCamino: number;
  /** unidades por día, la cuenta de Mesa de compras; null si el motor no lo trae */
  ritmoDia: number | null;
  ritmoFuente: string | null;
  coberturaDias: number | null;
  tendenciaPct: number | null;
  /** 'sin_stock' | 'no_llega' | 'menos_de_12' */
  alerta: string | null;
  sugerido: number;
};

export type MovimientoInventario = {
  id: number;
  en: string;
  sucursalId: string;
  que: string;
  cambio: number;
  saldo: number;
  motivo: string | null;
  quien: string | null;
};

export type PeriodoVenta = { desde: string; hasta: string; dias: number; unidades: number; porDia: number };
export type PuntoPlata = { en: string; valor: number; proveedor?: string | null; origen?: string };
export type SerieNivel = { sucursalId: string; inicial: number; puntos: { en: string; saldo: number }[] };

export type FichaInventario = {
  producto: { sku: string; nombre: string; marca: string | null; rubro: string | null; activo: boolean; porPeso: boolean; codigos: string[] };
  total: number;
  sucursales: SucursalInventario[];
  proveedor: { nombre: string; plazoDias: number; plazoFuente: string | null } | null;
  nivel: { desde: string | null; hasta: string; series: SerieNivel[] };
  movimientos: MovimientoInventario[];
  ventas: { sucursalId: string; periodos: PeriodoVenta[] }[];
  /** null para la caja: no ve costos ni margen */
  plata: null | {
    costos: PuntoPlata[];
    precios: PuntoPlata[];
    costoHoy: number | null;
    precioHoy: number | null;
    mayoristaHoy: number | null;
    margenPct: number | null;
    compras: { fecha: string; numero: string | null; unidades: number; costo: number | null; proveedor: string | null }[];
  };
};

export type ResultadoInventario = {
  sku: string;
  nombre: string;
  rubro: string | null;
  marca: string | null;
  activo: boolean;
  total: number;
  stock: { sucursalId: string; sucursal: string; cantidad: number }[];
};

const DIA = 86_400_000;
const HUSO = 3 * 3_600_000; // Buenos Aires: UTC−3 todo el año
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = (v: number) => String(v).padStart(2, '0');

/** El primer instante de un día de Buenos Aires («2026-10-21» o una fecha con hora). */
export function inicioDelDia(iso: string): number {
  return Date.parse(`${String(iso).slice(0, 10)}T00:00:00-03:00`);
}

/** Una escala lineal: del dominio de los datos a los píxeles. */
export function escala(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const tramo = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / tramo) * (r1 - r0);
}

/**
 * Las marcas de un eje de cantidades: siempre pasan por el cero, van de a 1, 2
 * o 5 (por diez, cien…) y la última queda en el máximo o arriba.
 */
export function marcasDelEje(min: number, max: number, cuantas = 4): number[] {
  const lo = Math.min(0, Number.isFinite(min) ? min : 0);
  const hi = Math.max(0, Number.isFinite(max) ? max : 0);
  if (hi - lo <= 0) return [0, 1];
  const bruto = (hi - lo) / Math.max(1, cuantas);
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto - 1e-12) ?? 10 * pot;
  const limpio = (v: number) => Math.round(v * 1e6) / 1e6;
  const marcas: number[] = [];
  for (let v = Math.floor(lo / paso) * paso; v < hi + paso - 1e-9; v += paso) marcas.push(limpio(v));
  return marcas;
}

export type MarcaDeTiempo = { ms: number; etiqueta: string };

/**
 * Las marcas del eje de tiempo. Si entra más de un mes y medio van por mes
 * (con el año entero en la primera y en cada enero: «oct 2025, nov, dic, ene
 * 2026»); si no, por día («05/11»). Nunca más de `maximo`.
 */
export function marcasDeTiempo(desdeMs: number, hastaMs: number, maximo = 7): MarcaDeTiempo[] {
  const marcas: MarcaDeTiempo[] = [];
  const tope = Math.max(2, maximo);
  if (!(hastaMs > desdeMs)) return marcas;
  if (hastaMs - desdeMs > 45 * DIA) {
    const d = new Date(desdeMs - HUSO);
    let anio = d.getUTCFullYear(), mes = d.getUTCMonth();
    const inicios: { ms: number; anio: number; mes: number }[] = [];
    for (;;) {
      const ms = Date.UTC(anio, mes, 1) + HUSO;
      if (ms > hastaMs) break;
      if (ms >= desdeMs) inicios.push({ ms, anio, mes });
      if (++mes > 11) { mes = 0; anio++; }
    }
    const cada = Math.ceil(inicios.length / tope);
    // de atrás para adelante: el mes más nuevo siempre queda
    const elegidos = inicios.filter((_, i) => (inicios.length - 1 - i) % cada === 0);
    elegidos.forEach((m, i) => marcas.push({
      ms: m.ms,
      etiqueta: i === 0 || m.anio !== elegidos[i - 1].anio ? `${MESES_CORTOS[m.mes]} ${m.anio}` : MESES_CORTOS[m.mes],
    }));
    return marcas;
  }
  const dias = Math.max(1, Math.round((hastaMs - desdeMs) / DIA));
  const paso = [1, 2, 7, 14].find((p) => dias / p <= tope) ?? 14;
  for (let ms = inicioDelDia(new Date(desdeMs - HUSO).toISOString()); ms <= hastaMs; ms += paso * DIA) {
    if (ms < desdeMs) continue;
    const d = new Date(ms - HUSO);
    marcas.push({ ms, etiqueta: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}` });
  }
  return marcas;
}

/** Una línea en escalones: cada valor vale hasta el punto siguiente y el último llega hasta `xFin`. */
export function caminoEscalonado(puntos: { x: number; y: number }[], xFin: number): string {
  if (!puntos.length) return '';
  const r = (v: number) => Math.round(v * 10) / 10;
  let d = `M${r(puntos[0].x)} ${r(puntos[0].y)}`;
  for (let i = 1; i < puntos.length; i++) d += `H${r(puntos[i].x)}V${r(puntos[i].y)}`;
  return `${d}H${r(xFin)}`;
}

/** Cuánto había en una sucursal en un instante (el último cambio hasta ahí, o lo inicial). */
export function nivelEn(serie: SerieNivel, ms: number): number {
  let nivel = serie.inicial;
  for (const p of serie.puntos) {
    if (Date.parse(p.en) > ms) break;
    nivel = p.saldo;
  }
  return nivel;
}

/** El valor de una serie de plata en un instante; null si todavía no había ninguno. */
export function valorEn(puntos: PuntoPlata[], ms: number): PuntoPlata | null {
  let ultimo: PuntoPlata | null = null;
  for (const p of puntos) {
    if (Date.parse(p.en) > ms) break;
    ultimo = p;
  }
  return ultimo;
}

const es = (v: number, max: number, min = 0) => v.toLocaleString('es-AR', { maximumFractionDigits: max, minimumFractionDigits: min });

/** Una cantidad de stock: «81», «5,25». Lo que se vende por peso lleva «kg». */
export function unidades(v: number, porPeso = false): string {
  return `${es(Math.round(v * 1000) / 1000, 3)}${porPeso ? ' kg' : ''}`;
}

/** Un cambio de stock, con su signo: «+90», «−129». */
export function conSigno(v: number, porPeso = false): string {
  if (!v) return '0';
  return `${v > 0 ? '+' : '−'}${unidades(Math.abs(v), porPeso)}`;
}

/** El ritmo de venta: «7,8 por día»; debajo de uno, con dos decimales («0,62 por día»). */
export function porDia(v: number): string {
  return `${es(v, v < 1 ? 2 : 1)} por día`;
}

export type EstadoStock = { tono: 'ok' | 'error' | 'neutro'; palabra: string };

/** El estado de una sucursal, con las mismas palabras que Mesa de compras. */
export function estadoDeSucursal(s: Pick<SucursalInventario, 'alerta' | 'stock' | 'ritmoDia'>): EstadoStock {
  if (s.alerta === 'sin_stock') return { tono: 'error', palabra: 'Sin stock' };
  if (s.alerta === 'no_llega') return { tono: 'error', palabra: 'No llega a tiempo' };
  if (s.alerta === 'menos_de_12') return { tono: 'neutro', palabra: 'Menos de 12' };
  if (s.stock <= 0) return { tono: 'neutro', palabra: 'Sin stock' };
  if ((s.ritmoDia ?? 0) > 0) return { tono: 'ok', palabra: 'Alcanza' };
  return { tono: 'neutro', palabra: 'Sin ventas cargadas' };
}

/** «alcanza para 10 días», «alcanza para 3 meses»; null si no hay cuenta que hacer. */
export function cuantoAlcanza(dias: number | null | undefined): string | null {
  if (dias == null || !(dias > 0)) return null;
  if (dias < 1) return 'alcanza para menos de un día';
  if (dias < 1.5) return 'alcanza para un día';
  if (dias < 60) return `alcanza para ${Math.round(dias)} días`;
  if (dias < 365) return `alcanza para ${Math.round(dias / 30)} meses`;
  return 'alcanza para más de un año';
}

/** El período de ventas, de corrido: «del 1/11/2025 al 30/11/2025». */
export function periodoEnPalabras(p: { desde: string; hasta: string }): string {
  const f = (iso: string) => {
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${d}/${m}/${a}`;
  };
  return `del ${f(p.desde)} al ${f(p.hasta)}`;
}

/** Corre hacia arriba o hacia abajo los rótulos que quedarían encimados (de a pares, alcanza para dos o tres). */
export function separarRotulos(ys: number[], minimo = 14, techo = -Infinity, piso = Infinity): number[] {
  const orden = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < orden.length; k++) {
    const falta = minimo - (orden[k].y - orden[k - 1].y);
    if (falta > 0) {
      orden[k - 1].y -= falta / 2;
      orden[k].y += falta / 2;
    }
  }
  // que ninguno se salga del dibujo
  const corrido = Math.max(0, techo - orden[0].y) - Math.max(0, orden[orden.length - 1].y - piso);
  const salida = new Array<number>(ys.length);
  for (const o of orden) salida[o.i] = o.y + corrido;
  return salida;
}
