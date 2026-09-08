import { parsearCodigoBalanza, cantidadDeBalanza } from './balanza';

describe('etiquetas de la balanza', () => {
  it('lee PLU y gramos del pan al peso (etiqueta real)', () => {
    expect(parsearCodigoBalanza('2003931002905')).toEqual({ plu: '3931', valor: 290 });
    expect(cantidadDeBalanza(290, true)).toBe(0.29);
  });
  it('lee PLU y unidades de la torta matera (etiqueta real)', () => {
    expect(parsearCodigoBalanza('2012717000011')).toEqual({ plu: '12717', valor: 1 });
    expect(cantidadDeBalanza(1, false)).toBe(1);
  });
  it('rechaza un código con el dígito de control mal, y los que no son de balanza', () => {
    expect(parsearCodigoBalanza('2003931002904')).toBeNull();
    expect(parsearCodigoBalanza('7790520995292')).toBeNull();
    expect(parsearCodigoBalanza('3931')).toBeNull();
  });
});
