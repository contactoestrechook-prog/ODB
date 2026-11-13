import { conRelevo, relevoMs } from './relevo-ia';

/** Un pedido falso: termina (o falla) a los `ms` y anota si lo cancelaron. */
function falso(ms: number, resultado: { valor?: string; error?: string }, registro: string[], nombre: string) {
  return (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => (resultado.error ? reject(new Error(resultado.error)) : resolve(resultado.valor!)), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        registro.push(`cancelado ${nombre}`);
        reject(new Error('cancelado'));
      });
    });
}

describe('conRelevo', () => {
  it('si el primero contesta a tiempo, no sale un segundo pedido', async () => {
    let pedidos = 0;
    const r = await conRelevo(async () => { pedidos++; return 'ok'; }, { relevoMs: 50 });
    expect(r).toEqual({ valor: 'ok', relevo: false, gano: 1 });
    await new Promise((x) => setTimeout(x, 80));
    expect(pedidos).toBe(1);
  });

  it('si el primero se traba, el segundo lo releva y el primero se cancela', async () => {
    const registro: string[] = [];
    const pedidos = [falso(1000, { valor: 'trabado' }, registro, '1'), falso(10, { valor: 'relevo' }, registro, '2')];
    let n = 0;
    let avisos = 0;
    const r = await conRelevo((s) => pedidos[n++](s), { relevoMs: 30, alRelevar: () => avisos++ });
    expect(r).toEqual({ valor: 'relevo', relevo: true, gano: 2 });
    expect(avisos).toBe(1);
    expect(registro).toEqual(['cancelado 1']);
  });

  it('si el primero termina después del relevo pero antes que el segundo, gana el primero', async () => {
    const registro: string[] = [];
    const pedidos = [falso(50, { valor: 'primero' }, registro, '1'), falso(1000, { valor: 'segundo' }, registro, '2')];
    let n = 0;
    const r = await conRelevo((s) => pedidos[n++](s), { relevoMs: 20 });
    expect(r).toEqual({ valor: 'primero', relevo: true, gano: 1 });
    expect(registro).toEqual(['cancelado 2']);
  });

  it('un error antes del relevo se informa enseguida y no sale el segundo', async () => {
    let pedidos = 0;
    await expect(conRelevo(async () => { pedidos++; throw new Error('529 overloaded'); }, { relevoMs: 50 })).rejects.toThrow('529 overloaded');
    await new Promise((x) => setTimeout(x, 80));
    expect(pedidos).toBe(1);
  });

  it('si el segundo falla, se espera al primero', async () => {
    const registro: string[] = [];
    const pedidos = [falso(60, { valor: 'lento pero bien' }, registro, '1'), falso(5, { error: 'se cortó' }, registro, '2')];
    let n = 0;
    const r = await conRelevo((s) => pedidos[n++](s), { relevoMs: 20 });
    expect(r).toEqual({ valor: 'lento pero bien', relevo: true, gano: 1 });
  });

  it('si fallan los dos, se informa el primer error', async () => {
    const registro: string[] = [];
    const pedidos = [falso(40, { error: 'primero' }, registro, '1'), falso(40, { error: 'segundo' }, registro, '2')];
    let n = 0;
    await expect(conRelevo((s) => pedidos[n++](s), { relevoMs: 20 })).rejects.toThrow('primero');
  });

  it('un pedido que tira al arrancar cuenta como error', async () => {
    await expect(conRelevo(() => { throw new Error('sin clave'); }, { relevoMs: 50 })).rejects.toThrow('sin clave');
  });
});

describe('relevoMs', () => {
  const antes = process.env.PRUEBA_RELEVO;
  afterEach(() => { if (antes === undefined) delete process.env.PRUEBA_RELEVO; else process.env.PRUEBA_RELEVO = antes; });
  it('usa la variable en segundos o el valor de siempre', () => {
    delete process.env.PRUEBA_RELEVO;
    expect(relevoMs('PRUEBA_RELEVO', 30)).toBe(30_000);
    process.env.PRUEBA_RELEVO = '45';
    expect(relevoMs('PRUEBA_RELEVO', 30)).toBe(45_000);
    process.env.PRUEBA_RELEVO = 'cualquiera';
    expect(relevoMs('PRUEBA_RELEVO', 30)).toBe(30_000);
  });
});
