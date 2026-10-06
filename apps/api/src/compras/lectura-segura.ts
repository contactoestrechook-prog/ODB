import { interpretarRenglon, LecturaRenglon } from './bultos';

/** Ausente no significa cero. Tampoco se aceptan booleanos ni objetos como números. */
export function numeroLeido(valor: unknown): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  if (typeof valor === 'string' && !valor.trim()) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

type Lectura = Omit<LecturaRenglon, 'cantidad' | 'precio'> & {
  cantidad: number | null;
  precio: number | null;
};

export function interpretarLecturaSegura(l: Lectura) {
  const cantidad = numeroLeido(l.cantidad);
  const precio = numeroLeido(l.precio);
  const importe = numeroLeido(l.importe);
  const descuento = l.esDescuento;
  const faltantes: string[] = [];
  if (cantidad == null || cantidad <= 0) faltantes.push('cantidad');
  if (precio == null || (!descuento && precio < 0)) faltantes.push('precio');
  // Sin importe impreso no hay evidencia para comprobar una conversión.
  if (importe == null) faltantes.push('importe');
  if (faltantes.length || cantidad == null || precio == null) return {
    decision: 'incompleto' as const, cantidad, porPeso: false,
    unidadesPorBulto: l.unidadesPorBulto, bultoDescartado: null, razonBulto: null, cantidadOriginal: null,
    bultoConsumido: null, precioPropuesto: null, bonificacionPct: l.bonificacionPct,
    importeNeto: null, alicuotaDeducida: null, faltantes,
  };
  return { ...interpretarRenglon({ ...l, cantidad, precio, importe }), faltantes };
}
