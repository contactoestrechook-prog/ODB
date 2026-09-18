import { controlDeFechas, diaDeLaSemana } from './fechas';

describe('día de la semana calculado', () => {
  it('el ODB Wine Fest: 30/10/2026 es viernes, no jueves', () => {
    expect(diaDeLaSemana(30, 10, 2026)).toBe('viernes');
    expect(controlDeFechas('EVENTO VIGENTE — ODB WINE FEST 2026: jueves 30/10/2026, 20 a 01 hs'))
      .toMatch(/30\/10\/2026 es viernes 30 de octubre de 2026/);
  });
  it('fechas que no existen o texto sin fechas no arman control', () => {
    expect(diaDeLaSemana(31, 2, 2026)).toBeNull();
    expect(controlDeFechas('Promo 2x1 todos los fines de semana')).toBe('');
  });
  it('varias fechas, sin repetir', () => {
    const c = controlDeFechas('del 1/11/2026 al 3/11/2026 y otra vez el 1/11/2026');
    expect(c).toMatch(/1\/11\/2026 es domingo/);
    expect(c).toMatch(/3\/11\/2026 es martes/);
    expect(c.match(/1\/11\/2026 es/g)).toHaveLength(1);
  });
});
