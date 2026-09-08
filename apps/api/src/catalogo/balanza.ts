// Etiquetas de la balanza interna: EAN-13 con prefijo 2 + PLU (6 dígitos) +
// cantidad (5 dígitos) + dígito de control. La cantidad son GRAMOS si el
// producto se vende por peso, o UNIDADES si no; el precio lo pone el sistema
// desde la lista. Ejemplos reales (2026-09-08): 2 003931 00290 5 = PLU 03931,
// 290 g de pan al peso · 2 012717 00001 1 = PLU 12717, 1 torta matera.
export function parsearCodigoBalanza(codigo: string): { plu: string; valor: number } | null {
  const t = String(codigo ?? '').trim();
  const m = /^2(\d{6})(\d{5})(\d)$/.exec(t);
  if (!m) return null;
  // control EAN-13: los 12 primeros, impares ×1 y pares ×3
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(t[i]) * (i % 2 === 0 ? 1 : 3);
  if ((10 - (suma % 10)) % 10 !== Number(m[3])) return null;
  return { plu: m[1].replace(/^0+/, '') || '0', valor: Number(m[2]) };
}

// Cuánto entra al carrito según el producto: kilos (3 decimales) o unidades.
export function cantidadDeBalanza(valor: number, porPeso: boolean): number {
  return porPeso ? Math.round(valor) / 1000 : Math.max(1, Math.round(valor));
}
