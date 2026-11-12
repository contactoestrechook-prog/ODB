import { diferenciaDe, sugerirTraspaso, valorDe } from './logica';

const fila = (o: Partial<Parameters<typeof sugerirTraspaso>[0][number]>) => ({
  productoId: 'p', sku: 'L1', nombre: 'Producto', stockOrigen: 0, stockDestino: 0, minimoDestino: 0, minimoOrigen: 0, vendidas30Destino: 0, vendidas30Origen: 0, ...o,
});

describe('qué pedir al otro local', () => {
  it('lo que al destino le falta para 14 días de venta y al origen le sobra', () => {
    // destino vende 30 por mes (1 por día) y tiene 2: necesita 14 − 2 = 12; el origen tiene 50 y vende 15 por mes: reserva 7, sobran 43
    const [s] = sugerirTraspaso([fila({ stockDestino: 2, vendidas30Destino: 30, stockOrigen: 50, vendidas30Origen: 15 })]);
    expect(s).toMatchObject({ necesita: 12, sobra: 43, sugerido: 12, diasCubiertosDestino: 2 });
  });
  it('nunca vacía el otro local: sugiere solo lo que le sobra', () => {
    const [s] = sugerirTraspaso([fila({ stockDestino: 0, vendidas30Destino: 60, stockOrigen: 10, vendidas30Origen: 15 })]);
    expect(s.sugerido).toBe(3); // el origen se queda con sus 7 días
  });
  it('el mínimo cargado manda si es más que la venta', () => {
    const [s] = sugerirTraspaso([fila({ stockDestino: 1, minimoDestino: 6, stockOrigen: 20 })]);
    expect(s.sugerido).toBe(5);
  });
  it('sin necesidad o sin sobrante, no sugiere', () => {
    expect(sugerirTraspaso([fila({ stockDestino: 30, vendidas30Destino: 30, stockOrigen: 50 })])).toEqual([]);
    expect(sugerirTraspaso([fila({ stockDestino: 0, vendidas30Destino: 30, stockOrigen: 3, minimoOrigen: 3 })])).toEqual([]);
  });
  it('primero lo que se termina antes en el destino', () => {
    const r = sugerirTraspaso([
      fila({ sku: 'A', stockDestino: 10, vendidas30Destino: 30, stockOrigen: 100 }),
      fila({ sku: 'B', stockDestino: 0, vendidas30Destino: 30, stockOrigen: 100 }),
    ]);
    expect(r.map((x) => x.sku)).toEqual(['B', 'A']);
  });
});

describe('diferencias y valor', () => {
  it('faltó en negativo, sobró en positivo; sin recibir, sin diferencia', () => {
    expect(diferenciaDe({ cantidad: 5, cantidad_recibida: 4 })).toBe(-1);
    expect(diferenciaDe({ cantidad: 2, cantidad_recibida: 3 })).toBe(1);
    expect(diferenciaDe({ cantidad: 2, cantidad_recibida: null })).toBe(0);
  });
  it('lo enviado al costo de cuando salió', () => {
    expect(valorDe([{ cantidad: 5, cantidad_recibida: null, costo_unitario: 1000 }, { cantidad: 2, cantidad_recibida: null, costo_unitario: 250.5 }])).toBe(5501);
  });
});
