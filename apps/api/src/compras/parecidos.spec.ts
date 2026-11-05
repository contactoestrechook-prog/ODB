// Parecidos (4/11/2026), con los nombres reales del catálogo de ODB.
import { cabezaDe, compararNombres, ordenarParecidos, palabrasDelNombre, prefijoDeFamilia, tamanoDe } from './parecidos';

describe('parecidos: la familia sale del nombre', () => {
  it('el tipo de producto es la cabeza: «pure de tomate», «azucar», «aceite de oliva»', () => {
    expect(cabezaDe(palabrasDelNombre('Pure de tomate Marolio x 520gr')).join(' ')).toBe('pure de tomate');
    expect(cabezaDe(palabrasDelNombre('Azucar Ledesma Light x 500g')).join(' ')).toBe('azucar');
    expect(cabezaDe(palabrasDelNombre('Aceite de oliva Lira Clasico lata 500ml')).join(' ')).toBe('aceite de oliva');
    expect(cabezaDe(palabrasDelNombre('Arroz Gallo largo fino x 500grs Bolsa')).join(' ')).toBe('arroz');
  });

  it('el prefijo trae también los plurales («Pure de tomates De La Huerta»)', () => {
    expect(prefijoDeFamilia('Pure de tomates De La Huerta x 530 gr')).toBe('pure de tomate');
    expect(prefijoDeFamilia('Pure de Tomate Arcor Tetra x 530 gr')).toBe('pure de tomate');
    expect(prefijoDeFamilia('Galletitas Variedad Dorada x 310grs')).toBe('galletita');
  });

  it('el tamaño y el envase no cuentan como palabras del producto', () => {
    expect(palabrasDelNombre('Arroz Gallo largo fino x 1 kg bolsa')).toEqual(['arroz', 'gallo', 'largo', 'fino']);
    expect(palabrasDelNombre('Agua Saborizada Terma Cuyano x1.35L')).toEqual(['agua', 'saborizada', 'terma', 'cuyano']);
    expect(palabrasDelNombre('azucar ligth  Hileret  x 250g')).toEqual(['azucar', 'light', 'hileret']);
  });

  it('lee el tamaño en gramos o mililitros', () => {
    expect(tamanoDe('Azucar Ledesma Comun x 1 kg')).toMatchObject({ cantidad: 1000, unidad: 'g', texto: '1 kg' });
    expect(tamanoDe('Azucar Ledesma Light x 500g')).toMatchObject({ cantidad: 500, unidad: 'g', texto: '500 g' });
    expect(tamanoDe('Agua Saborizada Terma Cuyano x1.35L')).toMatchObject({ cantidad: 1350, unidad: 'ml', texto: '1,35 L' });
    expect(tamanoDe('Jugo Baggio manzana x 200 cc')).toMatchObject({ cantidad: 200, unidad: 'ml' });
    expect(tamanoDe('Amargo Obrero')).toBeNull();
  });
});

describe('parecidos: qué tan parecido es', () => {
  it('el azúcar de 500 g y el de 1 kg son el mismo en otro tamaño (el caso de Leandro)', () => {
    expect(compararNombres('Azucar Ledesma Light x 500g', 'Azucar Ledesma LIGHT x 1 kg').relacion).toBe('otro_tamano');
    expect(compararNombres('Arroz Gallo largo fino x 500grs Bolsa', 'Arroz Gallo Largo Fino estuche x 1K').relacion).toBe('otro_tamano');
    expect(compararNombres('Aceite de oliva Lira Clasico lata 500ml', 'Aceite de oliva Lira Clasico pet 500ml').relacion).toBe('otro_tamano');
  });

  it('otra marca del mismo tipo es de la familia; si comparte marca o variedad, parecido', () => {
    expect(compararNombres('Pure de tomate Marolio x 520gr', 'Pure de tomate Molto x 520gr').relacion).toBe('familia');
    expect(compararNombres('Azucar Ledesma Light x 500g', 'Azucar Ledesma Comun x 1 kg')).toMatchObject({ relacion: 'parecido', coincidencias: 1 });
    expect(compararNombres('Azucar Ledesma Light x 500g', 'azucar ligth Hileret x 500g')).toMatchObject({ relacion: 'parecido', coincidencias: 1 });
  });

  it('ordena: primero el mismo en otro tamaño, después lo más parecido, y a igual parecido lo que tiene stock', () => {
    const base = 'Azucar Ledesma Light x 500g';
    const lista = [
      { nombre: 'Azucar Tikay x 1k', stockTotal: 1 },
      { nombre: 'Azucar Ledesma Comun x 1 kg', stockTotal: 140 },
      { nombre: 'Azucar Ledesma LIGHT x 1 kg', stockTotal: 0 },
      { nombre: 'Azucar Arcor comun', stockTotal: 7 },
    ].map((x) => ({ ...x, ...compararNombres(base, x.nombre) }));
    expect(ordenarParecidos(lista).map((x) => x.nombre)).toEqual([
      'Azucar Ledesma LIGHT x 1 kg', 'Azucar Ledesma Comun x 1 kg', 'Azucar Arcor comun', 'Azucar Tikay x 1k',
    ]);
  });
});
