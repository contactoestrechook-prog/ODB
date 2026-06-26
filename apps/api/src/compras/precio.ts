// Precio de venta a partir del costo real de la entrada — LÓGICA PURA y testeable.
// Regla de oro ODB: el % se aplica al RECIBIR la mercadería, sobre el costo de esa entrada.

export const MARGEN_DEFAULT = 35; // % a usar si el rubro no tiene margen_sugerido

// Precio final = costo × (1 + margen%). Redondeado.
export function precioDesdeCosto(costo: number, margenPct: number): number {
  const c = Number(costo) || 0;
  const m = Number(margenPct) || 0;
  if (c <= 0) return 0;
  return Math.round(c * (1 + m / 100));
}

// Margen a aplicar: 1) override manual de la recepción, 2) margen del rubro, 3) default.
export function margenAplicable(override?: number | null, margenRubro?: number | null): number {
  if (override != null && Number(override) > 0) return Number(override);
  if (margenRubro != null && Number(margenRubro) > 0) return Number(margenRubro);
  return MARGEN_DEFAULT;
}
