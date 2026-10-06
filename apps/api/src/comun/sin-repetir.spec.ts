// LO DE ANTES Y EL FINAL, SIN REPETIR (revisión del 6/10/2026, Opus 5.5): el
// prompt pide el mensaje completo al final, y las notas cortas de antes de una
// herramienta siguen llegando como texto. Pegarlas con el final repetía lo mismo.
import { unirConLoDicho, yaLoDice } from './sin-repetir';

describe('unirConLoDicho', () => {
  it('el final corto que repite lo de antes (con otras palabras) va solo', () => {
    expect(unirConLoDicho(['Anotado a nombre de Pablo.'], 'Anotado, Pablo. Retirás mañana.')).toBe('Anotado, Pablo. Retirás mañana.');
  });

  it('el final corto que repite lo de antes tal cual va solo («Dale Pablo.» y «Dale Pablo. ¿Algo más?»)', () => {
    expect(unirConLoDicho(['Dale Pablo.'], 'Dale Pablo. ¿Algo más?')).toBe('Dale Pablo. ¿Algo más?');
  });

  it('lo de antes que el final corto NO dice se sigue rescatando, adelante', () => {
    expect(unirConLoDicho(['Te lo dejo a nombre de Pablo para retirar mañana.'], 'El Malbec sale $5.000.'))
      .toBe('Te lo dejo a nombre de Pablo para retirar mañana.\n\nEl Malbec sale $5.000.');
  });

  it('de varias oraciones de antes, salen solo las que el final no dice', () => {
    expect(unirConLoDicho(['Anotado a nombre de Pablo. Lo retirás mañana por la tarde.'], 'Anotado, Pablo. El Malbec sale $5.000.'))
      .toBe('Lo retirás mañana por la tarde.\n\nAnotado, Pablo. El Malbec sale $5.000.');
  });

  it('un final largo ya es el mensaje entero: va solo, como siempre', () => {
    const final = 'Anotado a nombre de Pablo, lo retirás mañana en Saint Thomas. El Malbec sale $5.000.';
    expect(unirConLoDicho(['Algo que no repite el final.'], final)).toBe(final);
  });

  it('sin final, lo de antes tal cual y sin duplicados', () => {
    expect(unirConLoDicho(['Hola.', 'Hola.', 'Abrimos hasta las 21.'], '')).toBe('Hola.\n\nAbrimos hasta las 21.');
  });

  it('sin nada antes, el final', () => {
    expect(unirConLoDicho([], 'Listo.')).toBe('Listo.');
  });

  it('una lista de antes conserva sus renglones', () => {
    expect(unirConLoDicho(['• 2 Fernet Branca 750 cc\n• 3 Coca Zero 1,75 L'], 'Total: $55.100.'))
      .toBe('• 2 Fernet Branca 750 cc\n• 3 Coca Zero 1,75 L\n\nTotal: $55.100.');
  });
});

describe('yaLoDice', () => {
  it('sin palabras propias («Ok.») no se pierde nada', () => {
    expect(yaLoDice('Ok.', 'El Malbec sale $5.000.')).toBe(true);
  });
  it('sin tildes ni mayúsculas', () => {
    expect(yaLoDice('Retirás mañana.', 'retiras manana')).toBe(true);
  });
  it('otra cosa no la dice', () => {
    expect(yaLoDice('Te busco el precio del Malbec.', 'El Malbec sale $5.000.')).toBe(false);
  });
});
