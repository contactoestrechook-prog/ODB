// LOS MONTOS SE ESCRIBEN COMO EN ARGENTINA (26/11/2026). Melina pagó una factura de Noria Express
// de $ 288.723,40 escribiendo «288.723» y quedó registrado un pago de $ 288,72: el campo era
// type="number" y el punto se leía como coma decimal. Regla de Leandro (6/11/2026): «cuando pongo
// un millón y medio, que se me vayan poniendo los puntos a medida que voy escribiendo».
// Los puntos son de miles y la coma de decimales. Se prueban en apps/api/src/compras/montos.spec.ts.

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
  const miles = entero.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return resto.length ? `${miles},${resto.join('').slice(0, 2)}` : miles;
}

/** Al revés: 686000 → «686.000», 1500.5 → «1.500,50», para poner un monto en el campo. */
export function montoParaCampo(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r)
    ? r.toLocaleString('es-AR', { maximumFractionDigits: 0 })
    : r.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ¿Tiene centavos? (para mostrar el saldo exacto y no uno redondeado que no se puede pagar) */
export const tieneCentavos = (n: number) => Math.round(Math.abs(Number(n) || 0) * 100) % 100 !== 0;
