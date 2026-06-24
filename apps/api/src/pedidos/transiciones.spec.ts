import { transicionValida, estadosSiguientes, liberaReserva, esTerminal } from './transiciones';

describe('máquina de estados de pedidos', () => {
  it('permite las transiciones válidas del flujo', () => {
    expect(transicionValida('recibido', 'en_preparacion')).toBe(true);
    expect(transicionValida('en_preparacion', 'listo')).toBe(true);
    expect(transicionValida('listo', 'entregado')).toBe(true);
    expect(transicionValida('listo', 'en_camino')).toBe(true);
    expect(transicionValida('en_camino', 'entregado')).toBe(true);
  });

  it('rechaza saltos inválidos', () => {
    expect(transicionValida('recibido', 'entregado')).toBe(false); // no puede saltar preparación
    expect(transicionValida('entregado', 'en_preparacion')).toBe(false); // terminal
    expect(transicionValida('inexistente', 'listo')).toBe(false);
  });

  it('cualquier estado activo se puede cancelar, los terminales no', () => {
    expect(transicionValida('recibido', 'cancelado')).toBe(true);
    expect(transicionValida('listo', 'cancelado')).toBe(true);
    expect(transicionValida('entregado', 'cancelado')).toBe(false);
  });

  it('entregado y cancelado liberan reserva y son terminales', () => {
    expect(liberaReserva('entregado')).toBe(true);
    expect(liberaReserva('cancelado')).toBe(true);
    expect(liberaReserva('listo')).toBe(false);
    expect(esTerminal('entregado')).toBe(true);
    expect(estadosSiguientes('entregado')).toEqual([]);
  });
});
