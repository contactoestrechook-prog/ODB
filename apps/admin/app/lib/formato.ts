// Formatos del panel: plata, números, porcentajes y fechas, en castellano de
// Argentina. Reemplaza las 53 copias de `const pesos = …` que había en las
// pantallas (cada una con su variante).
//
// Reglas:
// - Lo que no es un número (null, undefined, '', NaN) se muestra como '—', no
//   como "$0": en un sistema de plata, "no sé" y "cero" no son lo mismo. Si la
//   copia vieja hacía `Number(n) || 0`, migrá con `pesos(n ?? 0)` para que la
//   pantalla siga mostrando lo mismo.
// - Las fechas se arman siempre en la hora de Buenos Aires y pieza por pieza,
//   así el servidor (que corre en UTC) y el navegador escriben exactamente lo
//   mismo. Si no, una fecha cerca de medianoche sale distinta en cada lado.
// - Funciones puras: sirven en componentes de servidor y de cliente. Para
//   mostrar plata en pantalla está el componente <Monto> del kit, que además
//   alinea las cifras (clase `importe`).

export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
const GUION = '—';

/* ------------------------------------------------------------------ números */

/** Convierte lo que venga de la API (número o texto, como los `numeric` de Postgres) en número; si no es un número, null. */
export function aNumero(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const enteros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const conCentavos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type OpcionesPesos = {
  /** true: con centavos ("$1.234,50"). Por defecto se redondea a pesos ("$1.235"). */
  decimales?: boolean;
  /** true: antepone "+" a los positivos ("+$1.200"), para diferencias. */
  signo?: boolean;
  /** Qué mostrar si el valor no es un número. Por defecto '—'. */
  vacio?: string;
};

/**
 * Plata: "$1.234.567". Negativos: "-$1.234". Con `decimales`: "$1.234,50".
 * pesos(null) → "—"; pesos(n ?? 0) → "$0".
 */
export function pesos(v: unknown, { decimales = false, signo = false, vacio = GUION }: OpcionesPesos = {}): string {
  const n = aNumero(v);
  if (n == null) return vacio;
  const abs = Math.abs(n);
  const cuerpo = decimales ? conCentavos.format(abs) : enteros.format(Math.round(abs));
  const esCero = cuerpo === '0' || cuerpo === '0,00';
  const prefijo = n < 0 && !esCero ? '-' : signo && n > 0 && !esCero ? '+' : '';
  return `${prefijo}$${cuerpo}`;
}

/**
 * Plata abreviada para lugares chicos (gráficos, chips): "$950", "$12k",
 * "$1,5k", "$1,2M", "$3,4MM" (miles de millones).
 */
export function pesosCorto(v: unknown, { vacio = GUION }: { vacio?: string } = {}): string {
  const n = aNumero(v);
  if (n == null) return vacio;
  const abs = Math.abs(n);
  const menos = n < 0 ? '-' : '';
  const corto = (x: number, sufijo: string) => {
    const t = x < 10 ? x.toFixed(1).replace('.', ',').replace(/,0$/, '') : String(Math.round(x));
    return `${menos}$${t}${sufijo}`;
  };
  if (abs >= 1e9) return corto(abs / 1e9, 'MM');
  if (abs >= 1e6) return corto(abs / 1e6, 'M');
  if (abs >= 1e3) return corto(abs / 1e3, 'k');
  return pesos(n);
}

/** Número con separador de miles: "1.234". Con `decimales`: "1.234,5" (hasta esa cantidad de decimales). */
export function numero(v: unknown, decimales = 0, { vacio = GUION }: { vacio?: string } = {}): string {
  const n = aNumero(v);
  if (n == null) return vacio;
  return n.toLocaleString('es-AR', { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
}

/**
 * Porcentaje a partir del número ya en por ciento: porcentaje(12.5) → "12,5%".
 * Si tenés una fracción (0,125), pasá `{ fraccion: true }`.
 */
export function porcentaje(
  v: unknown,
  decimales = 0,
  { fraccion = false, signo = false, vacio = GUION }: { fraccion?: boolean; signo?: boolean; vacio?: string } = {},
): string {
  const n = aNumero(v);
  if (n == null) return vacio;
  const p = fraccion ? n * 100 : n;
  const texto = p.toLocaleString('es-AR', { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
  return `${signo && p > 0 ? '+' : ''}${texto}%`;
}

/** CUIT/CUIL con guiones: "20123456789" → "20-12345678-9". Si no tiene 11 dígitos, se devuelve como vino. */
export function cuit(v: unknown, { vacio = GUION }: { vacio?: string } = {}): string {
  if (v == null || v === '') return vacio;
  const d = String(v).replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(v);
}

/* ------------------------------------------------------------------- fechas */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// en-US con 2 dígitos da piezas con cero adelante y sin sorpresas de idioma;
// el texto en castellano lo armamos nosotros.
const piezasFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

type Piezas = { dia: string; mes: string; anio: string; hora: string; minuto: string; diaSemana: number };

function piezas(d: Date): Piezas {
  const p: Record<string, string> = {};
  for (const x of piezasFmt.formatToParts(d)) p[x.type] = x.value;
  return {
    dia: p.day,
    mes: p.month,
    anio: p.year,
    hora: p.hour === '24' ? '00' : p.hour,
    minuto: p.minute,
    diaSemana: Math.max(0, DIAS_EN.indexOf(p.weekday)),
  };
}

/**
 * Convierte lo que venga de la API en Date. Una fecha sola ("2026-10-05", como
 * las columnas `date` de Postgres) se toma al mediodía de Buenos Aires, para
 * que no se corra al día anterior.
 */
export function aFecha(v: unknown): Date | null {
  if (v == null || v === '') return null;
  let d: Date;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v);
  else {
    const s = String(v).trim();
    d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-03:00`) : new Date(s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export type EstiloFecha = 'corta' | 'normal' | 'completa' | 'larga' | 'dia';

/**
 * Fecha en hora de Buenos Aires.
 * - 'corta'    → "05/10"
 * - 'normal'   → "05/10/26" (la más usada en el panel; es la de por defecto)
 * - 'completa' → "05/10/2026"
 * - 'larga'    → "5 de octubre de 2026"
 * - 'dia'      → "lunes 5 de octubre"
 */
export function fecha(v: unknown, estilo: EstiloFecha = 'normal', { vacio = GUION }: { vacio?: string } = {}): string {
  const d = aFecha(v);
  if (!d) return vacio;
  const p = piezas(d);
  switch (estilo) {
    case 'corta':
      return `${p.dia}/${p.mes}`;
    case 'completa':
      return `${p.dia}/${p.mes}/${p.anio}`;
    case 'larga':
      return `${Number(p.dia)} de ${MESES[Number(p.mes) - 1]} de ${p.anio}`;
    case 'dia':
      return `${DIAS[p.diaSemana]} ${Number(p.dia)} de ${MESES[Number(p.mes) - 1]}`;
    default:
      return `${p.dia}/${p.mes}/${p.anio.slice(-2)}`;
  }
}

/** Hora en Buenos Aires: "14:05". */
export function hora(v: unknown, { vacio = GUION }: { vacio?: string } = {}): string {
  const d = aFecha(v);
  if (!d) return vacio;
  const p = piezas(d);
  return `${p.hora}:${p.minuto}`;
}

/** Día y hora: "05/10, 14:05". Con `conAnio`: "05/10/26, 14:05". */
export function fechaHora(v: unknown, { conAnio = false, vacio = GUION }: { conAnio?: boolean; vacio?: string } = {}): string {
  const d = aFecha(v);
  if (!d) return vacio;
  const p = piezas(d);
  return `${p.dia}/${p.mes}${conAnio ? '/' + p.anio.slice(-2) : ''}, ${p.hora}:${p.minuto}`;
}

/** "AAAA-MM-DD" del día en Buenos Aires (para filtros `desde`/`hasta` de la API). */
export function fechaISO(v: unknown = new Date()): string {
  const d = aFecha(v) ?? new Date();
  const p = piezas(d);
  return `${p.anio}-${p.mes}-${p.dia}`;
}

/** Hoy en Buenos Aires, "AAAA-MM-DD". Ojo: `new Date().toISOString()` da el día de Londres después de las 21 h. */
export function hoyISO(): string {
  return fechaISO(new Date());
}

/** "AAAA-MM-DD" de hace `dias` días, en Buenos Aires. */
export function diasAtrasISO(dias: number): string {
  return fechaISO(new Date(Date.now() - dias * 86_400_000));
}

/**
 * Hace cuánto: "recién", "hace 5 min", "hace 3 h", "ayer", "hace 4 días" y,
 * pasada una semana, la fecha corta. Depende de la hora actual: usala en
 * componentes de cliente (si la escribe el servidor, al llegar al navegador
 * ya cambió y React avisa que el HTML no coincide).
 */
export function hace(v: unknown, { vacio = GUION }: { vacio?: string } = {}): string {
  const d = aFecha(v);
  if (!d) return vacio;
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return fecha(d, 'corta');
}
