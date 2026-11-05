import { createHash } from 'crypto';

// El reporte de liberaciones de Mercado Pago (release_report) leído a filas
// (5/11/2026). Función pura. Cada cuenta puede tener columnas distintas: ODB
// trae RECORD_TYPE y no trae BALANCE_AMOUNT; Santa Inés al revés. Se lee por el
// nombre de la columna.

export type MovimientoMP = {
  id: string;
  cuenta: string;
  fecha: string;
  source_id: string | null;
  descripcion: string;
  credito: number;
  debito: number;
  bruto: number | null;
  comision: number | null;
  impuestos: number | null;
  medio: string | null;
  saldo: number | null;
  orden: number; // lugar de la línea en el reporte: ordena las que tienen la misma hora
};

const numero = (v: string | undefined) => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v.trim().replace(/^"|"$/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export function leerReporteLiberaciones(cuenta: string, csv: string): MovimientoMP[] {
  const lineas = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lineas.length < 2) return [];
  const sep = lineas[0].includes(';') ? ';' : ',';
  const cab = lineas[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, '').toUpperCase());
  const col = (fila: string[], nombre: string) => {
    const i = cab.indexOf(nombre);
    return i < 0 ? undefined : (fila[i] ?? '').trim().replace(/^"|"$/g, '');
  };
  const tieneSaldo = cab.includes('BALANCE_AMOUNT');
  const vistas = new Map<string, number>();
  const out: MovimientoMP[] = [];
  let saldo: number | null = null;

  lineas.slice(1).forEach((linea, k) => {
    const f = linea.split(sep);
    const fecha = col(f, 'DATE');
    if (!fecha) return;
    const tipo = col(f, 'RECORD_TYPE') ?? '';
    let descripcion = col(f, 'DESCRIPTION') ?? '';
    // saldo inicial y total: ODB los marca en RECORD_TYPE; sin esa columna vienen sin descripción
    if (tipo === 'initial_available_balance' || tipo === 'total') descripcion = tipo;
    else if (!descripcion) descripcion = k === 0 ? 'initial_available_balance' : k === lineas.length - 2 ? 'total' : 'sin_descripcion';
    const credito = numero(col(f, 'NET_CREDIT_AMOUNT')) ?? 0;
    const debito = numero(col(f, 'NET_DEBIT_AMOUNT')) ?? 0;

    if (tieneSaldo) saldo = numero(col(f, 'BALANCE_AMOUNT'));
    else if (descripcion === 'initial_available_balance') saldo = Math.round((credito - debito) * 100) / 100;
    else if (descripcion !== 'total' && saldo != null) saldo = Math.round((saldo + credito - debito) * 100) / 100;

    // la misma línea repetida dentro del reporte cuenta aparte; entre reportes es la misma
    const n = (vistas.get(linea) ?? 0) + 1;
    vistas.set(linea, n);
    out.push({
      id: createHash('md5').update(`${cuenta}|${linea}|${n}`).digest('hex'),
      cuenta,
      fecha,
      source_id: col(f, 'SOURCE_ID') || null,
      descripcion,
      credito,
      debito,
      bruto: numero(col(f, 'GROSS_AMOUNT')),
      comision: numero(col(f, 'MP_FEE_AMOUNT')),
      impuestos: numero(col(f, 'TAXES_AMOUNT')),
      medio: col(f, 'PAYMENT_METHOD_TYPE') || col(f, 'PAYMENT_METHOD') || null,
      saldo: descripcion === 'total' ? null : saldo,
      orden: k,
    });
  });
  return out;
}
