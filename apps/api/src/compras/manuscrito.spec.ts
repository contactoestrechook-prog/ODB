// LO AGREGADO A MANO NO CAMBIA LA CARGA (17/11/2026, Leandro: «sí, ignorarlo siempre»).
import { marcasAMano, pideLoManuscrito } from './manuscrito';

describe('lo agregado a mano no cambia la carga', () => {
  it('en la primera lectura (sin aclaraciones) nada vuelve ni llega en parte, diga lo que diga el lector', () => {
    expect(pideLoManuscrito(undefined)).toBe(false);
    expect(pideLoManuscrito('')).toBe(false);
    expect(pideLoManuscrito('   ')).toBe(false);
    expect(marcasAMano({ devueltoAMano: true, recibidoAMano: 28 }, false)).toEqual({ devueltoAMano: false, recibidoAMano: null });
  });

  it('una aclaración que no habla de lo anotado tampoco lo habilita', () => {
    expect(pideLoManuscrito('el proveedor es BIMBO')).toBe(false);
    expect(pideLoManuscrito('el precio es por bulto y tiene 5 % de descuento')).toBe(false);
    expect(pideLoManuscrito('el total con impuestos es $84.000')).toBe(false);
  });

  it('si la persona lo pide, vale lo que leyó el lector', () => {
    // frases como las que escribe la gente en el chat
    for (const frase of [
      'tomá lo que está anotado a mano en el papel',
      'lo pintado se devolvió',
      'LA NOTA MANUSCRITA DICE QUE INGRESARON 3 BULTOS',
      'la pizza sin tacc no ingreso al stock porque se devolvio',
      'faltó una yerba, descontar',
      'el salame no vino',
    ]) expect(pideLoManuscrito(frase)).toBe(true);
    expect(marcasAMano({ devueltoAMano: true, recibidoAMano: 0 }, true)).toEqual({ devueltoAMano: true, recibidoAMano: null });
    expect(marcasAMano({ devueltoAMano: false, recibidoAMano: 28 }, true)).toEqual({ devueltoAMano: false, recibidoAMano: 28 });
    // el valor neutro del esquema no es una devolución ni una entrega parcial
    expect(marcasAMano({ devueltoAMano: false, recibidoAMano: 0 }, true)).toEqual({ devueltoAMano: false, recibidoAMano: null });
  });

  it('«no tomes lo manuscrito» deja pasar al lector, que hace lo que la persona dice', () => {
    // la frase habla de lo anotado: la decisión queda en el lector, que la lee entera
    expect(pideLoManuscrito('LAS ANOTACIONES A MANO NO TOMARLAS')).toBe(true);
    expect(marcasAMano({ devueltoAMano: false, recibidoAMano: 0 }, true)).toEqual({ devueltoAMano: false, recibidoAMano: null });
  });
});
