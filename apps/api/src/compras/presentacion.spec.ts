// La unidad en la que entra cada renglón al stock (apps/admin/app/lib/presentacion.ts):
// la factura y el catálogo no hablan el mismo idioma.
import { conversionSugerida, gramosDeEnvase, unidadesDeEnvase } from '../../../admin/app/lib/presentacion';

describe('presentación del producto', () => {
  it('unidades por envase', () => {
    expect(unidadesDeEnvase('Ferrero Rocher x 12 un')).toBe(12);
    expect(unidadesDeEnvase('Ferrero Rocher T24')).toBe(24);
    expect(unidadesDeEnvase('Azafran Alicante Blister 2U x2Grs')).toBe(2);
    expect(unidadesDeEnvase('Galletitas x 12.5 gr')).toBeNull();
  });

  it('gramos del paquete', () => {
    expect(gramosDeEnvase('Langostino pelado crudo x 250 grs')).toBe(250);
    expect(gramosDeEnvase('Milanesa de merluza x 500g')).toBe(500);
    expect(gramosDeEnvase('Carne picada x 1 kg')).toBe(1000);
    expect(gramosDeEnvase('Leche La Serenisima 3% sachet x 1lt')).toBeNull();
  });
});

describe('conversionSugerida', () => {
  // Congelados (Leandro, 15/9/2026): "LANG. PELADO CRUDO x 250 grs (RETAIL)"
  // 5 × $18.210 = $91.050. El precio y la cantidad son por KILO; el producto
  // viene empaquetado de 250 g → 20 paquetes a $4.552,50.
  it('congelados: 5 kg a $18.210 el kilo = 20 paquetes de 250 g a $4.552,50', () => {
    const c = conversionSugerida({
      descripcion: 'LANG. PELADO CRUDO x 250 grs (RETAIL)',
      nombreCatalogo: 'Langostino pelado crudo x 250 grs',
      cantidad: 5,
      precio: 18210,
      costoCatalogo: 4400,
    });
    expect(c?.tipo).toBe('kilo_a_paquete');
    expect(c?.cantidadNueva).toBe(20);
    expect(c?.precioNuevo).toBe(4552.5);
  });

  it('congelados sin costo en el catálogo: igual lo propone si el paquete divide al kilo', () => {
    const c = conversionSugerida({
      descripcion: 'MERLUZA FILET x 500 grs',
      nombreCatalogo: 'Merluza filet x 500 grs',
      cantidad: 3,
      precio: 9000,
    });
    expect(c?.tipo).toBe('kilo_a_paquete');
    expect(c?.cantidadNueva).toBe(6);
    expect(c?.precioNuevo).toBe(4500);
  });

  it('si el precio ya es el del paquete (coincide con el costo), no propone nada', () => {
    const c = conversionSugerida({
      descripcion: 'LANG. PELADO CRUDO x 250 grs',
      nombreCatalogo: 'Langostino pelado crudo x 250 grs',
      cantidad: 20,
      precio: 4552.5,
      costoCatalogo: 4400,
    });
    expect(c).toBeNull();
  });

  it('Ferrero: 60 bocaditos = 5 cajas de 12', () => {
    const c = conversionSugerida({
      descripcion: 'Bocadito Ferrero Rocher T12 UNIDAD x12.5grs',
      nombreCatalogo: 'Ferrero Rocher x 12 un',
      cantidad: 60,
      precio: 827.49,
      costoCatalogo: 9500,
    });
    expect(c?.tipo).toBe('unidades_a_envase');
    expect(c?.cantidadNueva).toBe(5);
    expect(c?.precioNuevo).toBe(9929.88);
  });

  it('un producto que ya viene en su unidad no se toca', () => {
    expect(conversionSugerida({
      descripcion: 'Nutella UNIDAD x350grs',
      nombreCatalogo: 'Nutella x 350 gr',
      cantidad: 6,
      precio: 6745.84,
      costoCatalogo: 6700,
    })).toBeNull();
  });

  it('sin producto vinculado no propone nada', () => {
    expect(conversionSugerida({ descripcion: 'X', nombreCatalogo: null, cantidad: 5, precio: 100 })).toBeNull();
  });
});
