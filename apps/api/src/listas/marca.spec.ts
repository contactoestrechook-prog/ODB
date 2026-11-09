import { marcaDelRenglon, mismaMarca } from './marca';

describe('la marca del renglón', () => {
  it('salta el tipo de producto: «Alfajor Jorgito…» es Jorgito', () => {
    expect(marcaDelRenglon('Alfajor Jorgito Chocolate Negro 18 x 6U')).toBe('jorgito');
    expect(marcaDelRenglon('Galletitas Trio besitos glaceadas x 300 gr')).toBe('trio');
    expect(marcaDelRenglon('Bocadito Ferrero Rocher T3 x 12.5grs.')).toBe('ferrero');
    expect(marcaDelRenglon('Knorr Risotto hongos')).toBe('knorr');
  });
  it('Distri Sur 9/11/2026: Jorgito no es Cachafaz ni Terrabusi', () => {
    expect(mismaMarca('Alfajor Jorgito Chocolate Negro 18 x 6U', 'Alfajor Cachafaz  Chocolate Negro x 6u')).toBe(false);
    expect(mismaMarca('Alfajor Jorgito Blanco Glaseado Tubo 18 x 6U', 'Alfajor Terrabusi Blanco glaseado x 6')).toBe(false);
    expect(mismaMarca('Alfajor Jorgito Chocolate Negro 18 x 6U', 'Alfajor Jorgito Tubo Chocolate x155gr')).toBe(true);
  });
  it('lo de siempre sigue: Knorr no es Gallo', () => {
    expect(mismaMarca('Knorr Risotto hongos', 'Arroz Gallo Risotto')).toBe(false);
    expect(mismaMarca('Vinagre Vino UNIDAD x 500 m.l. Menoyo', 'Vinagre Menoyo de vino x 500 cc')).toBe(true);
  });
});
