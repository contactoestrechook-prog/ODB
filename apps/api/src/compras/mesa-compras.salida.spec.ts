import { decidirSinTexto } from './mesa-compras.service';

// El bug que mostró Leandro el 10/9/2026: el analista pedía "decime con cuántos
// renglones arranco", el comprador contestaba "los primeros 30 dale" y volvía
// el MISMO mensaje. Nada de lo que contestara podía destrabarlo.
describe('decidirSinTexto', () => {
  it('la primera vez que se queda sin espacio, se destraba solo', () => {
    expect(decidirSinTexto('max_tokens', false)).toEqual({ accion: 'reintentar' });
  });

  it('si ya reintentó, contesta y pide algo CONCRETO y distinto', () => {
    const r = decidirSinTexto('max_tokens', true);
    expect(r.accion).toBe('responder');
    if (r.accion !== 'responder') throw new Error('debería responder');
    expect(r.texto).toMatch(/25|SKU/);
    // el texto viejo dejaba al comprador sin salida: no puede volver
    expect(r.texto).not.toMatch(/con cuántos renglones arranco/i);
  });

  it('los dos mensajes de salida son distintos entre sí', () => {
    const a = decidirSinTexto('max_tokens', true);
    const b = decidirSinTexto('end_turn', true);
    if (a.accion !== 'responder' || b.accion !== 'responder') throw new Error('deberían responder');
    expect(a.texto).not.toEqual(b.texto);
  });

  it('cortado por otro motivo no reintenta al pedo', () => {
    expect(decidirSinTexto('end_turn', false).accion).toBe('responder');
    expect(decidirSinTexto(null, false).accion).toBe('responder');
    expect(decidirSinTexto(undefined, true).accion).toBe('responder');
  });

  it('ningún mensaje deja al comprador sin nada que hacer', () => {
    for (const stop of ['max_tokens', 'end_turn', null]) {
      const r = decidirSinTexto(stop, true);
      if (r.accion !== 'responder') throw new Error('debería responder');
      expect(r.texto.length).toBeGreaterThan(40);
      expect(r.texto).toMatch(/decime|pasame|contame/i); // siempre hay un próximo paso
    }
  });
});
