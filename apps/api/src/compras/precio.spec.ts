import { precioDesdeCosto, margenAplicable, MARGEN_DEFAULT } from './precio';

describe('precioDesdeCosto (regla de oro: % sobre el costo de la entrada)', () => {
  it('aplica el margen porcentual y redondea', () => {
    expect(precioDesdeCosto(1000, 35)).toBe(1350);
    expect(precioDesdeCosto(1481.6, 40)).toBe(2074); // 1481.6 × 1.4 = 2074.24 → 2074
  });
  it('costo 0 o inválido → 0', () => {
    expect(precioDesdeCosto(0, 35)).toBe(0);
    expect(precioDesdeCosto(-5, 35)).toBe(0);
  });
});

describe('margenAplicable (override → rubro → default)', () => {
  it('prioriza el override manual de la recepción', () => {
    expect(margenAplicable(50, 35)).toBe(50);
  });
  it('si no hay override usa el margen del rubro', () => {
    expect(margenAplicable(null, 42)).toBe(42);
    expect(margenAplicable(undefined, 30)).toBe(30);
  });
  it('si no hay ninguno usa el default', () => {
    expect(margenAplicable(null, null)).toBe(MARGEN_DEFAULT);
    expect(margenAplicable(0, 0)).toBe(MARGEN_DEFAULT);
  });
});
