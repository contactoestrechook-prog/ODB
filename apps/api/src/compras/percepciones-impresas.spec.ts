// La alícuota y la base de cada percepción salen del texto de su etiqueta
// (5/11/2026): como campos del esquema rompieron el lector.
import { alicuotaYBaseDeLaEtiqueta, numeroImpreso, percepcionesDelPie } from './percepciones-impresas';

describe('la alícuota y la base impresas de una percepción', () => {
  it('La Serenísima: 3 % sobre una base de $449.833,62 y 5 % sobre todo el neto', () => {
    expect(alicuotaYBaseDeLaEtiqueta('Percepción IVA CF | alicuota=3 | base=449833.62')).toEqual({ alicuota: 3, base: 449833.62, limpia: 'Percepción IVA CF' });
    expect(alicuotaYBaseDeLaEtiqueta('Per. IIBB BS AS | alicuota=5 | base=800707.62')).toEqual({ alicuota: 5, base: 800707.62, limpia: 'Per. IIBB BS AS' });
  });
  it('entiende los números como los imprime el papel', () => {
    expect(alicuotaYBaseDeLaEtiqueta('Perc IVA | alícuota: 3,00% | base imponible: $ 449.833,62')).toEqual({ alicuota: 3, base: 449833.62, limpia: 'Perc IVA' });
    expect(alicuotaYBaseDeLaEtiqueta('Perc IIBB | base=1.250 | alicuota=1,5').base).toBe(1250);
    expect(numeroImpreso('449,833.62')).toBe(449833.62);
    expect(numeroImpreso('1.5')).toBe(1.5);
    expect(numeroImpreso('')).toBe(0);
  });
  it('sin el agregado, o con algo que no es un porcentaje, queda en cero y la etiqueta no se toca', () => {
    expect(alicuotaYBaseDeLaEtiqueta('PER. DE IIBB')).toEqual({ alicuota: 0, base: 0, limpia: 'PER. DE IIBB' });
    expect(alicuotaYBaseDeLaEtiqueta('').alicuota).toBe(0);
    expect(alicuotaYBaseDeLaEtiqueta(null)).toEqual({ alicuota: 0, base: 0, limpia: '' });
    expect(alicuotaYBaseDeLaEtiqueta('Perc | alicuota=450 | base=10').alicuota).toBe(0);
  });
  it('deja los cuatro datos en el pie y la etiqueta limpia; sin etiquetas no rompe', () => {
    const datos: any = {
      impuestos: { neto: 800707.62, percepcionIva: 13495.01, percepcionIibb: 40035.38 },
      etiquetas: { percepcionIva: 'Percepción IVA CF | alicuota=3 | base=449833.62', percepcionIibb: 'Per. IIBB BS AS' },
    };
    percepcionesDelPie(datos);
    expect(datos.impuestos).toMatchObject({ percepcionIvaAlicuota: 3, percepcionIvaBase: 449833.62, percepcionIibbAlicuota: 0, percepcionIibbBase: 0 });
    expect(datos.etiquetas.percepcionIva).toBe('Percepción IVA CF');
    const sin: any = { impuestos: { neto: 1 } };
    percepcionesDelPie(sin);
    expect(sin.impuestos.percepcionIvaAlicuota).toBe(0);
    expect(() => percepcionesDelPie(null)).not.toThrow();
  });
});
