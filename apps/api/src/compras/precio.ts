// Precio de venta a partir del costo real de la entrada — LÓGICA PURA y testeable.
// Regla de oro ODB: el % se aplica al RECIBIR la mercadería, sobre el costo de esa entrada.

export const MARGEN_DEFAULT = 35; // % a usar si el rubro no tiene margen_sugerido

// Redondeo de góndola: a la centena más cercana. Lo que queda por debajo de 50
// baja, de 50 para arriba sube — así no salen precios como $12.347, que además
// obligan a tener monedas en la caja.
//
// Los precios chicos (menos de $100) quedan como están: redondear $45 a la
// centena lo llevaría a $0 o a $100, y ninguno de los dos es el precio.
export const PASO_REDONDEO = 100;

export function redondearPrecio(precio: number): number {
  const p = Number(precio) || 0;
  if (p <= 0) return 0;
  if (p < PASO_REDONDEO) return Math.round(p);
  return Math.round(p / PASO_REDONDEO) * PASO_REDONDEO;
}

// Precio final = costo × (1 + margen%), redondeado a la centena.
export function precioDesdeCosto(costo: number, margenPct: number): number {
  const c = Number(costo) || 0;
  const m = Number(margenPct) || 0;
  if (c <= 0) return 0;
  return redondearPrecio(c * (1 + m / 100));
}

// Margen a aplicar: 1) override manual de la recepción, 2) margen del rubro, 3) default.
export function margenAplicable(override?: number | null, margenRubro?: number | null): number {
  if (override != null && Number(override) > 0) return Number(override);
  if (margenRubro != null && Number(margenRubro) > 0) return Number(margenRubro);
  return MARGEN_DEFAULT;
}
