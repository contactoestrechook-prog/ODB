import { esPorKilo } from './asistente.service';

// En la primera auditoría el asistente mostró "Jamón crudo $82.800" en una
// picada sin decir que era el precio por kilo. Estos son por peso.
describe('esPorKilo', () => {
  it.each([
    [{ nombre: 'Jamon Crudo Campo Austral', vendidoPorPeso: true }],
    [{ nombre: 'Salame Milan Cagnoli x fraccion' }],
    [{ nombre: 'Queso Azul La Paulina x Fracción' }],
    [{ nombre: 'Salame Milan Campo Austral Fraccionado' }],
    [{ nombre: 'Lomo ahumado x kg' }],
  ])('%j se vende por kilo', (p) => expect(esPorKilo(p)).toBe(true));

  it.each([
    [{ nombre: 'Aceitunas Familia Gullo x 200 gr' }],
    [{ nombre: 'Trumpeter Malbec x750cc' }],
    [{ nombre: 'Tostadas arroz Criollitas x 110 gr' }],
  ])('%j se vende por unidad', (p) => expect(esPorKilo(p)).toBe(false));
});
