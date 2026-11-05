// Las cuentas de la pantalla «Inventario de producto» (5/11/2026): las escalas
// y las marcas de los gráficos y las palabras de cada estado.
import {
  caminoEscalonado, conSigno, cuantoAlcanza, escala, estadoDeSucursal, inicioDelDia, marcasDeTiempo, marcasDelEje, nivelEn,
  periodoEnPalabras, porDia, separarRotulos, unidades, valorEn,
} from '../../../admin/app/lib/inventario';

describe('las marcas del eje de cantidades', () => {
  it('pasan por el cero, van de a 1, 2 o 5 y la última cubre el máximo', () => {
    expect(marcasDelEje(0, 150, 4)).toEqual([0, 50, 100, 150]);
    expect(marcasDelEje(0, 81, 4)).toEqual([0, 50, 100]);
    expect(marcasDelEje(0, 9, 4)).toEqual([0, 5, 10]);
    expect(marcasDelEje(0, 9.8, 3)).toEqual([0, 5, 10]);
    expect(marcasDelEje(0, 2500, 4)).toEqual([0, 1000, 2000, 3000]);
    expect(marcasDelEje(0, 0.62, 3)).toEqual([0, 0.5, 1]);
  });
  it('con stock en negativo el eje baja del cero, y sin datos no se rompe', () => {
    expect(marcasDelEje(-20, 80, 4)).toEqual([-50, 0, 50, 100]);
    expect(marcasDelEje(0, 0)).toEqual([0, 1]);
    expect(marcasDelEje(NaN, NaN)).toEqual([0, 1]);
  });
});

