import { enLotes, traerTodo } from './lotes';

describe('enLotes', () => {
  it('parte la lista y junta todo', async () => {
    const vistos: string[][] = [];
    const r = await enLotes(['a', 'b', 'c', 'd', 'e'], async (lote) => { vistos.push(lote); return { data: lote.map((x) => ({ id: x })), error: null }; }, 2);
    expect(vistos).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(r).toHaveLength(5);
  });
  it('un error no se convierte en lista vacía', async () => {
    await expect(enLotes(['a'], async () => ({ data: null, error: { message: 'se cayó' } }))).rejects.toThrow('se cayó');
  });
});

describe('traerTodo', () => {
  // PostgREST corta en 1.000 filas sin avisar: el ayudante tiene que seguir
  // pidiendo hasta que una página venga corta.
  const tabla = Array.from({ length: 2350 }, (_, i) => ({ id: i }));

  it('junta las 2.350 filas aunque cada pedido devuelva 1.000', async () => {
    const pedidos: [number, number][] = [];
    const r = await traerTodo<{ id: number }>(async (desde, hasta) => {
      pedidos.push([desde, hasta]);
      return { data: tabla.slice(desde, Math.min(hasta + 1, desde + 1000)), error: null };
    });
    expect(r).toHaveLength(2350);
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('para cuando la página viene corta, sin pedir de más', async () => {
    let vueltas = 0;
    const r = await traerTodo<{ id: number }>(async () => { vueltas++; return { data: [{ id: 1 }], error: null }; });
    expect(vueltas).toBe(1);
    expect(r).toHaveLength(1);
  });

  it('con la tabla vacía devuelve vacío en un solo pedido', async () => {
    let vueltas = 0;
    const r = await traerTodo<{ id: number }>(async () => { vueltas++; return { data: [], error: null }; });
    expect(vueltas).toBe(1);
    expect(r).toEqual([]);
  });

  it('un error no se convierte en lista vacía', async () => {
    await expect(traerTodo(async () => ({ data: null, error: { message: 'se cayó' } }))).rejects.toThrow('se cayó');
  });
});
