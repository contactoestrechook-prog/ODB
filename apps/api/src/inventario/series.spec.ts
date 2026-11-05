// Las cuentas de la pantalla «Inventario» (5/11/2026), con los datos reales de
// Coca Cola lata 354cc (L341) al 5/11/2026.
import {
  diasDelPeriodo, escalones, margenSobreCosto, nivelEnElTiempo, nombreSucursal, origenDelCosto, queFue, ventasPorPeriodo,
  type MovimientoCrudo,
} from './series';

const ST = '229906e6-df69-48eb-b027-2b57fefb89fe';
const SI = 'f117af1b-538d-4889-bbc2-e004a4a29048';
const mov = (id: number, creado_en: string, tipo: string, cantidad: number, referencia_tipo: string, motivo: string | null = null, sucursal_id = ST): MovimientoCrudo =>
  ({ id, sucursal_id, tipo, cantidad, motivo, referencia_tipo, referencia_id: null, creado_en });

// los 11 movimientos de Saint Thomas, como están en movimientos_stock
const COCA_ST: MovimientoCrudo[] = [
  mov(897, '2026-08-11T14:23:00Z', 'ajuste', -93, 'importacion', 'Sincronización con sistema anterior (inventario 11-08)'),
  mov(7019, '2026-08-11T15:41:22Z', 'ajuste', 93, 'apertura', 'Apertura de inventario: conciliación inicial del ledger'),
  mov(11149, '2026-08-31T13:38:14Z', 'compra', 60, 'compra_directa'),
  mov(11192, '2026-09-14T20:23:59Z', 'compra', 90, 'compra_directa'),
  mov(16646, '2026-10-01T14:49:12Z', 'ajuste', -129, 'importacion', 'Sincronización con sistema anterior (st-0110)'),
  mov(22261, '2026-10-22T17:07:54Z', 'ajuste', 62, 'importacion', 'Sincronización con sistema anterior (export-2110)'),
  mov(23851, '2026-10-23T16:34:09Z', 'venta', -1, 'venta'),
  mov(26429, '2026-10-24T20:37:51Z', 'ajuste', -20, 'importacion', 'Sincronización con sistema anterior (export-2410)'),
  mov(27357, '2026-11-03T16:18:53Z', 'venta', -3, 'venta'),
  mov(31680, '2026-11-03T20:36:04Z', 'ajuste', 23, 'importacion', 'Sincronización con sistema anterior (export-0311)'),
  mov(32959, '2026-11-05T15:55:48Z', 'venta', -1, 'venta'),
];

describe('el stock de una sucursal en el tiempo', () => {
  it('Coca lata en Saint Thomas: de 93 a 0 el 11/8 y de ahí hasta las 81 de hoy; la apertura no mueve nada', () => {
    const { inicial, pasos } = nivelEnElTiempo(COCA_ST, 81);
    expect(inicial).toBe(93);
    expect(pasos.map((p) => p.saldo)).toEqual([0, 0, 60, 150, 21, 83, 82, 62, 59, 82, 81]);
    expect(pasos[1]).toMatchObject({ que: 'Apertura del inventario', cambio: 0, saldo: 0 });
    expect(pasos[4]).toMatchObject({ que: 'Sincronización con el sistema viejo', cambio: -129, saldo: 21 });
  });
  it('Santa Inés: solo la apertura, siempre hubo 12', () => {
    const { inicial, pasos } = nivelEnElTiempo([mov(4107, '2026-08-11T15:41:22Z', 'ajuste', 12, 'apertura', null, SI)], 12);
    expect(inicial).toBe(12);
    expect(pasos).toHaveLength(1);
    expect(pasos[0].saldo).toBe(12);
  });
  it('sin movimientos, lo que hay es lo que hubo; y no importa en qué orden lleguen', () => {
    expect(nivelEnElTiempo([], 7)).toEqual({ inicial: 7, pasos: [] });
    const alReves = nivelEnElTiempo([...COCA_ST].reverse(), 81);
    expect(alReves.pasos.map((p) => p.id)).toEqual(COCA_ST.map((m) => m.id));
    expect(alReves.inicial).toBe(93);
  });
  it('lo que se vende por peso no arrastra decimales de más', () => {
    const { inicial, pasos } = nivelEnElTiempo([mov(1, '2026-10-01T12:00:00Z', 'venta', -0.1, 'venta'), mov(2, '2026-10-02T12:00:00Z', 'venta', -0.2, 'venta')], 5.25);
    expect(pasos.map((p) => p.saldo)).toEqual([5.45, 5.25]);
    expect(inicial).toBe(5.55);
  });
});

