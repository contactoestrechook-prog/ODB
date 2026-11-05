import { medirPedido, tiemposPorPreparador } from './tiempos';

const t = (min: number, seg = 0) => new Date(Date.UTC(2026, 10, 5, 15, min, seg)).toISOString();

describe('medición del armado', () => {
  it('mide arranque, total y ritmo de un pedido', () => {
    const m = medirPedido({
      asignado_a: 'a', asignado_en: t(0), armado_terminado_en: t(6),
      carro: [{ creado_en: t(1), cantidad: 1 }, { creado_en: t(2), cantidad: 2 }, { creado_en: t(3), cantidad: 1 }],
    });
    expect(m.total).toBe(6);
    expect(m.arranque).toBe(1);
    expect(m.segPorProducto).toBe(60);
    expect(m.cargas).toBe(3);
  });

  it('con una sola carga no hay ritmo, y sin terminar no hay total', () => {
    const m = medirPedido({ asignado_a: 'a', asignado_en: t(0), armado_terminado_en: null, carro: [{ creado_en: t(2), cantidad: 1 }] });
    expect(m.total).toBeNull();
    expect(m.segPorProducto).toBeNull();
    expect(m.arranque).toBe(2);
  });

  it('agrupa por preparador, solo terminados, el más rápido primero', () => {
    const r = tiemposPorPreparador([
      { asignado_a: 'lento', asignado_en: t(0), armado_terminado_en: t(20), carro: [] },
      { asignado_a: 'rapido', asignado_en: t(0), armado_terminado_en: t(4), carro: [] },
      { asignado_a: 'rapido', asignado_en: t(0), armado_terminado_en: t(6), carro: [] },
      { asignado_a: 'rapido', asignado_en: t(0), armado_terminado_en: null, carro: [] },
    ]);
    expect(r.map((x) => x.usuarioId)).toEqual(['rapido', 'lento']);
    expect(r[0].pedidos).toBe(2);
    expect(r[0].minTotal).toBe(5);
  });
});

import { sirveEnSucursal } from './salon.service';

describe('a quién se le asigna según la sucursal', () => {
  it('el op salón solo en la suya; depósito sin sucursal en todas', () => {
    expect(sirveEnSucursal({ rol: 'op_salon', sucursal_id: 'st' }, 'st')).toBe(true);
    expect(sirveEnSucursal({ rol: 'op_salon', sucursal_id: 'st' }, 'si')).toBe(false);
    expect(sirveEnSucursal({ rol: 'op_salon', sucursal_id: null }, 'si')).toBe(false);
    expect(sirveEnSucursal({ rol: 'deposito', sucursal_id: null }, 'si')).toBe(true);
    expect(sirveEnSucursal({ rol: 'deposito', sucursal_id: 'st' }, 'si')).toBe(false);
  });
});
