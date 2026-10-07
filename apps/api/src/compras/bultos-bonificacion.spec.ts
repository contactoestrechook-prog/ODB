// Renglones por bulto con bonificación del papel (Oxxon 0006-00295763/64 y
// Distri Sur, 7/10/2026): si la cuenta cierra contando las N de cada caja, se
// corrige la cantidad igual que sin bonificación. Si la bonificación no se
// leyó (se dedujo del importe), sigue la pregunta.
import { interpretarRenglon, unidadesPorBulto } from './bultos';
import { precioYaEsDeLaUnidad } from '../../../admin/app/lib/bultos-compras';

const leer = (descripcion: string, cantidad: number, precio: number, importe: number, bonificacionPct: number | null, upbModelo: number | null, extra: Record<string, unknown> = {}) =>
  interpretarRenglon({
    descripcion, cantidad, precio, importe, bonificacionPct,
    unidadesPorBulto: unidadesPorBulto(descripcion) ?? upbModelo,
    esDescuento: false, kg: null, puedePorPeso: false, bultoOrigen: 'modelo', ...extra,
  } as any);

describe('bulto con bonificación del papel', () => {
  it('Oxxon: Tiritas de pollo, 1 bulto de 12 con 10% → 12 unidades', () => {
    const r = leer('SD-TIRITAS DE POLLO X (300 GRS)', 1, 3598.93, 38868.42, 10, 12);
    expect(r).toMatchObject({ decision: 'cantidad_corregida', cantidad: 12, cantidadOriginal: 1, bultoConsumido: 12, bonificacionPct: 10, unidadesPorBulto: null });
    expect(38868.42 / r.cantidad).toBeCloseTo(3239.04, 1);
  });

  it('Oxxon: Fuet, 3 cajas de 10 con 10% → 30 unidades', () => {
    const r = leer('BCT- FUET X (130 GRS)', 3, 3950.89, 106674.17, 10, 10);
    expect(r).toMatchObject({ decision: 'cantidad_corregida', cantidad: 30, bonificacionPct: 10 });
    expect(106674.17 / r.cantidad).toBeCloseTo(3555.81, 2);
  });

  it('Oxxon: sin bonificación sigue igual (Frutilla 1 → 8, Vienissima 1 → 20)', () => {
    expect(leer('IL- (OFERTA) YGR BBLE TETRA FRUTILLA X (950 CC)', 1, 1854.12, 14832.94, null, 8)).toMatchObject({ decision: 'cantidad_corregida', cantidad: 8 });
    expect(leer('QF-VIENISSIMA X (6 UNID)', 1, 1814.31, 36286.14, null, 20)).toMatchObject({ decision: 'cantidad_corregida', cantidad: 20 });
  });

  it('Oxxon: Durazno sin bulto con 10% queda como está', () => {
    expect(leer('IL-YGR BBLE TETRA DURAZNO X (950 CC)', 4, 2183.46, 7860.47, 10, null)).toMatchObject({ decision: 'bonificado', cantidad: 4 });
  });

  it('Distri Sur: bultos «BTO» con 3% pasan a unidades', () => {
    expect(leer('Pepas 10 X 500Grs. Trio', 2, 1460.72, 28338.0, 3, 10)).toMatchObject({ decision: 'cantidad_corregida', cantidad: 20, bonificacionPct: 3 });
    expect(leer('Besitos Glaseados 10 X 300 Grs. Trio', 1, 1022.6, 9919.22, 3, 10)).toMatchObject({ decision: 'cantidad_corregida', cantidad: 10 });
    expect(leer("Celosas 15 X 230Grs. Glin's", 2, 992.03, 28868.16, 3, 15)).toMatchObject({ decision: 'cantidad_corregida', cantidad: 30 });
  });

  it('«18 x 6U»: el texto dice ×6 y la cuenta cierra con ×18 → no decide solo, pregunta', () => {
    // el detector toma el 6 de "6U"; con 6 la cuenta no cierra, así que no se
    // inventa el 18: queda para la persona
    expect(leer('Alfajor Jorgito Chocolate Negro 18 x 6U', 2, 2255.68, 78768.34, 3, 18)).toMatchObject({ decision: 'bonificado', cantidad: 2 });
  });

  it('si la casa vende la caja de N, la cantidad queda en cajas', () => {
    const r = leer('SD-TIRITAS DE POLLO X (300 GRS)', 1, 3598.93, 38868.42, 10, 12, { unidadesDelCatalogo: 12 });
    expect(r).toMatchObject({ decision: 'precio_por_unidad_interna', cantidad: 1, bonificacionPct: 10 });
    expect(r.precioPropuesto).toBeCloseTo(38868.42, 2);
  });

  it('si la bonificación no se leyó (se dedujo del importe), sigue preguntando', () => {
    const r = leer('Tostadas Gruesas Tosti Clasicas 12x200 Grs.', 1, 828.1, 9639.07, null, 12);
    expect(r.decision).toBe('bonificado');
    expect(r.cantidad).toBe(1);
    expect(r.unidadesPorBulto).toBe(12);
  });

  it('una cuenta que no cierra contando las de adentro no se toca', () => {
    expect(leer('SD-TIRITAS DE POLLO X (300 GRS)', 1, 3598.93, 30000, 10, 12).decision).toBe('bonificado');
  });
});

describe('precioYaEsDeLaUnidad (nota «Bonificado» con el bulto pendiente)', () => {
  it('Fuet: el precio del papel es de la unidad', () => {
    expect(precioYaEsDeLaUnidad({ cantidad: 3, precio: 3950.89, importe: 106674.17, bonificacionPct: 10 } as any, 10)).toBe(true);
  });
  it('precio de la caja: no', () => {
    expect(precioYaEsDeLaUnidad({ cantidad: 3, precio: 35558.06, importe: 106674.17, bonificacionPct: 0 } as any, 10)).toBe(false);
  });
});
