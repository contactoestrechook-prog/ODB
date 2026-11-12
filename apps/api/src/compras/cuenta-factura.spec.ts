// LA CUENTA DE LA FACTURA (9/11/2026). La regla vive en el panel
// (apps/admin/app/lib/cuenta-factura.ts); se prueba acá, como IVA e internos.
// Caso real: la factura con la Mayonesa Natura en negativo. Neto 1.767.443 +
// IVA 371.163 + percepciones 141.395 = 2.280.002. El panel decía «el costo a
// stock supera el valor de la mercadería» porque comparaba lo que entra (sin
// la devolución) contra un pie que ya la tenía restada.
import { cuentaDeLaFactura, cuentaParaIA, sospechososDe, toleranciaDe } from '../../../admin/app/lib/cuenta-factura';

const RECARGO = 2280002 / 1767443; // IVA + percepciones sobre el neto: 1,29

describe('la cuenta de la factura', () => {
  it('con una devolución en negativo cierra: lo devuelto se resta, no traba', () => {
    const c = cuentaDeLaFactura({
      total: 2280002,
      partes: [
        { renglon: 1, descripcion: 'mercadería', tipo: 'entra', valor: 2292793 },
        { renglon: 7, descripcion: 'MAYONESA NATURA D/P 500 GRS', tipo: 'devuelto', valor: -9917 * RECARGO },
      ],
    });
    expect(c.estado).toBe('cierra');
    expect(c.lineas.map((l) => l.clave)).toEqual(['entra', 'devuelto']);
    expect(Math.abs(c.diferencia!)).toBeLessThan(5);
  });

  it('si falta un renglón, dice cuánto y cuál es el sospechoso', () => {
    const c = cuentaDeLaFactura({
      total: 100000,
      partes: [
        { renglon: 1, descripcion: 'A', tipo: 'entra', valor: 60000 },
        { renglon: 2, descripcion: 'B', tipo: 'no_entra', valor: 0 },
        { renglon: 3, descripcion: 'C', tipo: 'entra', valor: 25000 },
      ],
    });
    expect(c.estado).toBe('no_cierra');
    expect(c.diferencia).toBe(15000);
    expect(c.mensaje).toContain('La factura cobra $15.000 más');
  });

  it('un renglón leído dos veces se señala por su valor exacto', () => {
    const c = cuentaDeLaFactura({
      total: 85000,
      partes: [
        { renglon: 1, descripcion: 'A', tipo: 'entra', valor: 60000 },
        { renglon: 2, descripcion: 'B', tipo: 'entra', valor: 12000 },
        { renglon: 3, descripcion: 'C', tipo: 'entra', valor: 25000 },
      ],
    });
    expect(c.estado).toBe('no_cierra');
    expect(c.sospechosos).toEqual([2]);
    expect(c.mensaje).toContain('renglones suman $12.000 más');
  });

  it('lo destildado, lo que volvió y lo que faltó también lo cobra la factura', () => {
    const c = cuentaDeLaFactura({
      total: 1000,
      partes: [
        { renglon: 1, descripcion: 'A', tipo: 'entra', valor: 500 },
        { renglon: 2, descripcion: 'B', tipo: 'no_entra', valor: 200 },
        { renglon: 3, descripcion: 'C', tipo: 'volvio', valor: 100 },
        { renglon: 4, descripcion: 'D', tipo: 'entra', valor: 150 },
        { renglon: 4, descripcion: 'D', tipo: 'falto', valor: 50 },
      ],
    });
    expect(c.estado).toBe('cierra');
    expect(c.lineas.find((l) => l.clave === 'entra')!.renglones).toEqual([1, 4]);
  });

  it('el pie: percepciones fuera del costo y otros cargos suman; el exceso a propósito resta', () => {
    const c = cuentaDeLaFactura({
      total: 1290,
      partes: [{ renglon: 1, descripcion: 'A', tipo: 'entra', valor: 1210 + 20 }],
      percepcionesFueraDelCosto: 50,
      otrosDelPie: 30,
      excesoPercepciones: 20,
    });
    expect(c.estado).toBe('cierra');
    expect(c.calculado).toBe(1290);
  });

  it('una diferencia aceptada con motivo no traba, pero solo si sigue siendo la misma', () => {
    const base = { total: 10000, partes: [{ renglon: 1, descripcion: 'A', tipo: 'entra' as const, valor: 9000 }] };
    expect(cuentaDeLaFactura({ ...base, aceptada: { monto: 1000, motivo: 'flete que no figura en el pie' } }).estado).toBe('aceptada');
    // sin motivo no vale
    expect(cuentaDeLaFactura({ ...base, aceptada: { monto: 1000, motivo: ' ' } }).estado).toBe('no_cierra');
    // cambió la factura: la aceptación vieja ya no alcanza
    expect(cuentaDeLaFactura({ ...base, total: 12000, aceptada: { monto: 1000, motivo: 'flete' } }).estado).toBe('no_cierra');
  });

  it('sin total leído no inventa: lo pide', () => {
    const c = cuentaDeLaFactura({ total: null, partes: [{ renglon: 1, descripcion: 'A', tipo: 'entra', valor: 10 }] });
    expect(c.estado).toBe('sin_total');
    expect(c.mensaje).toContain('cargalo en el pie');
  });

  it('redondeo: medio por ciento, nunca menos de $5', () => {
    expect(toleranciaDe(100)).toBe(5);
    expect(toleranciaDe(2280002)).toBeCloseTo(11400.01, 1);
  });

  it('sospechosos: sin uno exacto, el de valor más parecido; si nada se parece, ninguno', () => {
    const partes = [
      { renglon: 1, descripcion: 'A', tipo: 'entra' as const, valor: 50000 },
      { renglon: 2, descripcion: 'B', tipo: 'entra' as const, valor: 8000 },
    ];
    expect(sospechososDe(partes, 6000)).toEqual([2]);
    expect(sospechososDe(partes, 300)).toEqual([]);
  });

  it('el chat recibe los mismos números que ve la persona', () => {
    const ia = cuentaParaIA(cuentaDeLaFactura({ total: 100, partes: [{ renglon: 1, descripcion: 'A', tipo: 'entra', valor: 100 }] }));
    expect(ia).toMatchObject({ estado: 'cierra', totalDeLaFactura: 100, sumaDeLasLineas: 100, lineas: [{ que: 'Entra al stock', monto: 100, renglones: [1] }] });
  });
});
