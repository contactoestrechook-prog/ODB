import { diferenciasConLoRegistrado, diferenciasDeEncabezado } from './corregir-con-carga';

// Corregir una factura ya registrada desde la carga (20/11/2026). El caso real:
// Umami 0006-00070233, «LP Exploración Malbec Chacayes» registrada en cajas de 6
// (18 a $13.425,38) cuando eran de 4 (12 a $20.138,07: la plata del papel no cambia).

const registrados = [
  { productoId: 'malbec', nombre: 'Las Perdices Exploracion Malbec - Chacayes x750cc', cantidad: 18, costo: 13425.38 },
  { productoId: 'gewurz', nombre: 'Las Perdices Exploracion Gewurztraimer x750cc', cantidad: 8, costo: 17867.96 },
  { productoId: 'donjuan', nombre: 'Las Perdices Don Juan x1.5Lt', cantidad: 16, costo: 39308.97 },
];

describe('qué cambia entre lo registrado y la carga corregida', () => {
  it('solo lo distinto: el Malbec pasa de 18 a 12 y su costo sube; lo demás queda', () => {
    const d = diferenciasConLoRegistrado(registrados, [
      { productoId: 'malbec', nombre: 'Las Perdices Exploracion Malbec - Chacayes x750cc', cantidad: 12, costo: 20138.07, margenPct: 70 },
      { productoId: 'gewurz', nombre: 'x', cantidad: 8, costo: 17867.958 },
      { productoId: 'donjuan', nombre: 'x', cantidad: 16, costo: 39308.97 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ productoId: 'malbec', cantidad: 12, costo: 20138.07, margenPct: 70, antes: { cantidad: 18, costo: 13425.38 } });
    expect(d[0].detalle).toBe('Las Perdices Exploracion Malbec - Chacayes x750cc: 18 → 12 · $13.425,38 → $20.138,07');
  });

  it('lo que no está en la carga sale; lo nuevo se agrega', () => {
    const d = diferenciasConLoRegistrado(registrados, [
      { productoId: 'malbec', nombre: 'Malbec', cantidad: 18, costo: 13425.38 },
      { productoId: 'gewurz', nombre: 'Gewurz', cantidad: 8, costo: 17867.96 },
      { productoId: 'riesling', nombre: 'Las Perdices Exploracion Riesling 750cc', cantidad: 6, costo: 12600.98 },
    ]);
    expect(d.map((x) => x.detalle)).toEqual([
      'Sacar Las Perdices Don Juan x1.5Lt (16)',
      'Agregar Las Perdices Exploracion Riesling 750cc: 6 a $12.600,98',
    ]);
    expect(d.find((x) => x.productoNuevoId === 'riesling')).toMatchObject({ productoId: null, cantidad: 6 });
    expect(d.find((x) => x.productoId === 'donjuan')).toMatchObject({ cantidad: 0 });
  });

  it('el mismo producto en dos renglones se junta (como al registrar)', () => {
    const d = diferenciasConLoRegistrado([{ productoId: 'a', nombre: 'A', cantidad: 12, costo: 100 }], [
      { productoId: 'a', nombre: 'A', cantidad: 10, costo: 120 },
      { productoId: 'a', nombre: 'A', cantidad: 2, costo: 0 },
    ]);
    // 10 a $120 + 2 sin cargo = 12 a $100: igual a lo registrado
    expect(d).toEqual([]);
  });

  it('sin cambios, nada', () => {
    expect(diferenciasConLoRegistrado(registrados, registrados)).toEqual([]);
  });
});

describe('el pie de la factura', () => {
  it('cambia solo lo distinto, en las claves de editarFactura', () => {
    const r = diferenciasDeEncabezado(
      { monto: 3829427.38, neto: 3000000, iva: 630000, percepcion_iva: 0, percepcion_iibb: 199427.38, letra: 'A', fecha_emision: '2026-11-18' },
      { total: 3829427.38, neto: 3000000, iva: 630000, percepcionIibb: 190000, letra: 'A', fechaEmision: '2026-11-17' },
    );
    expect(r.cambios).toEqual({ percepcionIibb: 190000, fechaEmision: '2026-11-17' });
    expect(r.detalle).toEqual(['Percepción IIBB: $199.427,38 → $190.000,00', 'Fecha: 2026-11-18 → 2026-11-17']);
  });

  it('sin pie en la carga, no cambia nada', () => {
    expect(diferenciasDeEncabezado({ monto: 10 }, null)).toEqual({ cambios: {}, detalle: [] });
  });
});
