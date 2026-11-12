import { frenoDeTraspasos, frescuraDeLocal } from './frescura';
import { claveNecesidad, contextoDeNecesidad, parteDeNecesidad, resumenDeNecesidad, sinTraspasos } from './necesidad';

// DE CUÁNDO ES EL DATO (11/11/2026): el stock de Santa Inés en NÚCLEO era el de
// la apertura del 11/8 y la pantalla le sugería a Saint Thomas traer 201
// productos «que le sobran». Con una foto vieja no se sugiere pasar mercadería.

const HOY = new Date(2026, 10, 11, 10, 0, 0); // 11/11/2026

describe('de cuándo es el stock de un local', () => {
  it('sincronizado ayer: está al día', () => {
    const f = frescuraDeLocal({ sucursalId: 'st', sucursal: 'Saint Thomas', stockAl: '2026-11-10T15:31:20+00:00', ventasHasta: '2026-11-09' }, HOY);
    expect(f).toMatchObject({ stockAl: '2026-11-10', ventasHasta: '2026-11-09', diasStock: 1, alDia: true, motivo: null });
  });

  it('la apertura de hace tres meses: no está al día, y dice desde cuándo', () => {
    const f = frescuraDeLocal({ sucursalId: 'si', sucursal: 'Santa Inés', stockAl: '2026-08-11T12:00:00+00:00', ventasHasta: '2026-07-21' }, HOY);
    expect(f.alDia).toBe(false);
    expect(f.diasStock).toBe(92);
    expect(f.motivo).toBe('El stock de Santa Inés no se actualiza desde el 11/8/2026 y sus ventas llegan hasta el 21/7/2026: con esos datos no se sabe qué le falta ni qué le sobra.');
  });

  it('a los 7 días todavía sirve; a los 8, no', () => {
    expect(frescuraDeLocal({ sucursalId: 'st', sucursal: 'Saint Thomas', stockAl: '2026-11-04' }, HOY).alDia).toBe(true);
    expect(frescuraDeLocal({ sucursalId: 'st', sucursal: 'Saint Thomas', stockAl: '2026-11-03' }, HOY).alDia).toBe(false);
  });

  it('si el local vende con la caja de NÚCLEO el stock baja solo: está al día aunque no se sincronice', () => {
    expect(frescuraDeLocal({ sucursalId: 'si', sucursal: 'Santa Inés', stockAl: '2026-08-11', enVivo: true }, HOY)).toMatchObject({ alDia: true, motivo: null });
  });

  it('sin ninguna carga: lo dice', () => {
    expect(frescuraDeLocal({ sucursalId: 'x', sucursal: 'Local nuevo' }, HOY).motivo).toBe('El stock de Local nuevo nunca se cargó y no tiene ventas cargadas: con esos datos no se sabe qué le falta ni qué le sobra.');
  });
});

describe('cuándo se sugieren traspasos', () => {
  const st = frescuraDeLocal({ sucursalId: 'st', sucursal: 'Saint Thomas', stockAl: '2026-11-10', ventasHasta: '2026-11-09' }, HOY);
  const si = frescuraDeLocal({ sucursalId: 'si', sucursal: 'Santa Inés', stockAl: '2026-08-11', ventasHasta: '2026-07-21' }, HOY);

  it('con los dos locales al día, sí', () => {
    expect(frenoDeTraspasos([st, { ...si, alDia: true, motivo: null }])).toBeNull();
  });

  it('con un local viejo, no: y dice por qué', () => {
    expect(frenoDeTraspasos([st, si])).toBe(si.motivo);
  });

  it('si no se pudo leer la fecha del stock, tampoco', () => {
    expect(frenoDeTraspasos([])).toMatch(/No pude confirmar/);
  });

  it('el contexto queda igual, solo que sin el traspaso; y el parte dice de cuándo es el dato en vez de contar', () => {
    const falta = { producto_id: 'p1', sku: 'S1', nombre: 'Schneider x473cc', categoria: 'Cervezas', sucursal_id: 'st', sucursal: 'Suc Sant Thomas', stock: 0, en_camino: 0, ritmo_dia: 1, alerta: 'sin_stock', ultimo_costo: 900, proveedor_id: 'pv', proveedor: 'Quilmes' };
    const alla = { ...falta, sucursal_id: 'si', sucursal: 'Suc Santa Ines', stock: 127, ritmo_dia: 2, alerta: null };
    const faltaAlla = { ...falta, producto_id: 'p2', sku: 'S2', nombre: 'Hielo Bolsa 5KG', categoria: 'Varios', sucursal_id: 'si', sucursal: 'Suc Santa Ines' };
    const filas = [falta, alla, faltaAlla];
    const contexto = contextoDeNecesidad(filas);
    expect(contexto.get(claveNecesidad('p1', 'st'))?.traspaso).toMatchObject({ desde: 'Santa Inés', cantidad: 14 });

    const limpio = sinTraspasos(contexto);
    expect(limpio.get(claveNecesidad('p1', 'st'))).toMatchObject({ nivel: 'hueco', traspaso: null });
    expect(sinTraspasos(contexto)).toBe(limpio); // se calcula una sola vez
    expect(contexto.get(claveNecesidad('p1', 'st'))?.traspaso).not.toBeNull(); // el original no se toca

    const r = resumenDeNecesidad(filas, limpio);
    expect(r.traspasos).toEqual([]);
    expect(r.porSucursal['Saint Thomas'].traspasables).toBe(0);

    const parte = parteDeNecesidad(r, [si]);
    expect(parte.titulo).toBe('Compras: 1 hueco en góndola y 0 productos principales en falta'); // solo cuenta Saint Thomas
    expect(parte.lineas).toContain(`${si.motivo} Sus números no entran en este parte.`);
    expect(parte.lineas.some((l) => l.startsWith('Santa Inés:'))).toBe(false);
    expect(parte.lineas.some((l) => l.startsWith('Antes de comprar'))).toBe(false);
  });
});
