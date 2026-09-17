// El pie de la factura de compra: qué falta, qué sobra y el arreglo de un click.
// La lógica vive en el panel (apps/admin/app/lib/pie-factura.ts); se prueba acá.
import { diagnosticarPie, faltantesHabituales, montoPorPct } from '../../../admin/app/lib/pie-factura';

// Cabaña Piedras Blancas 0013-00007539 (17/9/2026), tal cual se leyó
const CABANA = { neto: 309543.05, iva: 65004.05, percepcionIva: 9286.29, percepcionIibb: null, impuestosInternos: null, otros: null, total: 383833.39 };

describe('diagnosticarPie', () => {
  it('Cabaña Piedras Blancas cierra: no hay nada que arreglar', () => {
    const d = diagnosticarPie(CABANA);
    expect(d.cierra).toBe(true);
    expect(d.arreglos).toEqual([]);
  });

  it('falta la percepción de IIBB 5%: la sugiere con el monto exacto', () => {
    const neto = 331076;
    const pie = { neto, iva: neto * 0.21, percepcionIva: neto * 0.03, percepcionIibb: null, impuestosInternos: null, otros: null, total: neto * 1.29 };
    const d = diagnosticarPie(pie);
    expect(d.cierra).toBe(false);
    expect(d.arreglos[0]).toMatchObject({ campo: 'percepcionIibb', accion: 'agregar' });
    expect(d.arreglos[0].monto).toBeCloseTo(neto * 0.05, 1);
    expect(d.arreglos[0].pct).toBeCloseTo(5, 2);
    // siempre queda la salida de "otros"
    expect(d.arreglos.at(-1)?.campo).toBe('otros');
  });

  it('con el hábito del proveedor, la sugerencia lo dice', () => {
    const neto = 100000;
    const pie = { neto, iva: 21000, percepcionIva: 3000, percepcionIibb: null, impuestosInternos: null, otros: null, total: 129320 };
    const d = diagnosticarPie(pie, { facturas: 3, percepcionIva: 3, percepcionIibb: 5.32, impuestosInternos: 0 });
    expect(d.arreglos[0].campo).toBe('percepcionIibb');
    expect(d.arreglos[0].motivo).toMatch(/siempre cobra/);
  });

  it('una percepción leída dos veces (sobra justo ese monto): ofrece quitarla', () => {
    const pie = { ...CABANA, otros: 9286.29 };
    const d = diagnosticarPie(pie);
    expect(d.cierra).toBe(false);
    expect(d.arreglos[0].campo).toBe('otros');
    expect(d.arreglos.map((a) => a.campo)).toEqual(expect.arrayContaining(['percepcionIva', 'otros']));
    expect(d.arreglos.every((a) => a.accion === 'quitar' && a.monto === 0)).toBe(true);
  });

  it('IVA sin leer: lo propone', () => {
    const pie = { neto: 50000, iva: null, percepcionIva: null, percepcionIibb: null, impuestosInternos: null, otros: null, total: 60500 };
    expect(diagnosticarPie(pie).arreglos[0]).toMatchObject({ campo: 'iva', monto: 10500 });
  });

  it('sin total o sin neto no inventa nada', () => {
    expect(diagnosticarPie({ ...CABANA, total: null }).arreglos).toEqual([]);
  });
});

describe('faltantesHabituales y montoPorPct', () => {
  it('avisa lo que el proveedor cobra siempre y esta factura no trae', () => {
    expect(faltantesHabituales(CABANA, { facturas: 3, percepcionIva: 3, percepcionIibb: 5, impuestosInternos: 0 })).toEqual([{ campo: 'percepcionIibb', pct: 5 }]);
    expect(faltantesHabituales(CABANA, { facturas: 1, percepcionIva: 3, percepcionIibb: 5, impuestosInternos: 0 })).toEqual([]);
  });
  it('5% de $309.543,05', () => {
    expect(montoPorPct(309543.05, 5)).toBe(15477.15);
  });
});
