// El borrador del pedido a proveedor (4/11/2026): lo que se guarda es lo que la
// pantalla escribió, y nada raro entra.
import { normalizarBorradorPedido, TOPE_RENGLONES_BORRADOR } from './borrador-pedido';

describe('borrador del pedido a proveedor', () => {
  it('guarda las cantidades tal cual y saca los ceros y lo inválido', () => {
    expect(normalizarBorradorPedido({ L2617: 12, L7295: '3', L7297: 0, L9458: -2, L1: 'doce', '': 5, '  L5 ': 2.6 }))
      .toEqual({ L2617: 12, L7295: 3, L5: 3 });
  });
  it('con cualquier otra cosa devuelve vacío', () => {
    expect(normalizarBorradorPedido(null)).toEqual({});
    expect(normalizarBorradorPedido([1, 2])).toEqual({});
    expect(normalizarBorradorPedido('L2617')).toEqual({});
  });
  it('no pasa del tope de renglones', () => {
    const muchos: Record<string, number> = {};
    for (let i = 0; i < TOPE_RENGLONES_BORRADOR + 50; i++) muchos[`L${i}`] = 1;
    expect(Object.keys(normalizarBorradorPedido(muchos))).toHaveLength(TOPE_RENGLONES_BORRADOR);
  });
});
