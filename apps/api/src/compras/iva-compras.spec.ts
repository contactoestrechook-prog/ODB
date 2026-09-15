// La cuenta del IVA de las facturas de compra vive en el panel
// (apps/admin/app/lib/iva-compras.ts) porque se recalcula en vivo mientras se
// edita la factura. Se prueba acá porque la API es la que tiene los tests.
// Regla: el IVA de los renglones tiene que dar el IVA del pie. Si no, no se
// registra: nunca más un promedio en silencio.
import { repartirIva, costoConIva, toleranciaIva } from '../../../admin/app/lib/iva-compras';

// Factura real Distri Sur 00007-00045458 (15/9/2026): netos de cada renglón.
const DISTRI_SUR = [
  { d: 'Tom.Triturado', neto: 40103.82 },
  { d: 'Nutella', neto: 40475.04 },
  { d: 'Garbanzo', neto: 14955.36 },
  { d: 'Mayonesa Heinz', neto: 17275.3 },
  { d: 'Lentejon', neto: 15947.4, impresa: 10.5 },
  { d: 'Ferrero 60', neto: 49649.4 },
  { d: 'Mini Arrocitas', neto: 12261.24 },
  { d: 'Azafran', neto: 56116.44 },
  { d: 'Tostadas Gruesas', neto: 9639.07 },
  { d: 'Arrocitas', neto: 20699.88 },
  { d: 'Mini Arrocitas choc', neto: 12499.17 },
  { d: 'Tostadas Finas', neto: 18813.84 },
  { d: 'Merenguito', neto: 14599.08 },
];
const PIE = { neto: 323035.04, iva: 66162.88, percepcionesAlCosto: 9451.84 + 16151.75, impuestosInternos: 0 };

