import { LimitadorTasa } from './limitador';

describe('LimitadorTasa (ventana deslizante por clave)', () => {
  it('permite hasta el máximo y corta el siguiente intento', () => {
    const lim = new LimitadorTasa(3, 3_600_000);
    expect(lim.superaLimite('ip-1')).toBe(false);
    expect(lim.superaLimite('ip-1')).toBe(false);
    expect(lim.superaLimite('ip-1')).toBe(false);
    expect(lim.superaLimite('ip-1')).toBe(true);
  });

  it('cada clave tiene su propio contador (una IP no bloquea a otra)', () => {
    const lim = new LimitadorTasa(1, 3_600_000);
    expect(lim.superaLimite('ip-1')).toBe(false);
    expect(lim.superaLimite('ip-2')).toBe(false);
  });

  it('los intentos fuera de la ventana no cuentan', () => {
    const lim = new LimitadorTasa(1, 1000);
    const ahoraSpy = jest.spyOn(Date, 'now');
    ahoraSpy.mockReturnValue(0);
    expect(lim.superaLimite('ip-1')).toBe(false);
    ahoraSpy.mockReturnValue(5000); // bien afuera de la ventana de 1000ms
    expect(lim.superaLimite('ip-1')).toBe(false);
    ahoraSpy.mockRestore();
  });
});