describe('las marcas del eje de tiempo', () => {
  const etiquetas = (desde: number, hasta: number, maximo: number) => marcasDeTiempo(desde, hasta, maximo).map((m) => m.etiqueta);
  it('tres meses de stock: una por mes, con el año entero en la primera', () => {
    expect(etiquetas(inicioDelDia('2026-08-08'), Date.parse('2026-11-05T18:00:00-03:00'), 7)).toEqual(['sep 2026', 'oct', 'nov']);
  });
  it('un año de ventas: se saltean meses sin perder el último, y enero trae el año', () => {
    const desde = inicioDelDia('2025-10-21'), hasta = inicioDelDia('2026-10-24');
    expect(etiquetas(desde, hasta, 4)).toEqual(['ene 2026', 'abr', 'jul', 'oct']);
    expect(etiquetas(desde, hasta, 7)).toEqual(['dic 2025', 'feb 2026', 'abr', 'jun', 'ago', 'oct']);
  });
  it('pocos días: por día', () => {
    expect(etiquetas(inicioDelDia('2026-10-28'), inicioDelDia('2026-11-05') + 12 * 3_600_000, 7)).toEqual(['28/10', '30/10', '01/11', '03/11', '05/11']);
    expect(marcasDeTiempo(10, 10)).toEqual([]);
  });
  it('cada marca cae en la medianoche de Buenos Aires', () => {
    const [primera] = marcasDeTiempo(inicioDelDia('2026-08-08'), inicioDelDia('2026-11-05'), 7);
    expect(new Date(primera.ms).toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });
});

describe('las líneas en escalones', () => {
  it('cada valor vale hasta el punto siguiente y el último llega hasta el final', () => {
    expect(caminoEscalonado([{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 9, y: 5 }], 12)).toBe('M0 10H5V20H9V5H12');
    expect(caminoEscalonado([], 12)).toBe('');
    const x = escala(0, 100, 40, 240);
    expect([x(0), x(50), x(100)]).toEqual([40, 140, 240]);
  });
  it('el stock de un día es el del último cambio hasta ahí', () => {
    const serie = { sucursalId: 'st', inicial: 93, puntos: [{ en: '2026-08-11T14:23:00Z', saldo: 0 }, { en: '2026-08-31T13:38:14Z', saldo: 60 }] };
    expect(nivelEn(serie, Date.parse('2026-08-10T00:00:00Z'))).toBe(93);
    expect(nivelEn(serie, Date.parse('2026-08-11T14:23:00Z'))).toBe(0);
    expect(nivelEn(serie, Date.parse('2026-09-15T00:00:00Z'))).toBe(60);
  });
  it('el costo de un día es el último cargado hasta ahí; antes del primero no hay', () => {
    const costos = [{ en: '2026-08-31T13:38:14Z', valor: 1663.52 }, { en: '2026-10-24T15:00:00Z', valor: 1169.52 }];
    expect(valorEn(costos, Date.parse('2026-08-01T00:00:00Z'))).toBeNull();
    expect(valorEn(costos, Date.parse('2026-09-16T00:00:00Z'))?.valor).toBe(1663.52);
    expect(valorEn(costos, Date.parse('2026-11-05T00:00:00Z'))?.valor).toBe(1169.52);
  });
  it('dos rótulos que quedarían encimados se separan, sin cambiar de orden ni salirse del dibujo', () => {
    expect(separarRotulos([100, 105], 15)).toEqual([95, 110]);
    expect(separarRotulos([105, 100], 15)).toEqual([110, 95]);
    expect(separarRotulos([40, 200], 15)).toEqual([40, 200]);
    expect(separarRotulos([100, 105], 15, 98)).toEqual([98, 113]);
    expect(separarRotulos([100, 105], 15, -Infinity, 104)).toEqual([89, 104]);
  });
});

describe('las cantidades y los estados, en palabras', () => {
  it('las cantidades', () => {
    expect(unidades(81)).toBe('81');
    expect(unidades(1192)).toBe('1.192');
    expect(unidades(687.737, true)).toBe('687,737 kg');
    expect(unidades(764.2869999999999)).toBe('764,287');
    expect(conSigno(90)).toBe('+90');
    expect(conSigno(-129)).toBe('−129');
    expect(conSigno(-0.26, true)).toBe('−0,26 kg');
    expect(conSigno(0)).toBe('0');
    expect(porDia(7.84)).toBe('7,8 por día');
    expect(porDia(0.62)).toBe('0,62 por día');
  });
  it('el estado de una sucursal usa las alertas de Mesa de compras', () => {
    expect(estadoDeSucursal({ alerta: 'sin_stock', stock: 0, ritmoDia: 2.66 })).toEqual({ tono: 'error', palabra: 'Sin stock' });
    expect(estadoDeSucursal({ alerta: 'no_llega', stock: 12, ritmoDia: 1.38 })).toEqual({ tono: 'error', palabra: 'No llega a tiempo' });
    expect(estadoDeSucursal({ alerta: 'menos_de_12', stock: 7, ritmoDia: 0.02 })).toEqual({ tono: 'neutro', palabra: 'Menos de 12' });
    expect(estadoDeSucursal({ alerta: null, stock: 81, ritmoDia: 7.84 })).toEqual({ tono: 'ok', palabra: 'Alcanza' });
    expect(estadoDeSucursal({ alerta: null, stock: 0, ritmoDia: null })).toEqual({ tono: 'neutro', palabra: 'Sin stock' });
    expect(estadoDeSucursal({ alerta: null, stock: 4, ritmoDia: 0 })).toEqual({ tono: 'neutro', palabra: 'Sin ventas cargadas' });
  });
  it('para cuánto alcanza', () => {
    expect(cuantoAlcanza(10.3)).toBe('alcanza para 10 días');
    expect(cuantoAlcanza(1.2)).toBe('alcanza para un día');
    expect(cuantoAlcanza(0.4)).toBe('alcanza para menos de un día');
    expect(cuantoAlcanza(89.6)).toBe('alcanza para 3 meses');
    expect(cuantoAlcanza(400)).toBe('alcanza para más de un año');
    expect(cuantoAlcanza(0)).toBeNull();
    expect(cuantoAlcanza(null)).toBeNull();
  });
  it('el período, de corrido y con el año entero', () => {
    expect(periodoEnPalabras({ desde: '2025-11-01', hasta: '2025-11-30' })).toBe('del 1/11/2025 al 30/11/2025');
  });
});