describe('repartirIva — el IVA de cada renglón tiene que dar el del pie', () => {
  it('Distri Sur: 21% general + lentejón impreso al 10,5 cierra al centavo', () => {
    const r = repartirIva(DISTRI_SUR.map((x) => ({ neto: x.neto, alicuotaImpresa: x.impresa ?? null })), PIE);
    expect(r.estado).toBe('cierra');
    if (r.estado !== 'cierra') return;
    expect(r.alicuotas[4]).toBe(10.5);
    expect(r.alicuotas[0]).toBe(21);
    expect(Math.abs(r.diferencia)).toBeLessThanOrEqual(0.01);
    // el tomate: $2.228 por unidad + 21% + percepciones 7,93%
    expect(costoConIva(40103.82 / 18, r.alicuotas[0], r.factorNeto, r.cargaComunPct)).toBeCloseTo(2872.46, 1);
    // el lentejón NO paga IVA del 21
    expect(costoConIva(15947.4 / 10, r.alicuotas[4], r.factorNeto, r.cargaComunPct)).toBeCloseTo(1888.59, 1);
  });

  it('si la lectura no trajo el 10,5 del lentejón, NO registra: no cierra y sugiere el cambio exacto', () => {
    const r = repartirIva(DISTRI_SUR.map((x) => ({ neto: x.neto })), PIE);
    expect(r.estado).toBe('no_cierra');
    if (r.estado !== 'no_cierra') return;
    expect(r.diferencia).toBeCloseTo(-1674.48, 1); // los renglones suman IVA de más
    expect(r.sugerencias).toEqual([{ indices: [4], alicuota: 10.5 }]);
  });

  it('si la lectura tomó "21" impreso donde decía 10,5, también lo encuentra', () => {
    const r = repartirIva(DISTRI_SUR.map((x) => ({ neto: x.neto, alicuotaImpresa: 21 })), PIE);
    expect(r.estado).toBe('no_cierra');
    if (r.estado !== 'no_cierra') return;
    expect(r.sugerencias).toEqual([{ indices: [4], alicuota: 10.5 }]);
  });

  it('lo que elige una persona manda sobre lo impreso, y con eso cierra', () => {
    const renglones = DISTRI_SUR.map((x, i) => ({ neto: x.neto, alicuotaImpresa: 21, alicuotaElegida: i === 4 ? 10.5 : null }));
    const r = repartirIva(renglones, PIE);
    expect(r.estado).toBe('cierra');
    if (r.estado === 'cierra') expect(r.origenes[4]).toBe('elegida');
  });

  it('el catálogo se usa cuando la fila no imprime alícuota', () => {
    const renglones = DISTRI_SUR.map((x, i) => ({ neto: x.neto, alicuotaCatalogo: i === 4 ? 10.5 : 21 }));
    const r = repartirIva(renglones, PIE);
    expect(r.estado).toBe('cierra');
    if (r.estado === 'cierra') expect(r.origenes[4]).toBe('catalogo');
  });

  it('un renglón chico al 10,5 tomado como 21 igual salta (no se lo come la tolerancia)', () => {
    // 50 renglones de $10.000 al 21% + uno de $1.000 al 10,5%
    const netos = [...Array(50).fill(10000), 1000];
    const iva = 50 * 10000 * 0.21 + 1000 * 0.105;
    const r = repartirIva(netos.map((n) => ({ neto: n })), { neto: 501000, iva, percepcionesAlCosto: 0, impuestosInternos: 0 });
    expect(r.estado).toBe('no_cierra');
    expect(toleranciaIva(51, iva)).toBeLessThan(105);
  });

  it('una alícuota que no existe (un "12" mal leído) se rechaza', () => {
    const r = repartirIva([{ neto: 1000, alicuotaImpresa: 12 }], { neto: 1000, iva: 120, percepcionesAlCosto: 0, impuestosInternos: 0 });
    expect(r).toEqual({ estado: 'alicuota_invalida', indices: [0] });
  });

  it('sin neto o sin IVA en el pie no hay contra qué verificar: no se registra', () => {
    expect(repartirIva([{ neto: 1000 }], { neto: null, iva: 210, percepcionesAlCosto: 0, impuestosInternos: 0 }).estado).toBe('falta_pie');
    expect(repartirIva([{ neto: 1000 }], { neto: 1000, iva: null, percepcionesAlCosto: 0, impuestosInternos: 0 }).estado).toBe('falta_pie');
  });

  it('descuento en el pie: el neto del pie es menor que los renglones y el IVA se calcula sobre lo que se paga', () => {
    // renglones $10.000, descuento del pie 10% → neto $9.000, IVA 21% $1.890
    const r = repartirIva([{ neto: 6000 }, { neto: 4000 }], { neto: 9000, iva: 1890, percepcionesAlCosto: 0, impuestosInternos: 0 });
    expect(r.estado).toBe('cierra');
    if (r.estado === 'cierra') {
      expect(r.factorNeto).toBeCloseTo(0.9, 5);
      expect(costoConIva(100, 21, r.factorNeto, 0)).toBeCloseTo(108.9, 2);
    }
  });

  it('factura toda al 27% (servicios) cierra con la alícuota impresa', () => {
    const r = repartirIva([{ neto: 5000, alicuotaImpresa: 27 }], { neto: 5000, iva: 1350, percepcionesAlCosto: 0, impuestosInternos: 0 });
    expect(r.estado).toBe('cierra');
  });
});

describe('repartirIva — sugerencias cuando una persona eligió mal', () => {
  it('si alguien pasó el lentejón a 21 a mano, igual sugiere volver al 10,5 (sin cambiarlo solo)', () => {
    const renglones = DISTRI_SUR.map((x, i) => ({ neto: x.neto, alicuotaImpresa: x.impresa ?? null, alicuotaElegida: i === 4 ? 21 : null }));
    const r = repartirIva(renglones, PIE);
    expect(r.estado).toBe('no_cierra');
    if (r.estado !== 'no_cierra') return;
    expect(r.origenes[4]).toBe('elegida');
    expect(r.alicuotas[4]).toBe(21); // no se tocó
    expect(r.sugerencias).toEqual([{ indices: [4], alicuota: 10.5 }]);
  });
});
