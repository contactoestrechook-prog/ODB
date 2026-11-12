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
