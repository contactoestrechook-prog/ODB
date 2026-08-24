import { precioDesdeCosto, margenAplicable, redondearPrecio, MARGEN_DEFAULT } from './precio';

describe('redondearPrecio (redondeo de góndola: a la centena)', () => {
  it('de 50 para abajo baja, de 50 para arriba sube', () => {
    expect(redondearPrecio(12349)).toBe(12300);
    expect(redondearPrecio(12350)).toBe(12400);
    expect(redondearPrecio(20449)).toBe(20400);
    expect(redondearPrecio(20450)).toBe(20500);
  });
  it('los precios chicos quedan como están: $45 no puede volverse $0 ni $100', () => {
    expect(redondearPrecio(45)).toBe(45);
    expect(redondearPrecio(99)).toBe(99);
    expect(redondearPrecio(100)).toBe(100);
  });
  it('cero o negativo → 0', () => {
    expect(redondearPrecio(0)).toBe(0);
    expect(redondearPrecio(-10)).toBe(0);
  });
});

describe('precioDesdeCosto (regla de oro: % sobre el costo de la entrada)', () => {
  it('aplica el margen porcentual y redondea a la centena', () => {
    expect(precioDesdeCosto(1000, 35)).toBe(1400); // 1.350 → 1.400
    expect(precioDesdeCosto(1481.6, 40)).toBe(2100); // 2.074,24 → 2.100
    expect(precioDesdeCosto(2000, 35)).toBe(2700); // 2.700 exacto, no se mueve
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
