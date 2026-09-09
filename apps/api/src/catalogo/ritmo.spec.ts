import { recorrerConRitmo } from './ritmo';

describe('recorrerConRitmo', () => {
  it('procesa todo y respeta el orden de los resultados', async () => {
    const items = [1, 2, 3, 4, 5];
    const r = await recorrerConRitmo(items, { paralelo: 3, espaciadoMs: 0 }, async (n) => n * 10);
    expect(r.resultados).toEqual([10, 20, 30, 40, 50]);
    expect(r.motivoParada).toBeNull();
    expect(r.errores).toHaveLength(0);
  });

  it('no arranca más de una cada espaciadoMs (ese es el tope por minuto)', async () => {
    const arranques: number[] = [];
    const t0 = Date.now();
    await recorrerConRitmo([1, 2, 3, 4], { paralelo: 4, espaciadoMs: 40 }, async () => {
      arranques.push(Date.now() - t0);
    });
    expect(arranques).toHaveLength(4);
    // la cuarta no puede haber arrancado antes de 3 espaciados
    expect(arranques[3]).toBeGreaterThanOrEqual(3 * 40 - 10);
  });

  it('trabaja en paralelo: N lentas tardan menos que una atrás de otra', async () => {
    const t0 = Date.now();
    await recorrerConRitmo([1, 2, 3, 4, 5, 6], { paralelo: 6, espaciadoMs: 0 }, async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(Date.now() - t0).toBeLessThan(6 * 60);
  });

  it('un error suelto no corta el recorrido', async () => {
    const r = await recorrerConRitmo([1, 2, 3], { paralelo: 2, espaciadoMs: 0 }, async (n) => {
      if (n === 2) throw new Error('la imagen llegó vacía');
      return n;
    });
    expect(r.errores).toHaveLength(1);
    expect(r.motivoParada).toBeNull();
    expect(r.resultados[2]).toBe(3);
  });

  it('si la clave es rechazada, frena y no consulta el resto', async () => {
    const vistos: number[] = [];
    const r = await recorrerConRitmo(
      [1, 2, 3, 4, 5, 6, 7, 8],
      { paralelo: 2, espaciadoMs: 0 },
      async (n) => {
        vistos.push(n);
        if (n === 1) throw new Error('EZ Catalog rechazó la clave (401)');
        return n;
      },
      (e) => /clave|401|403|429/i.test(e instanceof Error ? e.message : String(e)),
    );
    expect(r.motivoParada).toMatch(/401/);
    expect(vistos.length).toBeLessThan(8);
  });

  it('con la lista vacía no hace nada', async () => {
    const r = await recorrerConRitmo([], { paralelo: 4, espaciadoMs: 10 }, async () => 1);
    expect(r.resultados).toEqual([]);
    expect(r.motivoParada).toBeNull();
  });
});
