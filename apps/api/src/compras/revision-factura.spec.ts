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
    // la leche de la sigla: hasta el 19/11 preguntaba («ultra»); «LS» es La Serenísima
    expect(revisarAntesDeRegistrar([{ ...base, renglon: 3, descripcion: 'LECHE LS ULTRA ENTERA 3% FORT SACHET 1L', producto: 'Leche La Serenisima 3% clasica  sachet  x 1l' }])).toEqual([]);
    const leche = { ...base, renglon: 3, descripcion: 'LECHE ULTRA ENTERA 3% FORT SACHET 1L', producto: 'Leche Sancor 3% clasica  sachet  x 1l' };
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
  // 19/11/2026, Distri-Sur 00007-00060714: 47 minutos sin poder registrar.
  it('Ferrero de regalo + pagos: el partido se mira sobre el producto entero', () => {
    const t8 = { descripcion: 'Bocadito Ferrero Rocher T8 UNIDAD x 12.5grs', producto: 'Ferrero Rocher x 8 un', sku: 'L4467', entra: true };
    // 6 de regalo (0,75 caja) + 42 pagas (5,25) = 6 cajas: así entran al stock
    expect(revisarAntesDeRegistrar([{ ...t8, renglon: 17, cantidad: 0.75 }, { ...t8, renglon: 19, cantidad: 5.25 }])).toEqual([]);
    const t24 = { descripcion: 'Bocadito Ferrero Rocher T24 UNIDAD x 12.5grs', producto: 'Ferrero Rocher x 24 unidades', sku: 'L7484', entra: true };
    expect(revisarAntesDeRegistrar([{ ...t24, renglon: 15, cantidad: 0.5 }, { ...t24, renglon: 16, cantidad: 3.5 }])).toEqual([]);
    // si la suma tampoco da entera, un solo aviso que nombra los dos renglones
    const a = revisarAntesDeRegistrar([{ ...t8, renglon: 17, cantidad: 0.75 }, { ...t8, renglon: 19, cantidad: 5 }]);
    expect(a).toHaveLength(1);
    expect(a[0].texto).toBe('Renglones 17 y 19: entran 0,75 + 5 = 5,75 de «Ferrero Rocher x 8 un». Algo que se vende por unidad no entra partido: revisá cómo entra (unidades, cajas, paquetes).');
    // un renglón que no entra no suma
    expect(revisarAntesDeRegistrar([{ ...t8, renglon: 17, cantidad: 0.75, entra: false }, { ...t8, renglon: 19, cantidad: 5.25 }]).map((x) => x.texto)).toEqual([
      'Renglón 19: entran 5,25 de «Ferrero Rocher x 8 un». Algo que se vende por unidad no entra partido: revisá cómo entra (unidades, cajas, paquetes).',
    ]);
  });
  it('la marca: lo que preguntaba de mentira en la misma factura', () => {
    expect(revisarAntesDeRegistrar([{ ...base, renglon: 20, descripcion: 'Garbanzo UNIDAD X 350grs. Inca', producto: 'Garbanzos INCA  x lata 350g' }])).toEqual([]);
    expect(revisarAntesDeRegistrar([{ ...base, renglon: 21, descripcion: 'Nachos Rest. Style UNIDAD x 250gr. Macricas', producto: 'Nachos Macritas  Extra Grandes 250grs' }])).toEqual([]);
    // la que el lector leyó mal («Varillas Pezz») se sigue preguntando
    expect(revisarAntesDeRegistrar([{ ...base, renglon: 7, descripcion: 'Varillas Pezz 8 X 444 Grs (36U)', producto: 'Vainillas Pozo 36 Unid  444gr' }]).map((x) => x.tipo)).toEqual(['marca']);
  });
  it('lo que no entra al stock o no tiene producto no se revisa', () => {
    expect(revisarAntesDeRegistrar([{ renglon: 1, descripcion: 'Alfajor Jorgito', producto: 'Alfajor Cachafaz', entra: false, cantidad: 0.5 }])).toEqual([]);
    expect(revisarAntesDeRegistrar([{ renglon: 1, descripcion: 'Alfajor Jorgito', producto: null, entra: true, cantidad: 0.5 }])).toEqual([]);
  });
});