describe('qué fue cada movimiento, en palabras', () => {
  it('nombra lo que hoy hay en la base', () => {
    expect(queFue({ tipo: 'ajuste', referencia_tipo: 'importacion', motivo: 'Alta desde el sistema anterior (export-0311)' })).toBe('Alta desde el sistema viejo');
    expect(queFue({ tipo: 'ajuste', referencia_tipo: 'venta_prueba', motivo: 'Modo prueba de caja: faltante detectado' })).toBe('Faltante detectado en la caja');
    expect(queFue({ tipo: 'ajuste', referencia_tipo: 'baja_catalogo', motivo: null })).toBe('Baja de catálogo');
    expect(queFue({ tipo: 'ajuste', referencia_tipo: null, motivo: 'se rompió una' })).toBe('Ajuste');
    expect(queFue({ tipo: 'reserva', referencia_tipo: 'pedido', motivo: null })).toBe('Reservado para un pedido');
    expect(queFue({ tipo: 'liberacion_reserva', referencia_tipo: 'pedido', motivo: null })).toBe('Se liberó la reserva de un pedido');
    expect(queFue({ tipo: 'devolucion', referencia_tipo: 'venta_anulada', motivo: null })).toBe('Devolución de una venta');
    expect(queFue({ tipo: 'algo_nuevo', referencia_tipo: null, motivo: null })).toBe('Algo nuevo');
  });
  it('las sucursales, como las nombra el resto del panel', () => {
    expect(nombreSucursal('Suc Sant Thomas')).toBe('Saint Thomas');
    expect(nombreSucursal('Suc Santa Ines')).toBe('Santa Inés');
    expect(nombreSucursal('Sucursal Centro')).toBe('Centro');
    expect(nombreSucursal(null)).toBe('');
  });
});

describe('cuánto se vende por período', () => {
  const PERIODOS = [
    { desde: '2026-08-22', hasta: '2026-09-20' },
    { desde: '2026-09-21', hasta: '2026-10-20' },
    { desde: '2026-10-21', hasta: '2026-10-23' },
  ];
  it('Coca lata: 216 en 30 días, 294 en 30 días y 21 en 3 días se comparan por día', () => {
    const v = ventasPorPeriodo(PERIODOS, [
      { desde: '2026-09-21', hasta: '2026-10-20', unidades: '294.000' },
      { desde: '2026-08-22', hasta: '2026-09-20', unidades: '216.000' },
      { desde: '2026-10-21', hasta: '2026-10-23', unidades: '21.000' },
    ]);
    expect(v.map((p) => [p.dias, p.unidades, p.porDia])).toEqual([[30, 216, 7.2], [30, 294, 9.8], [3, 21, 7]]);
  });
  it('el período sin renglón es un período sin ventas, no un hueco', () => {
    const v = ventasPorPeriodo(PERIODOS, [{ desde: '2026-09-21', hasta: '2026-10-20', unidades: 12 }]);
    expect(v.map((p) => p.unidades)).toEqual([0, 12, 0]);
  });
  it('dos renglones del mismo período se suman y uno de un período que no estaba en la lista no se pierde', () => {
    const v = ventasPorPeriodo(PERIODOS.slice(0, 1), [
      { desde: '2026-08-22', hasta: '2026-09-20', unidades: 5 },
      { desde: '2026-08-22', hasta: '2026-09-20', unidades: 2.5 },
      { desde: '2026-07-01', hasta: '2026-07-21', unidades: 29 },
    ]);
    expect(v).toEqual([
      { desde: '2026-07-01', hasta: '2026-07-21', dias: 21, unidades: 29, porDia: 1.38 },
      { desde: '2026-08-22', hasta: '2026-09-20', dias: 30, unidades: 7.5, porDia: 0.25 },
    ]);
    expect(diasDelPeriodo({ desde: '2026-02-01', hasta: '2026-02-28' })).toBe(28);
  });
});

describe('a cuánto se compra y a cuánto se vende', () => {
  it('los precios de Coca lata son escalones, en orden y sin repetir', () => {
    const e = escalones([
      { en: '2026-09-14T20:23:59Z', valor: '2300.00' },
      { en: '2026-08-11T14:22:43Z', valor: '2300.00' },
      { en: '2026-08-31T13:38:14Z', valor: '2500.00' },
      { en: '2026-09-16T21:24:36Z', valor: '2500.00' },
      { en: '2026-10-24T20:32:25Z', valor: '1900.00' },
      { en: '2026-10-25T10:00:00Z', valor: '1900.00' },
      { en: '2026-10-26T10:00:00Z', valor: 0 },
    ]);
    expect(e.map((p) => p.valor)).toEqual([2300, 2500, 2300, 2500, 1900]);
    expect(e[0].en).toBe('2026-08-11T14:22:43Z');
  });
  it('el margen es sobre el costo, como en la ficha del producto', () => {
    expect(margenSobreCosto(1900, 1169.52)).toBe(62);
    expect(margenSobreCosto(1900, 0)).toBeNull();
    expect(margenSobreCosto(null, 1169.52)).toBeNull();
  });
  it('el origen de un costo se dice en palabras', () => {
    expect(origenDelCosto('export-2410')).toBe('sistema viejo');
    expect(origenDelCosto('lista_pdf')).toBe('comprobante cargado');
    expect(origenDelCosto('lista_archivo')).toBe('lista del proveedor');
    expect(origenDelCosto(null)).toBe('cargado a mano');
  });
});
