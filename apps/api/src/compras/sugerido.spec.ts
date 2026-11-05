// El sugerido que se explica (4/11/2026): el número y su cuenta, en palabras.
import { explicarSugerido } from './sugerido';

const base = { stock: 0, porDia: 0, minimo: 0, reposicion: 0, enCamino: 0, unidadesPack: 1 };

describe('el sugerido del pedido a proveedor', () => {
  it('vende y queda poco: la cuenta completa', () => {
    const r = explicarSugerido({ ...base, stock: 3, porDia: 12 / 30 }, 14);
    expect(r.sugerido).toBe(3); // 14 días × 0,4 = 5,6 → 6; menos los 3 que hay
    expect(r.explicacion).toBe('Se venden unos 2,8 por semana y hay 3, que alcanzan para 7 días. Para cubrir 14 días hacen falta 6. Conviene pedir 3.');
  });

  it('lo que ya está pedido se descuenta', () => {
    const r = explicarSugerido({ ...base, stock: 0, porDia: 1, enCamino: 10 }, 14);
    expect(r.sugerido).toBe(4);
    expect(r.explicacion).toMatch(/Ya hay 10 en camino\. Conviene pedir 4\./);
    const cubierto = explicarSugerido({ ...base, stock: 0, porDia: 1, enCamino: 20 }, 14);
    expect(cubierto.sugerido).toBe(0);
    expect(cubierto.explicacion).toMatch(/Con lo que está en camino alcanza/);
  });

  it('con bulto, se pide en bultos enteros', () => {
    const r = explicarSugerido({ ...base, stock: 2, porDia: 1, unidadesPack: 6 }, 14);
    expect(r.sugeridoBultos).toBe(2);
    expect(r.sugerido).toBe(12);
    expect(r.explicacion).toMatch(/Conviene pedir 12 \(2 bultos de 6\)\./);
  });

  it('sin ventas y sin mínimo: no hay nada que pedir, y lo dice', () => {
    const r = explicarSugerido({ ...base, stock: 5 }, 14);
    expect(r.sugerido).toBe(0);
    expect(r.explicacion).toBe('No tuvo ventas en los últimos 30 días y hay 5. No hace falta pedir.');
  });

  it('el mínimo cargado manda cuando pide más que la venta', () => {
    const r = explicarSugerido({ ...base, stock: 1, porDia: 0.1, minimo: 5 }, 14);
    expect(r.sugerido).toBe(9); // mínimo × 2 = 10, menos 1
    expect(r.explicacion).toMatch(/El mínimo cargado pide tener 10\./);
  });
});
