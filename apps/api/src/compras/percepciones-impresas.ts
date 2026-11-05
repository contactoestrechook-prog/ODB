// ============================================================
// LA ALÍCUOTA Y LA BASE DE UNA PERCEPCIÓN, DEL TEXTO DE SU ETIQUETA (5/11/2026)
//
// Para aplicar la regla de las percepciones con base propia (ver
// apps/admin/app/lib/percepciones-compras.ts) hace falta saber el % impreso y
// la base sobre la que se cobró cada percepción. El primer intento fue pedirle
// al lector cuatro campos nuevos en el pie: con ellos la IA rechazó el pedido y
// el lector dejó de leer TODAS las facturas (5/11/2026, de 17:26 a 17:29; se
// volvió a la versión anterior). El esquema del lector está en su límite: NO
// admite más campos, ni siquiera obligatorios.
//
// Por eso viajan como TEXTO, al final de la etiqueta literal que el lector ya
// devuelve por cada percepción:
//   «Percepción IVA CF | alicuota=3 | base=449833.62»
// y acá se separan. Si la etiqueta no los trae, quedan en 0 y todo sigue como
// antes. Lo que se lea mal no hace daño: el panel solo usa una alícuota y una
// base que, multiplicadas, den el monto de la percepción.
// ============================================================

/** «449.833,62», «449833.62», «3,5», «1.250» → número; 0 si no se entiende. */
export function numeroImpreso(texto: unknown): number {
  let s = String(texto ?? '').replace(/[\s$%]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function alicuotaYBaseDeLaEtiqueta(etiqueta: unknown): { alicuota: number; base: number; limpia: string } {
  const t = String(etiqueta ?? '');
  const a = /al[ií]cuota\s*[=:]\s*([\d.,]+)/i.exec(t);
  const b = /base(?:\s+imponible)?\s*[=:]\s*\$?\s*([\d.,]+)/i.exec(t);
  const limpia = t
    .replace(/\s*\|\s*al[ií]cuota\s*[=:][^|]*/i, '')
    .replace(/\s*\|\s*base(?:\s+imponible)?\s*[=:][^|]*/i, '')
    .trim();
  const alicuota = a ? numeroImpreso(a[1]) : 0;
  return { alicuota: alicuota > 0 && alicuota <= 30 ? alicuota : 0, base: b ? numeroImpreso(b[1]) : 0, limpia };
}

/** Deja en el pie la alícuota y la base de cada percepción, y la etiqueta sin ese agregado. */
export function percepcionesDelPie(datos: any): void {
  if (!datos?.impuestos) return;
  for (const campo of ['percepcionIva', 'percepcionIibb'] as const) {
    const etiqueta = datos.etiquetas?.[campo];
    const { alicuota, base, limpia } = alicuotaYBaseDeLaEtiqueta(etiqueta);
    datos.impuestos[`${campo}Alicuota`] = alicuota;
    datos.impuestos[`${campo}Base`] = base;
    if (datos.etiquetas && typeof etiqueta === 'string' && limpia !== etiqueta) datos.etiquetas[campo] = limpia;
  }
}
