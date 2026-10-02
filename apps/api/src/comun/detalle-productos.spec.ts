import { productosEnResultado, renglonesDeProductos, separarDetalle, textoSinRenglones } from './detalle-productos';

const filas = [
  { sku: 'CAB500', producto: 'Cafe Cabrales Brasil Tostado Molido x 500g', sucursal: 'Saint Thomas', stock: 3, sugerido: 12 },
  { sku: 'CAB250', producto: 'Cafe Cabrales Brasil Tostado Molido x250grs', sucursal: 'Saint Thomas', stock: 0, sugerido: 24 },
  { sku: 'CABCOL', producto: 'Cafe Cabrales Colombia Tostado Molido x 250g', sucursal: 'Saint Thomas', stock: 8, sugerido: 0 },
  { sku: 'VIR500', producto: 'Cafe La Virginia Clasico x 500g', sucursal: 'Saint Thomas', stock: 5, sugerido: 6 },
];
const vistos = productosEnResultado({ renglones: filas });

describe('detalle de productos (Placa roja en el panel)', () => {
  it('junta los productos de cualquier resultado de herramienta', () => {
    expect(vistos.map((v) => v.sku)).toEqual(['CAB500', 'CAB250', 'CABCOL', 'VIR500']);
    expect(productosEnResultado({ a: { b: [{ sku: 'X1', nombre: 'Algo' }] }, total: 3 })).toHaveLength(1);
    expect(productosEnResultado({ sku: 'X1' })).toHaveLength(0); // sin nombre no es un producto
  });

  it('reconoce cada renglón de la lista con el producto correcto, aunque esté abreviado', () => {
    const respuesta = [
      'De Cabrales en Saint Thomas:',
      '- Cabrales Brasil 500g: quedan 3, pedí 12',
      '- Cabrales Brasil 250: sin stock, pedí 24',
      '- Cabrales Colombia 250g: alcanza, no hace falta',
      'El resto está bien.',
    ].join('\n');
    const r = renglonesDeProductos(respuesta, vistos);
    expect(r.map((x) => [x.indice, x.producto.sku])).toEqual([[1, 'CAB500'], [2, 'CAB250'], [3, 'CABCOL']]);
  });

  it('no confunde: una sola palabra en común no alcanza', () => {
    expect(renglonesDeProductos('- Cafe molido, cualquiera', vistos)).toHaveLength(0);
    expect(renglonesDeProductos('Cabrales Brasil 500g sin viñeta', vistos)).toHaveLength(0);
  });

  it('separarDetalle: con 2 productos o más saca los renglones del texto y arma la placa', () => {
    const respuesta = 'Mirá:\n- Cabrales Brasil 500g: quedan 3\n- La Virginia Clasico 500g: quedan 5\nPedí los dos.';
    const { respuesta: texto, detalle } = separarDetalle(respuesta, vistos, (ps) => ({
      titulo: 'PRODUCTOS',
      renglones: ps.map((p) => ({ clave: p.sku, nombre: p.nombre, cantidad: Number(p.fila.sugerido) })),
    }));
    expect(texto).toBe('Mirá:\nPedí los dos.');
    expect(detalle?.renglones.map((r) => r.clave)).toEqual(['CAB500', 'VIR500']);
  });

  it('con un solo producto queda como texto', () => {
    const respuesta = '- Cabrales Brasil 500g: quedan 3';
    expect(separarDetalle(respuesta, vistos, () => ({ titulo: 'X', renglones: [] })).detalle).toBeNull();
  });

  it('textoSinRenglones no deja huecos de más', () => {
    expect(textoSinRenglones('a\n\nb\n\nc', [2])).toBe('a\n\nc');
  });
});

describe('detalle de productos: costeos y placas de cada agente', () => {
  it('un renglón costeado de planilla (sin sku) también cuenta', () => {
    const v = productosEnResultado({ costos: [
      { descripcion: 'Malbec Reserva caja x6', costoUnitarioReal: 9123.4, costoUnitarioContado: 9500, unidadesRecibidas: 6 },
      { descripcion: 'Cabernet Reserva caja x6', costoUnitarioReal: 8800, costoUnitarioContado: 8800, unidadesRecibidas: 6 },
    ] });
    expect(v.map((x) => x.sku)).toEqual(['oferta:Malbec Reserva caja x6', 'oferta:Cabernet Reserva caja x6']);
    const r = renglonesDeProductos('Quedaron así:\n- Malbec Reserva caja x6: $9.123\n- Cabernet Reserva: $8.800', v);
    expect(r.map((x) => x.indice)).toEqual([1, 2]);
  });

  it('placaDeAbastecimiento: sugerido en el círculo, stock por sucursal, alerta en rojo y costo', () => {
    const { placaDeAbastecimiento } = require('../abastecimiento/abastecimiento.service');
    const todos = productosEnResultado({ renglones: [
      { sku: 'A1', producto: 'Cafe Cabrales Brasil x 500g', sucursal: 'Saint Thomas', stock: 3, ritmo_dia: 1.4, alerta: 'Sin stock pronto', sugerido: 12, costo: 4321 },
      { sku: 'A1', producto: 'Cafe Cabrales Brasil x 500g', sucursal: 'Santa Inés', stock: 0, ritmo_dia: 0.5, alerta: 'Sin stock', sugerido: 6, costo: 4321 },
    ] });
    const placa = placaDeAbastecimiento([todos[0]], todos);
    expect(placa.renglones[0]).toMatchObject({ clave: 'A1', cantidad: 18, importe: '$4.321' });
    expect(placa.renglones[0].detalle).toContain('Saint Thomas: 3 en stock');
    expect(placa.renglones[0].destacado).toContain('Sin stock en Santa Inés');
  });

  it('placaDeCostos: costo real a la derecha y unidades en el círculo', () => {
    const { placaDeCostos } = require('../compras/mesa-compras.service');
    const v = productosEnResultado({ descripcion: 'Malbec Reserva caja x6', costoUnitarioReal: 9123.4, costoUnitarioContado: 9500, unidadesRecibidas: 6, fletePorUnidad: 0 });
    const placa = placaDeCostos(v);
    expect(placa.titulo).toBe('COSTOS');
    expect(placa.renglones[0]).toMatchObject({ cantidad: 6, importe: '$9.123', detalle: 'contado $9.500' });
  });
});
