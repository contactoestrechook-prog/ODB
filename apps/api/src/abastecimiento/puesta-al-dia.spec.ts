import { planDePuestaAlDia, type BasePuestaAlDia, type EntradaPuestaAlDia } from './puesta-al-dia';

// PONER AL DÍA (11/11/2026): la misma regla de la carga del Crack del 10/11
// (scripts/sistema-viejo/simular-csv.py). Con los archivos de ese día el lector
// y esta regla dan las mismas 28.957 unidades vendidas en 3.157 productos.

const AHORA = new Date('2026-11-11T15:00:00-03:00');
const prod = (n: number, x: any = {}) => ({ id: `p${n}`, sku: `L${n}`, nombre: `Producto ${n}`, codigo_legacy: String(n), activo: true, ...x });
const base = (x: Partial<BasePuestaAlDia> = {}): BasePuestaAlDia => ({
  productos: [prod(1), prod(2), prod(3)],
  stock: new Map([['p1', 10], ['p2', 5], ['p3', 0]]),
  movimientos: [],
  ultimaSincronizacion: '2026-11-10T15:31:20+00:00', // 10/11 12:31 de acá
  ventasHasta: '2026-11-09',
  ...x,
});
const entrada = (x: Partial<EntradaPuestaAlDia> = {}): EntradaPuestaAlDia => ({
  sucursalId: 'st', corte: '2026-11-11T11:20:16-03:00', stock: [], ventas: [], ...x,
});
const plan = (e: Partial<EntradaPuestaAlDia>, b: Partial<BasePuestaAlDia> = {}) => planDePuestaAlDia(entrada(e), base(b), AHORA);
const ajuste = (pl: ReturnType<typeof plan>, id: string) => pl.stock.find((a) => a.producto_id === id);

describe('el stock', () => {
  it('queda como dice el sistema del local; lo que no cambió no se toca', () => {
    const pl = plan({ stock: [{ codigo: '1', cantidad: 7 }, { codigo: '2', cantidad: 5 }] });
    expect(ajuste(pl, 'p1')).toMatchObject({ antes: 10, objetivo: 7, crack: 7 });
    expect(ajuste(pl, 'p2')).toBeUndefined();
    expect(pl.resumen.stock).toMatchObject({ ajustes: 1, bajan: 1, suben: 0, unidadesBajan: 3 });
  });

  it('lo que el archivo no trae, no se toca', () => {
    expect(plan({ stock: [{ codigo: '1', cantidad: 10 }] }).stock).toEqual([]);
  });

  it('una compra cargada solo en NÚCLEO se conserva: el local no la tiene', () => {
    // después de la carga había 10; administración cargó 6 (hay 16); el local vendió 2 y dice 8
    const pl = plan(
      { stock: [{ codigo: '1', cantidad: 8 }], ventas: [{ fecha: '2026-11-10', codigo: '1', unidades: 2 }] },
      { stock: new Map([['p1', 16]]), movimientos: [{ producto_id: 'p1', tipo: 'compra', cantidad: 6, referencia_tipo: 'compra_directa' }] },
    );
    expect(ajuste(pl, 'p1')).toMatchObject({ antes: 16, objetivo: 14, solo_nucleo: 6 });
    expect(pl.resumen.stock.comprasSoloNucleo).toBe(1);
  });

  it('si el local también cargó esa compra (su stock subió), no se cuenta dos veces', () => {
    // el local: 10 − 2 vendidas + 6 que entraron = 14
    const pl = plan(
      { stock: [{ codigo: '1', cantidad: 14 }], ventas: [{ fecha: '2026-11-10', codigo: '1', unidades: 2 }] },
      { stock: new Map([['p1', 16]]), movimientos: [{ producto_id: 'p1', tipo: 'compra', cantidad: 6, referencia_tipo: 'compra_directa' }] },
    );
    expect(ajuste(pl, 'p1')).toMatchObject({ objetivo: 14, solo_nucleo: 0 });
    expect(pl.resumen.stock).toMatchObject({ comprasQueElLocalYaTenia: 1, comprasSoloNucleo: 0 });
  });

  it('las ventas de prueba de NÚCLEO no cuentan; una corrección o un traspaso, sí', () => {
    const pl = plan(
      { stock: [{ codigo: '1', cantidad: 10 }, { codigo: '2', cantidad: 5 }] },
      {
        stock: new Map([['p1', 7], ['p2', 3]]),
        movimientos: [
          { producto_id: 'p1', tipo: 'venta', cantidad: -3, referencia_tipo: 'venta' },
          { producto_id: 'p2', tipo: 'ajuste', cantidad: -2, referencia_tipo: 'correccion_factura' },
        ],
      },
    );
    expect(ajuste(pl, 'p1')).toMatchObject({ antes: 7, objetivo: 10 }); // la venta de prueba se deshace
    expect(ajuste(pl, 'p2')).toBeUndefined(); // 5 − 2 = 3: ya está
  });

  it('los negativos del local quedan en cero', () => {
    expect(ajuste(plan({ stock: [{ codigo: '1', cantidad: -7 }] }), 'p1')).toMatchObject({ objetivo: 0 });
  });

  it('un código que viene dos veces se suma', () => {
    const pl = plan({ stock: [{ codigo: '1', cantidad: 17 }, { codigo: '1', cantidad: 0 }, { codigo: '3', cantidad: 0 }, { codigo: '3', cantidad: 0.705 }] });
    expect(ajuste(pl, 'p1')).toMatchObject({ objetivo: 17 });
    expect(ajuste(pl, 'p3')).toMatchObject({ objetivo: 0.705 });
    expect(pl.avisos).toContain('2 códigos vienen más de una vez en el archivo de stock: se suman sus cantidades.');
  });

  it('un código que NÚCLEO no tiene, o un producto dado de baja, no se toca: se cuenta', () => {
    const pl = plan({ stock: [{ codigo: '1', cantidad: 10 }, { codigo: '99', cantidad: 4 }, { codigo: '2', cantidad: 50 }] }, { productos: [prod(1), prod(2, { activo: false })] });
    expect(pl.stock).toEqual([]);
    expect(pl.resumen.stock).toMatchObject({ enArchivo: 3, conProducto: 1, sinProducto: 1, deBaja: 1 });
  });
});

