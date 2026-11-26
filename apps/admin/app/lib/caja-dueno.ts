// CAJA DEL DUEÑO, AL DÍA (26/11/2026). Juan Pablo vio la hoja igual a su Excel y dijo:
// «si lo tengo igual que Excel me quedo ahí haciéndolo». Lo que el Excel no hace:
//  · entender lo que se escribe o se dicta como se diría («pagué 686 mil a CCU»,
//    «saqué 5,1 millones de la caja de St Thomas», «cobré 91 mil de Romina del reparto»);
//  · repetir lo de siempre de un toque;
//  · hacer las cuentas solo: cuánto hay, cuánto entró y salió en el mes, de dónde
//    entró y en qué se fue.
// Todo sin base: lo usa la pantalla (ui/CajaDuenoAlDia.tsx) y lo prueba el API
// (apps/api/src/caja-dueno/caja-dueno-al-dia.spec.ts).

export type TipoMov = 'ingreso' | 'egreso';
export type MovCaja = { id: string; tipo: TipoMov; cuadroId: string | null; fecha: string; motivo: string; monto: number };
export type CuadroCaja = { id: string; nombre: string; orden: number };

/** Lo que se entendió de una frase. Lo que falta queda en null y se elige en la ficha. */
export type Leido = { tipo: TipoMov | null; monto: number | null; motivo: string; cuadroId: string | null; fecha: string };

export const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** AAAA-MM-DD de hoy en Buenos Aires. */
export const hoyBA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const fechaReal = (a: number, m: number, d: number): string | null => {
  const f = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const x = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === f ? f : null;
};

// ---------- montos ----------

