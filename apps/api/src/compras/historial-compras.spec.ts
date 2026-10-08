// Lo que nos vende cada proveedor (8/10/2026): el resumen que ven la mesa de
// compras y el Analista. Renglones con la forma de las facturas de Oxxon.
import { codigoDeLaCasa, precioNeto, resumirProveedor, type RenglonHistorial } from './historial-compras';

const r = (x: Partial<RenglonHistorial>): RenglonHistorial => ({
  producto_id: null, numero: '0006-1', fecha: '2026-10-07', codigo_proveedor: null, descripcion: 'X',
  unidades_por_bulto: null, unidades: 1, precio: 100, bonificacion_pct: null, importe: 100, costo_unitario: null, es_descuento: false, ...x,
});
const productos = new Map([
  ['fuet', { id: 'fuet', sku: 'L12590', nombre: 'Fuet x 130 g', codigo_legacy: '12590' }],
  ['jamon', { id: 'jamon', sku: 'L10578', nombre: 'Jamon Natural Rifka', codigo_legacy: '10578' }],
  ['lista', { id: 'lista', sku: '6668', nombre: 'Gin Hendricks' }],
]);

describe('resumirProveedor', () => {
  const renglones = [
    // Fuet: 3 compras, sube de $3.590 a $3.950,89 con 10%
    r({ producto_id: 'fuet', numero: 'A', fecha: '2026-09-10', precio: 3590, bonificacion_pct: 10, unidades: 30, unidades_por_bulto: 10, codigo_proveedor: 'BCT-01' }),
    r({ producto_id: 'fuet', numero: 'B', fecha: '2026-09-24', precio: 3800, bonificacion_pct: 10, unidades: 20, unidades_por_bulto: 10 }),
    r({ producto_id: 'fuet', numero: 'C', fecha: '2026-10-07', precio: 3950.89, bonificacion_pct: 10, unidades: 30, unidades_por_bulto: 10, costo_unitario: 4587 }),
    // Jamón: una sola compra
    r({ producto_id: 'jamon', numero: 'C', fecha: '2026-10-07', precio: 16537.15, bonificacion_pct: 10, unidades: 6 }),
    // sin vincular, dos veces, mismo código
    r({ numero: 'B', fecha: '2026-09-24', codigo_proveedor: 'SD-77', descripcion: 'SD- ALITAS DE POLLO', precio: 4500 }),
    r({ numero: 'C', fecha: '2026-10-07', codigo_proveedor: 'SD-77', descripcion: 'SD- ALITAS DE POLLO REBOZADAS', precio: 4798.57, bonificacion_pct: 10 }),
    // un descuento no cuenta como producto
    r({ numero: 'C', descripcion: 'Descuento', es_descuento: true, importe: -5000 }),
  ];
  const vinculos = [
    { producto_id: 'fuet', codigo_proveedor: 'VIEJO', ultimo_costo: 4000, actualizado_en: '2026-10-07T10:00:00Z' },
    { producto_id: 'lista', codigo_proveedor: 'GIN-1', ultimo_costo: 31000, actualizado_en: '2026-09-01T10:00:00Z' },
  ];
  const res = resumirProveedor(renglones, vinculos, productos);

  it('cuenta comprobantes y fechas sin los descuentos', () => {
    expect(res).toMatchObject({ comprobantes: 3, primeraCompra: '2026-09-10', ultimaCompra: '2026-10-07' });
  });
  it('Fuet: último precio neto, el anterior, la suba, cada cuánto y cuánto', () => {
    const f = res.productos.find((p) => p.sku === 'L12590')!;
    expect(f).toMatchObject({
      codigo: '12590', compras: 3, ultimaCompra: '2026-10-07', ultimoPrecio: 3555.8, precioAnterior: 3420,
      variacionPct: 4, bonificacionPct: 10, unidadesPorBulto: 10, unidadesTotales: 80, cadaCuantosDias: 14, costoUnitario: 4587,
      codigoProveedor: 'BCT-01', soloVinculo: false,
    });
    expect(f.promedioPorCompra).toBeCloseTo(26.7, 1);
  });
  it('lo más reciente primero; lo que solo se conoce por la lista va al final', () => {
    expect(res.productos.map((p) => p.sku)).toEqual(['L12590', 'L10578', '6668']);
    expect(res.productos[2]).toMatchObject({ soloVinculo: true, codigo: '6668', costoUnitario: 31000, compras: 0 });
  });
  it('los renglones sin vincular se juntan por el código del proveedor', () => {
    expect(res.sinVincular).toEqual([expect.objectContaining({ codigoProveedor: 'SD-77', compras: 2, ultimaCompra: '2026-10-07', ultimoPrecio: 4318.71 })]);
  });
});

describe('ayudas', () => {
  it('precio neto y código de la casa', () => {
    expect(precioNeto({ precio: 3950.89, bonificacion_pct: 10 })).toBe(3555.8);
    expect(precioNeto({ precio: null, bonificacion_pct: 10 })).toBeNull();
    expect(codigoDeLaCasa({ plu: '03931', codigo_legacy: '1', sku: 'L1' })).toBe('3931');
    expect(codigoDeLaCasa({ sku: 'GIN-HEN' })).toBeNull();
  });
});
