import { resumirLugares, tieneLugar } from './lugares';

const ST = 'sant-thomas';
const SI = 'santa-ines';

describe('lugares del salón', () => {
  const filas = [
    { sucursal_id: ST, cantidad: 12, ubicacion: 'Góndola 3', categoria_id: 'malbec' },
    { sucursal_id: ST, cantidad: '4', ubicacion: null, categoria_id: 'malbec' },
    { sucursal_id: ST, cantidad: 2, ubicacion: '  ', categoria_id: 'malbec' },
    { sucursal_id: ST, cantidad: 1, ubicacion: null, categoria_id: 'quesos' },
    { sucursal_id: ST, cantidad: 0, ubicacion: 'Frío 1', categoria_id: 'quesos' }, // sin stock: no cuenta, pero el lugar sí se ofrece
    { sucursal_id: ST, cantidad: 3, ubicacion: 'Góndola 10', categoria_id: null },
    { sucursal_id: SI, cantidad: 5, ubicacion: 'Estante A', categoria_id: 'malbec' },
  ];

  it('cuenta por sucursal solo lo que tiene stock', () => {
    const r = resumirLugares(filas, ST);
    expect(r.sucursales).toEqual([
      { sucursalId: ST, conStock: 5, conLugar: 2 },
      { sucursalId: SI, conStock: 1, conLugar: 1 },
    ]);
  });

  it('las categorías de la sucursal pedida, las que más faltan primero', () => {
    const r = resumirLugares(filas, ST);
    expect(r.categorias).toEqual([
      { categoriaId: 'malbec', conStock: 3, sinLugar: 2 },
      { categoriaId: 'quesos', conStock: 1, sinLugar: 1 },
      { categoriaId: null, conStock: 1, sinLugar: 0 },
    ]);
  });

  it('ofrece los lugares ya usados en esa sucursal, en orden natural', () => {
    expect(resumirLugares(filas, ST).lugaresUsados).toEqual(['Frío 1', 'Góndola 3', 'Góndola 10']);
    expect(resumirLugares(filas, SI).lugaresUsados).toEqual(['Estante A']);
  });

  it('un lugar en blanco no es un lugar', () => {
    expect(tieneLugar('  ')).toBe(false);
    expect(tieneLugar(null)).toBe(false);
    expect(tieneLugar('G3')).toBe(true);
  });
});