/** «686.000», «5.100.000», «1,5», «4000000», «$686.000», «1.500,50» → número (sin multiplicador). */
export function numeroEscrito(texto: string): number | null {
  let t = String(texto ?? '').replace(/[$\s]/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** El monto de un campo de plata: mayor a cero y con centavos redondos. */
export function montoEscrito(texto: string): number | null {
  const n = numeroEscrito(texto);
  return n != null && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
}

/** Mientras se escribe un monto, los puntos de miles van apareciendo: «1500000» → «1.500.000». */
export function conPuntos(texto: string): string {
  const limpio = String(texto ?? '').replace(/[^\d,]/g, '');
  const [entero, ...resto] = limpio.split(',');
  const miles = (entero.replace(/^0+(?=\d)/, '')).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return resto.length ? `${miles},${resto.join('').slice(0, 2)}` : miles;
}

/** Al revés: 686000 → «686.000», 1500.5 → «1.500,50», para poner un monto en el campo. */
export function montoParaCampo(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return Number.isInteger(n)
    ? n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
    : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MULTIPLICADOR: Record<string, number> = {
  mil: 1e3, luca: 1e3, lucas: 1e3, k: 1e3,
  millon: 1e6, millones: 1e6, palo: 1e6, palos: 1e6, m: 1e6, mm: 1e6, kilo: 1e6, kilos: 1e6,
};

// ---------- lo que se dice ----------

const VERBOS_EGRESO = new Set([
  'pague', 'pago', 'pagamos', 'pagar', 'salio', 'salieron', 'sale', 'salen', 'gaste', 'gastamos', 'gasto', 'compre', 'compramos',
  'transferi', 'transferimos', 'mande', 'mandamos', 'egreso', 'deposite', 'preste', 'abone', 'cancele', 'pagado',
]);
const VERBOS_INGRESO = new Set([
  'entro', 'entraron', 'entra', 'entran', 'cobre', 'cobro', 'cobramos', 'ingreso', 'ingresaron', 'ingresa', 'recibi', 'recibimos',
  'reingreso', 'rendicion', 'rindio', 'rindieron', 'arqueo', 'cobrado',
]);
// sacar plata de una caja es un ingreso a la del dueño; sin decir de dónde, no se sabe
const VERBOS_RETIRO = new Set(['saque', 'sacamos', 'retire', 'retiramos', 'retiro', 'levante', 'levantamos', 'traje', 'trajimos']);
const DESPUES_DE_ME = new Set(['pagaron', 'pago', 'dieron', 'dio', 'devolvio', 'devolvieron', 'transfirieron', 'transfirio', 'mandaron', 'mando', 'trajeron', 'trajo']);
const DESPUES_DE_LE = new Set(['di', 'dimos', 'pague', 'pagamos', 'mande', 'mandamos', 'transferi', 'transferimos', 'deje', 'dejamos', 'devolvi', 'preste']);
const RELLENO = new Set(['de', 'del', 'a', 'al', 'la', 'el', 'los', 'las', 'para', 'por', 'en', 'y', 'que', 'pesos', 'peso', '$', 'con', 'desde', 'hacia', 'lo', 'le', 'les', 'me', 'se']);
const MOTIVO_DEL_VERBO: Record<string, string> = { retiro: 'Retiro', saque: 'Retiro', sacamos: 'Retiro', retire: 'Retiro', retiramos: 'Retiro', levante: 'Retiro', levantamos: 'Retiro', traje: 'Retiro', trajimos: 'Retiro', arqueo: 'Arqueo', rendicion: 'Rendición', rindio: 'Rendición', rindieron: 'Rendición', reingreso: 'Reingreso' };

/** Las palabras de un origen que lo reconocen en una frase («CAJA ST THOMAS» → thomas). */
function palabrasDelCuadro(nombre: string): string[] {
  const p = sinTildes(nombre).split(/[^a-z0-9ñ]+/).filter(Boolean);
  const fuertes = p.filter((x) => x.length >= 4 && !['caja', 'cajas', 'sucursal', 'local'].includes(x));
  return fuertes.length ? fuertes : p;
}

/**
 * Lo que se escribió o se dictó, entendido: si entró o salió, cuánto, de qué, de qué origen
 * y qué día. Lo que no se entiende queda vacío para elegirlo en la ficha (nunca se adivina).
 */
export function leerDicho(texto: string, cuadros: CuadroCaja[], previos: MovCaja[], hoy = hoyBA(), tipoDado: TipoMov | null = null): Leido {
  const crudos = String(texto ?? '').replace(/[“”«»"]/g, ' ').split(/\s+/).filter(Boolean);
  const normales = crudos.map((t) => sinTildes(t).replace(/^[.,;:!?¡¿(]+|[.,;:!?)]+$/g, ''));
  const usada = new Array(crudos.length).fill(false);
  let tipo: TipoMov | null = null;
  let retiro = false;
  let motivoDelVerbo = '';

  // 1. el verbo: el primero que diga si entró o salió
  for (let i = 0; i < normales.length && tipo === null && !retiro; i++) {
    const t = normales[i];
    const sig = normales[i + 1] ?? '';
    if (t === 'me' && DESPUES_DE_ME.has(sig)) { tipo = 'ingreso'; usada[i] = usada[i + 1] = true; }
    else if ((t === 'le' || t === 'les') && DESPUES_DE_LE.has(sig)) { tipo = 'egreso'; usada[i] = usada[i + 1] = true; }
    else if (VERBOS_INGRESO.has(t)) { tipo = 'ingreso'; usada[i] = true; motivoDelVerbo = MOTIVO_DEL_VERBO[t] ?? ''; }
    else if (VERBOS_EGRESO.has(t)) { tipo = 'egreso'; usada[i] = true; }
    else if (VERBOS_RETIRO.has(t)) { retiro = true; usada[i] = true; motivoDelVerbo = MOTIVO_DEL_VERBO[t] ?? 'Retiro'; }
  }

  // 2. la fecha: hoy, ayer, anteayer, el 7, 7/11, 7/11/2026
  let fecha = hoy;
  for (let i = 0; i < normales.length; i++) {
    if (usada[i]) continue;
    const t = normales[i];
    if (t === 'hoy') { usada[i] = true; break; }
    if (t === 'ayer') { fecha = sumarDias(hoy, -1); usada[i] = true; if (normales[i - 1] === 'de' && normales[i - 2] === 'antes') { fecha = sumarDias(hoy, -2); usada[i - 1] = usada[i - 2] = true; } break; }
    if (t === 'anteayer') { fecha = sumarDias(hoy, -2); usada[i] = true; break; }
    const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
    if (dm) {
      const anioHoy = Number(hoy.slice(0, 4));
      let anio = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : anioHoy;
      let f = fechaReal(anio, Number(dm[2]), Number(dm[1]));
      // «el 28/12» dicho en enero es del año pasado
      if (f && !dm[3] && f > hoy) { anio -= 1; f = fechaReal(anio, Number(dm[2]), Number(dm[1])); }
      if (f) { fecha = f; usada[i] = true; if (normales[i - 1] === 'el') usada[i - 1] = true; break; }
    }
    if (t === 'el' && /^\d{1,2}$/.test(normales[i + 1] ?? '') && !MULTIPLICADOR[normales[i + 2] ?? '']) {
      const d = Number(normales[i + 1]);
      const [a, m] = hoy.split('-').map(Number);
      let f = fechaReal(a, m, d);
      if (f && f > hoy) f = m === 1 ? fechaReal(a - 1, 12, d) : fechaReal(a, m - 1, d);
      if (f) { fecha = f; usada[i] = usada[i + 1] = true; break; }
    }
  }

  // 3. el monto: el primer número (con «mil», «millones», «palos», «lucas»), o «un millón», «medio palo»
  let monto: number | null = null;
  for (let i = 0; i < normales.length && monto === null; i++) {
    if (usada[i]) continue;
    const t = normales[i].replace(/^\$/, '');
    const sig = normales[i + 1] ?? '';
    if ((t === 'un' || t === 'medio') && MULTIPLICADOR[sig] === 1e6) {
      monto = t === 'un' ? 1e6 : 5e5; usada[i] = usada[i + 1] = true;
      if (t === 'un' && normales[i + 2] === 'y' && normales[i + 3] === 'medio') { monto = 1.5e6; usada[i + 2] = usada[i + 3] = true; }
      break;
    }
    const pegado = /^(\d[\d.,]*)(mil|k|m|mm|lucas?|palos?)$/.exec(t);
    const n = numeroEscrito(pegado ? pegado[1] : t);
    if (n == null || n <= 0) continue;
    usada[i] = true;
    const mult = pegado ? MULTIPLICADOR[pegado[2]] : MULTIPLICADOR[sig];
    if (mult && !pegado) usada[i + 1] = true;
    monto = Math.round(n * (mult ?? 1) * 100) / 100;
    // «2 millones 500 mil» / «1 millón y medio»
    if (mult === 1e6 && !pegado) {
      const a = normales[i + 2], b = normales[i + 3], c = normales[i + 4];
      if (a === 'y' && b === 'medio') { monto += 5e5; usada[i + 2] = usada[i + 3] = true; }
      else if (a && /^\d{1,3}$/.test(a) && b === 'mil') { monto += Number(a) * 1e3; usada[i + 2] = usada[i + 3] = true; }
      else if (a === 'y' && b && /^\d{1,3}$/.test(b) && c === 'mil') { monto += Number(b) * 1e3; usada[i + 2] = usada[i + 3] = usada[i + 4] = true; }
    }
  }

  // 4. el origen (solo cuenta para lo que entra): si la frase lo nombra
  let cuadroId: string | null = null;
  const nombrado = cuadros.find((c) => palabrasDelCuadro(c.nombre).some((p) => normales.includes(p)));
  if (nombrado) {
    cuadroId = nombrado.id;
    const suyas = new Set([...sinTildes(nombrado.nombre).split(/[^a-z0-9ñ]+/).filter(Boolean), 'caja']);
    normales.forEach((t, i) => { if (suyas.has(t)) usada[i] = true; });
  } else if (normales.includes('caja')) {
    const conCaja = cuadros.filter((c) => /caja/i.test(sinTildes(c.nombre)));
    if (conCaja.length === 1) { cuadroId = conCaja[0].id; normales.forEach((t, i) => { if (t === 'caja') usada[i] = true; }); }
  }
  // sacar plata de una caja que se nombra = entra a la del dueño
  if (retiro && cuadroId) tipo = 'ingreso';

  // 5. el motivo: lo que queda, sin palabras de relleno en las puntas
  const resto = crudos.map((t, i) => ({ t: t.replace(/^[.,;:!?¡¿(]+|[.,;:!?)]+$/g, ''), n: normales[i], usada: usada[i] })).filter((x) => !x.usada && x.t);
  while (resto.length && RELLENO.has(resto[0].n)) resto.shift();
  while (resto.length && RELLENO.has(resto[resto.length - 1].n)) resto.pop();
  let motivo = resto.map((x) => x.t).join(' ').trim() || motivoDelVerbo;
  // si ya se usó ese motivo, se escribe igual que antes («ccu» → «CCU»)
  const igual = previos.find((m) => sinTildes(m.motivo).trim() === sinTildes(motivo).trim());
  if (igual) motivo = igual.motivo;
  else if (motivo) motivo = motivo.charAt(0).toUpperCase() + motivo.slice(1);
  // lo que no se dijo sale de la historia de ese motivo, solo si siempre fue para el mismo lado
  // («Retiro» entró de St Thomas y también salió: ahí se elige, no se adivina)
  // si la frase no lo dice y se tocó «Entró» o «Salió», manda lo tocado
  if (tipo === null && tipoDado) tipo = tipoDado;
  const mismos = motivo ? previos.filter((m) => sinTildes(m.motivo).trim() === sinTildes(motivo).trim()) : [];
  const siempre = (t: TipoMov) => mismos.length > 0 && mismos.every((m) => m.tipo === t);
  if (tipo === null && siempre('egreso')) tipo = 'egreso';
  if (!cuadroId && (tipo === 'ingreso' || (tipo === null && siempre('ingreso')))) {
    // un ingreso sin origen dicho va al de la última vez que entró por ese motivo
    const antes = [...mismos].reverse().find((m) => m.tipo === 'ingreso' && m.cuadroId);
    if (antes) { cuadroId = antes.cuadroId; tipo = 'ingreso'; }
  }
  if (tipo === 'egreso') cuadroId = null;
  return { tipo, monto, motivo, cuadroId, fecha };
}

// ---------- las cuentas ----------

const centavos = (n: number) => Math.round(n * 100);

export function saldoDe(movs: MovCaja[]): number {
  return movs.reduce((s, m) => s + (m.tipo === 'ingreso' ? centavos(m.monto) : -centavos(m.monto)), 0) / 100;
}

export type Parte = { clave: string; nombre: string; monto: number; veces: number };
export type Resumen = { entro: number; salio: number; queda: number; deDonde: Parte[]; enQue: Parte[] };

/** Lo de un período: cuánto entró y salió, de dónde entró (por origen) y en qué se fue (por motivo). */
export function resumenDe(movs: MovCaja[], cuadros: CuadroCaja[]): Resumen {
  const deDonde = new Map<string, Parte>();
  const enQue = new Map<string, Parte>();
  let entro = 0, salio = 0;
  for (const m of movs) {
    const c = centavos(m.monto);
    if (m.tipo === 'ingreso') {
      entro += c;
      const k = m.cuadroId ?? '—';
      const p = deDonde.get(k) ?? { clave: k, nombre: cuadros.find((x) => x.id === m.cuadroId)?.nombre ?? 'Sin origen', monto: 0, veces: 0 };
      p.monto += c; p.veces += 1; deDonde.set(k, p);
    } else {
      salio += c;
      const k = sinTildes(m.motivo).trim() || '—';
      const p = enQue.get(k) ?? { clave: k, nombre: m.motivo.trim() || 'Sin motivo', monto: 0, veces: 0 };
      p.monto += c; p.veces += 1; enQue.set(k, p);
    }
  }
  const lista = (mapa: Map<string, Parte>) => [...mapa.values()].map((p) => ({ ...p, monto: p.monto / 100 })).sort((a, b) => b.monto - a.monto || a.nombre.localeCompare(b.nombre));
  return { entro: entro / 100, salio: salio / 100, queda: (entro - salio) / 100, deDonde: lista(deDonde), enQue: lista(enQue) };
}

export type Frecuente = { tipo: TipoMov; cuadroId: string | null; motivo: string; monto: number; veces: number; ultima: string };

/** «Lo de siempre»: los movimientos que más se repiten (y los últimos), con el último monto. */
export function frecuentesDe(movs: MovCaja[], tope = 4): Frecuente[] {
  const grupos = new Map<string, Frecuente>();
  for (const m of [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!m.motivo.trim()) continue;
    const k = `${m.tipo}|${m.cuadroId ?? ''}|${sinTildes(m.motivo).trim()}`;
    const g = grupos.get(k);
    if (g) { g.veces += 1; g.monto = m.monto; g.ultima = m.fecha; g.motivo = m.motivo; }
    else grupos.set(k, { tipo: m.tipo, cuadroId: m.cuadroId, motivo: m.motivo, monto: m.monto, veces: 1, ultima: m.fecha });
  }
  return [...grupos.values()].sort((a, b) => b.veces - a.veces || b.ultima.localeCompare(a.ultima) || b.monto - a.monto).slice(0, tope);
}

/** Los movimientos por día, del más nuevo al más viejo. */
export function porDia(movs: MovCaja[]): { fecha: string; movs: MovCaja[]; entro: number; salio: number }[] {
  const dias = new Map<string, MovCaja[]>();
  for (const m of movs) dias.set(m.fecha, [...(dias.get(m.fecha) ?? []), m]);
  return [...dias.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([fecha, lista]) => {
    const r = resumenDe(lista, []);
    return { fecha, movs: lista, entro: r.entro, salio: r.salio };
  });
}

export type Periodo = 'mes' | 'pasado' | 'todo';

/** Desde y hasta de un período (AAAA-MM-DD), o null para «todo». */
export function rangoPeriodo(p: Periodo, hoy = hoyBA()): { desde: string; hasta: string } | null {
  if (p === 'todo') return null;
  const [a, m] = hoy.split('-').map(Number);
  if (p === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  const aa = m === 1 ? a - 1 : a, mm = m === 1 ? 12 : m - 1;
  const desde = `${aa}-${String(mm).padStart(2, '0')}-01`;
  return { desde, hasta: sumarDias(`${hoy.slice(0, 7)}-01`, -1) };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** «viernes 7 de noviembre de 2026». */
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return fecha;
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** «Hoy», «Ayer», «viernes 7 de noviembre de 2026». */
export function diaLegible(fecha: string, hoy = hoyBA()): string {
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, -1)) return 'Ayer';
  return fechaLarga(fecha);
}

/** «noviembre de 2026». */
export function mesLegible(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/** Para bajar en Excel: separado por «;» y con coma decimal, como lo abre el Excel en castellano. */
export function csvCaja(movs: MovCaja[], cuadros: CuadroCaja[]): string {
  const celda = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const filas = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((m) => {
    const [a, mes, d] = m.fecha.split('-');
    return [
      `${Number(d)}/${Number(mes)}/${a}`,
      m.tipo === 'ingreso' ? 'Entró' : 'Salió',
      m.tipo === 'ingreso' ? cuadros.find((c) => c.id === m.cuadroId)?.nombre ?? '' : 'EGRESOS',
      m.motivo,
      m.monto.toFixed(2).replace('.', ','),
    ].map(celda).join(';');
  });
  return `﻿${['Fecha;Entró o salió;Origen;Motivo;Monto', ...filas].join('\r\n')}\r\n`;
}
