import { volumenEnNombre, validarEnriquecimiento, esPorPeso } from './confianza';

describe('esPorPeso (gramos/kilos no son volumen)', () => {
  it('detecta productos por peso', () => {
    expect(esPorPeso('Alfajor One LOVE X 60G')).toBe(true);
    expect(esPorPeso('chimichurri Alcaraz x310gr')).toBe(true);
    expect(esPorPeso('Bresaola feteada x peso')).toBe(true);
    expect(esPorPeso('Yerba 1kg')).toBe(true);
  });
  it('no marca por peso a los líquidos', () => {
    expect(esPorPeso('Alamos Malbec x750cc')).toBe(false);
    expect(esPorPeso('Coca 500ml')).toBe(false);
  });
});

describe('volumenEnNombre (parseo, no adivinanza)', () => {
  it('lee cc/ml del nombre', () => {
    expect(volumenEnNombre('Alamos Malbec x750cc')).toBe(750);
    expect(volumenEnNombre('Cerveza Harry Potter x473cc')).toBe(473);
    expect(volumenEnNombre('Coca 500 ML')).toBe(500);
  });
  it('convierte litros a ml', () => {
    expect(volumenEnNombre('Agua 1.5 L')).toBe(1500);
    expect(volumenEnNombre('Vino 1 litro')).toBe(1000);
  });
  it('null si no hay volumen', () => {
    expect(volumenEnNombre('Alamos Reserve Malbec')).toBeNull();
  });
});

describe('validarEnriquecimiento (confianza por validadores, no por el número de la IA)', () => {
  it('eleva el piso cuando volumen+marca+varietal se verifican en el nombre', () => {
    const v = validarEnriquecimiento('Alamos Reserve Malbec x750cc', { marca: 'Alamos', varietal_o_tipo: 'Malbec', volumen_ml: 750, confianza: 0.5 });
    expect(v.volumenOk).toBe(true);
    expect(v.marcaOk).toBe(true);
    expect(v.varOk).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(0.85); // pisó hacia arriba pese a que la IA dijo 0.5
  });

  it('topea a 0.6 si la marca NO está en el nombre (aunque la IA diga 0.9)', () => {
    const v = validarEnriquecimiento('Cerveza Artesanal Harry Potter x473cc', { marca: 'Desconocida', varietal_o_tipo: 'IPA', volumen_ml: 473, confianza: 0.9 });
    expect(v.marcaOk).toBe(false);
    expect(v.score).toBeLessThanOrEqual(0.6); // no le creemos a la IA
    expect(v.volumenParseado).toBe(473); // el volumen sí es dato duro
  });

  it('topea a 0.4 si la graduación es disparatada', () => {
    const v = validarEnriquecimiento('Vino Raro', { marca: 'Vino', graduacion: 99, confianza: 0.8 });
    expect(v.score).toBeLessThanOrEqual(0.4);
  });
});
