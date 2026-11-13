import { armarEntrada, motivoParaRevisar, tramoDe, type FilaMotor } from './entrada';

const ST = { id: 'st', nombre: 'Saint Thomas' };
const SI = { id: 'si', nombre: 'Santa Inés' };

const fila = (producto: string, sucursal: string, stock: number, ritmo: number, extra: Partial<FilaMotor> = {}): FilaMotor => ({
  producto_id: producto, sku: `L${producto}`, nombre: `Producto ${producto}`, categoria: 'Varios', sucursal_id: sucursal,
  stock, en_camino: 0, ritmo_dia: ritmo, cobertura_dias: ritmo > 0 ? stock / ritmo : null, alerta: null, ultimo_costo: 100, ...extra,
});

describe('tramoDe', () => {
  it('lo que se vende va por cuánto alcanza', () => {
    expect(tramoDe(0, 2, 0)).toBe('sin_stock');
    expect(tramoDe(10, 2, 5)).toBe('semana');
    expect(tramoDe(40, 2, 20)).toBe('mes');
    expect(tramoDe(200, 2, 100)).toBe('meses');
    expect(tramoDe(1000, 2, 500)).toBe('de_mas');
  });
  it('lo que no se vende: con stock es plata parada; sin stock no se mira', () => {
    expect(tramoDe(5, 0, null)).toBe('sin_ventas');
    expect(tramoDe(0, 0, null)).toBeNull();
  });
  it('sin cobertura del motor la cuenta es stock sobre ritmo', () => {
    expect(tramoDe(14, 2, null)).toBe('semana');
  });
});

describe('motivoParaRevisar', () => {
  it('marca negativos y decimales en productos por unidad', () => {
    expect(motivoParaRevisar(-3, false)).toBe('Stock negativo: -3');
    expect(motivoParaRevisar(1979.942, false)).toBe('Tiene 1.979,942 y se vende por unidad');
    expect(motivoParaRevisar(855.712, true)).toBeNull();
    expect(motivoParaRevisar(12, false)).toBeNull();
  });
});

describe('armarEntrada', () => {
  const filas = [
    fila('1', 'st', 588, 43.5), fila('1', 'si', 107, 6.4), // se vende mucho, alcanza dos semanas
    fila('2', 'st', 0, 5), fila('2', 'si', 16, 1), // no hay en Saint Thomas
    fila('3', 'st', 300, 0, { ultimo_costo: 1000 }), // no se vende: 300.000 parados
    fila('4', 'st', 1979.942, 15), // se vende por unidad y tiene decimales
    fila('5', 'si', 0, 0), // no hay y no se vende: no cuenta
  ];
  const base = { filas, sucursales: [ST, SI], porPeso: new Set<string>(), costos: new Map<string, number>(), conPlata: true };

  it('cuenta por tramo en cada sucursal y deja afuera lo que no hay ni se vende', () => {
    const e = armarEntrada({ ...base, sucursal: null });
    const st = e.alcance.find((a) => a.sucursalId === 'st')!;
    const si = e.alcance.find((a) => a.sucursalId === 'si')!;
    expect(st.tramos.sin_stock.n).toBe(1);
    expect(st.tramos.sin_ventas).toEqual({ n: 1, valor: 300_000 });
    expect(st.total).toBe(4);
    expect(si.total).toBe(2);
    expect(e.foto.conStock).toBe(4);
  });

  it('las listas van con lo más importante arriba', () => {
    const e = armarEntrada({ ...base, sucursal: null });
    expect(e.vistas.se_vende.filas.map((f) => f.sku)).toEqual(['L1', 'L4', 'L2']);
    expect(e.vistas.sin_stock.filas.map((f) => f.sku)).toEqual(['L2']);
    expect(e.vistas.sin_ventas).toMatchObject({ total: 1, valor: 300_000 });
    expect(e.vistas.revisar.filas[0]).toMatchObject({ sku: 'L4', motivo: 'Tiene 1.979,942 y se vende por unidad' });
  });

  it('mirando una sucursal, la fila igual trae la otra (para ver si allá hay)', () => {
    const e = armarEntrada({ ...base, sucursal: 'st' });
    const l2 = e.vistas.sin_stock.filas[0];
    expect(l2.sucursales.map((s) => [s.id, s.stock])).toEqual([['st', 0], ['si', 16]]);
    expect(l2.ritmo).toBe(5);
    expect(e.vistas.se_vende.total).toBe(3);
  });

  it('la caja no ve plata', () => {
    const e = armarEntrada({ ...base, sucursal: null, conPlata: false });
    expect(e.foto.valor).toBeNull();
    expect(e.vistas.sin_ventas.valor).toBeNull();
    expect(e.vistas.sin_ventas.filas[0].valor).toBeNull();
    expect(e.alcance[0].tramos.sin_ventas.valor).toBeNull();
  });

  it('«ver más» trae solo esa lista desde el renglón pedido', () => {
    const e = armarEntrada({ ...base, sucursal: null, soloVista: 'se_vende', desde: 1, porVista: 1 });
    expect(e.vistas.se_vende.filas.map((f) => f.sku)).toEqual(['L4']);
    expect(e.vistas.sin_stock.filas).toEqual([]);
    expect(e.vistas.sin_stock.total).toBe(1);
  });

  it('una sucursal que no existe es lo mismo que mirar todas', () => {
    expect(armarEntrada({ ...base, sucursal: 'otra' }).sucursal).toBeNull();
  });
});
