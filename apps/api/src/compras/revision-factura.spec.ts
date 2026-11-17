// ANTES DE REGISTRAR (10/11/2026): los casos reales del 9/11. La regla vive en
// el panel (apps/admin/app/lib/revision-factura.ts).
import { revisarAntesDeRegistrar } from '../../../admin/app/lib/revision-factura';

const base = { entra: true, cantidad: 18 };

describe('antes de registrar', () => {
  it('Jorgito vinculado a Cachafaz: otra marca', () => {
    const a = revisarAntesDeRegistrar([{ ...base, renglon: 4, descripcion: 'Alfajor Jorgito Chocolate Negro 18 x 6U', producto: 'Alfajor Cachafaz  Chocolate Negro x 6u' }]);
    expect(a.map((x) => x.tipo)).toEqual(['marca']);
    expect(a[0].texto).toContain('«jorgito»');
  });
  // 17/11/2026: en dos facturas de La Serenísima Ana contestó «está bien» 16 veces
  // por artículos que ya había registrado igual hasta cinco veces.
  it('la marca no se vuelve a preguntar por lo que ya se registró igual dos veces', () => {
    const leche = { ...base, renglon: 3, descripcion: 'LECHE LS ULTRA ENTERA 3% FORT SACHET 1L', producto: 'Leche La Serenisima 3% clasica  sachet  x 1l' };
    expect(revisarAntesDeRegistrar([leche]).map((x) => x.tipo)).toEqual(['marca']);
    expect(revisarAntesDeRegistrar([{ ...leche, vecesRegistradoAsi: 1 }]).map((x) => x.tipo)).toEqual(['marca']);
    expect(revisarAntesDeRegistrar([{ ...leche, vecesRegistradoAsi: 2 }])).toEqual([]);
    expect(revisarAntesDeRegistrar([{ ...leche, vecesRegistradoAsi: 5 }])).toEqual([]);
    // un vínculo que nunca se registró así se sigue preguntando (la leche en sachet vinculada a una en polvo)
    const mal = { ...base, renglon: 1, descripcion: 'LECHE LS ULTRA DESC PROTEIN S1L', producto: 'Leche En Polvo Protein LS x 400g', vecesRegistradoAsi: 0 };
    expect(revisarAntesDeRegistrar([mal]).map((x) => x.tipo)).toEqual(['marca']);
    // y lo demás se controla igual aunque ya se haya registrado así: el costo y el precio
    const caro = { ...leche, vecesRegistradoAsi: 5, costoNuevo: 5000, costoCatalogo: 1500 };
    expect(revisarAntesDeRegistrar([caro]).map((x) => x.tipo)).toEqual(['costo']);
  });
  it('Terrabusi: el precio de venta bajaba de $10.800 a $4.500', () => {
    const a = revisarAntesDeRegistrar([{ ...base, renglon: 5, descripcion: 'Alfajor Terrabusi Blanco glaseado', producto: 'Alfajor Terrabusi Blanco glaseado x 6', precioNuevo: 4500, precioActual: 10800 }]);
    expect(a.map((x) => x.tipo)).toEqual(['precio']);
    expect(a[0].texto).toContain('de $10.800 a $4.500 (-58 %)');
  });
  it('Rhodesia: 0,333 paquetes no entra; por peso sí puede ser partido', () => {
    const r = { renglon: 15, descripcion: 'RHODESIA CLASICA 36 X22G', producto: 'Galletitas Rhodesia x 3u', entra: true };
    expect(revisarAntesDeRegistrar([{ ...r, cantidad: 0.333 }]).map((x) => x.tipo)).toEqual(['cantidad']);
    expect(revisarAntesDeRegistrar([{ ...r, cantidad: 12 }])).toEqual([]);
    expect(revisarAntesDeRegistrar([{ ...r, cantidad: 2.35, porPeso: true }])).toEqual([]);
  });
  it('el costo: más del doble o menos de la mitad', () => {
    const r = { ...base, renglon: 1, descripcion: 'RHODESIA CLASICA x 3', producto: 'Galletitas Rhodesia x 3u', costoCatalogo: 2540 };
    expect(revisarAntesDeRegistrar([{ ...r, costoNuevo: 27883 }]).map((x) => x.tipo)).toEqual(['costo']);
    expect(revisarAntesDeRegistrar([{ ...r, costoNuevo: 2997 }])).toEqual([]);
  });
  it('lo que no entra al stock o no tiene producto no se revisa', () => {
    expect(revisarAntesDeRegistrar([{ renglon: 1, descripcion: 'Alfajor Jorgito', producto: 'Alfajor Cachafaz', entra: false, cantidad: 0.5 }])).toEqual([]);
    expect(revisarAntesDeRegistrar([{ renglon: 1, descripcion: 'Alfajor Jorgito', producto: null, entra: true, cantidad: 0.5 }])).toEqual([]);
  });
});
