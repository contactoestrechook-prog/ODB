import { respuestaSinVueltas, ESCALONES } from './sin-vueltas';

// El caso real (10/9/2026): el analista repitió palabra por palabra
// "Se me hizo muy larga la lista de una. Decime con cuántos renglones arranco…"
// después de que el comprador contestara "los primeros 30 dale".
const PEGOTE = 'Se me hizo muy larga la lista de una. Decime con cuántos renglones arranco (por ejemplo los primeros 30) y te los paso todos juntos.';

describe('respuestaSinVueltas', () => {
  it('una respuesta nueva pasa tal cual', () => {
    const r = respuestaSinVueltas('El costo real por unidad es $12.191.', [PEGOTE]);
    expect(r.texto).toBe('El costo real por unidad es $12.191.');
    expect(r.seRepitio).toBe(false);
  });

  it('NUNCA devuelve lo mismo que ya se dijo', () => {
    const r = respuestaSinVueltas(PEGOTE, [PEGOTE]);
    expect(r.texto).not.toBe(PEGOTE);
    expect(r.seRepitio).toBe(true);
  });

  it('ignora mayúsculas, tildes y espacios al comparar', () => {
    expect(respuestaSinVueltas('  ¿Cuántos RENGLONES arranco?  ', ['¿Cuantos renglones arranco?']).seRepitio).toBe(true);
  });

  it('escala: cada vez que se traba pide algo distinto', () => {
    const dichas = [PEGOTE];
    const vistos = new Set<string>();
    for (let i = 0; i < ESCALONES.length; i++) {
      const r = respuestaSinVueltas(PEGOTE, dichas);
      expect(vistos.has(r.texto)).toBe(false); // nunca dos veces el mismo escalón
      vistos.add(r.texto);
      dichas.push(r.texto);
    }
  });

  it('el último escalón no le pide nada más al usuario: ofrece salida', () => {
    const ultimo = ESCALONES[ESCALONES.length - 1];
    expect(ultimo).toMatch(/equipo del sistema|a mano/i);
  });

  it('una respuesta vacía tampoco sale al aire', () => {
    for (const vacia of ['', '   ', null, undefined]) {
      const r = respuestaSinVueltas(vacia as any, []);
      expect(r.texto.length).toBeGreaterThan(30);
    }
  });

  it('todos los escalones dicen qué hacer ahora', () => {
    for (const e of ESCALONES) expect(e).toMatch(/pasame|empecemos|carg[aá]|avis/i);
  });

  it('sin historial, la respuesta del modelo pasa siempre', () => {
    expect(respuestaSinVueltas('Costo $10.000', []).texto).toBe('Costo $10.000');
  });
});