describe('las ventas', () => {
  const ventas = [
    { fecha: '2026-11-09', codigo: '1', unidades: 4 }, // ya cargado
    { fecha: '2026-11-10', codigo: '1', unidades: 3 },
    { fecha: '2026-11-10', codigo: '2', unidades: 1.5 },
    { fecha: '2026-11-10', codigo: '99', unidades: 2 }, // código que NÚCLEO no tiene
    { fecha: '2026-11-11', codigo: '1', unidades: 1 }, // el día del corte, a medias
  ];

  it('entran solo los días completos que faltaban: ni lo ya cargado ni el día del corte', () => {
    const pl = plan({ stock: [{ codigo: '1', cantidad: 10 }], ventas });
    expect(pl.ventas).toEqual([
      { producto_id: 'p1', sku: 'L1', codigo: '1', nombre: 'Producto 1', fecha: '2026-11-10', unidades: 3 },
      { producto_id: 'p2', sku: 'L2', codigo: '2', nombre: 'Producto 2', fecha: '2026-11-10', unidades: 1.5 },
    ]);
    expect(pl.resumen.ventas).toMatchObject({ desde: '2026-11-10', hasta: '2026-11-10', dias: 1, renglones: 2, unidades: 4.5 });
    expect(pl.avisos).toContain('1 renglones de venta son de códigos que NÚCLEO no tiene: no se cargan.');
  });

  it('si en el medio falta un día entero, avisa: puede ser un feriado o un archivo cortado', () => {
    const pl = planDePuestaAlDia(
      entrada({ corte: '2026-11-13T09:00:00-03:00', stock: [{ codigo: '1', cantidad: 10 }], ventas: [{ fecha: '2026-11-10', codigo: '1', unidades: 3 }, { fecha: '2026-11-12', codigo: '1', unidades: 2 }] }),
      base(), new Date('2026-11-13T10:00:00-03:00'),
    );
    expect(pl.avisos.some((a) => a.startsWith('El archivo de ventas no trae nada del 11/11.'))).toBe(true);
    expect(pl.resumen.ventas.dias).toBe(2);
  });

  it('cargar el mismo día dos veces no agrega nada', () => {
    expect(plan({ stock: [{ codigo: '1', cantidad: 10 }], ventas }, { ventasHasta: '2026-11-10' }).ventas).toEqual([]);
  });
});

describe('cuándo no se puede aplicar', () => {
  const stock = [{ codigo: '1', cantidad: 10 }, { codigo: '2', cantidad: 5 }];

  it('un archivo de antes de la última carga', () => {
    const pl = plan({ corte: '2026-11-10T11:20:16-03:00', stock });
    expect(pl.frenos).toEqual(['Este archivo es del 10/11 a las 11:20, anterior a la última carga (10/11): bajá uno nuevo del sistema del local.']);
  });

  it('sin fecha de corte, con fecha futura o sin productos', () => {
    expect(plan({ corte: '', stock }).frenos[0]).toMatch(/no trae la fecha y hora del corte/);
    expect(plan({ corte: '2026-11-12T11:00:00-03:00', stock }).frenos[0]).toMatch(/fecha futura/);
    expect(plan({ stock: [] }).frenos).toContain('El archivo de stock no trae productos.');
  });

  it('si casi ningún código es un producto de NÚCLEO, no es el archivo de este local', () => {
    const pl = plan({ stock: [{ codigo: '1', cantidad: 1 }, { codigo: '901', cantidad: 1 }, { codigo: '902', cantidad: 1 }, { codigo: '903', cantidad: 1 }] });
    expect(pl.frenos[0]).toMatch(/Solo 1 de los 4 códigos/);
  });

  it('un archivo de anteayer se puede aplicar, pero avisa que el stock queda como ese día', () => {
    const pl = planDePuestaAlDia(entrada({ corte: '2026-11-11T11:20:16-03:00', stock }), base(), new Date('2026-11-13T09:00:00-03:00'));
    expect(pl.frenos).toEqual([]);
    expect(pl.avisos[0]).toMatch(/El archivo es del 11\/11/);
  });

  it('la referencia sale del corte', () => {
    expect(plan({ stock }).referencia).toBe('crack-20261111-1120');
  });
});
