import { lunesDe, nombrePersona, repartir, semanasDelMes } from './plan-conteo';

describe('semanas del plan', () => {
  it('el lunes de cualquier día', () => {
    expect(lunesDe('2026-10-24')).toBe('2026-10-19'); // sábado
    expect(lunesDe('2026-10-19')).toBe('2026-10-19'); // lunes
    expect(lunesDe('2026-10-25')).toBe('2026-10-19'); // domingo
  });
  it('octubre 2026 arranca jueves 1: semanas del 28/9 al 26/10', () => {
    expect(semanasDelMes('2026-10')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  });
  it('febrero 2027', () => {
    expect(semanasDelMes('2027-02')).toEqual(['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']);
  });
  it('un mes mal escrito no pasa', () => {
    expect(() => semanasDelMes('octubre')).toThrow();
  });
});

describe('repartir', () => {
  const semanas = ['2026-10-19', '2026-10-26'];
  it('reparte parejo por productos y primero lo que nunca se contó', () => {
    const r = repartir([
      { id: 'vinos', productos: 300, diasSinContar: 10 },
      { id: 'aguas', productos: 20, diasSinContar: null },
      { id: 'fideos', productos: 40, diasSinContar: 60 },
      { id: 'gin', productos: 30, diasSinContar: 5 },
    ], semanas, ['Ale', 'Guada']);
    expect(r.map((x) => x.categoriaId)).toEqual(['aguas', 'fideos', 'vinos', 'gin']);
    // cada rubro una sola vez; lo que nunca se contó va a la primera semana
    expect(new Set(r.map((x) => x.categoriaId)).size).toBe(4);
    expect(r.find((x) => x.categoriaId === 'aguas')!.semana).toBe('2026-10-19');
    // las dos semanas y las dos personas se usan
    expect(new Set(r.map((x) => x.semana)).size).toBe(2);
    expect(new Set(r.map((x) => x.persona)).size).toBe(2);
  });
  it('sin semanas o sin personas no asigna nada', () => {
    expect(repartir([{ id: 'x', productos: 1, diasSinContar: null }], [], ['Ale'])).toEqual([]);
    expect(repartir([{ id: 'x', productos: 1, diasSinContar: null }], semanas, [])).toEqual([]);
  });
});

describe('nombrePersona', () => {
  it('prolijo', () => {
    expect(nombrePersona('  ale  ')).toBe('Ale');
    expect(nombrePersona('belén   gómez')).toBe('Belén gómez');
    expect(nombrePersona('')).toBe('');
  });
});
