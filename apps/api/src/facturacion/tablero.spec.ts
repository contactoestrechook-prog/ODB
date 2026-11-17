import {
  comprobantesDeNucleo, cifras, cuadrar, diasDelMes, diasPromedio, leerTicket, medioLegible, mesAnterior, porDia, resumirMes,
  ticketsDelCrack, tramosDeDeuda, type RenglonCrack,
} from './tablero';

const r = (o: Partial<RenglonCrack>): RenglonCrack => ({
  cliente_id: 'c1', fecha: '2026-11-03', sucursal: 'st', ticket: 'FAC - A3-00000055', cantidad: 1, precio_unitario: 100, medio_pago: 'CTA. CTE.', ...o,
});

describe('leerTicket y medioLegible (lo que escribe el Crack)', () => {
  it('separa clase, letra y número', () => {
    expect(leerTicket('FAC - A3-00000055')).toEqual({ clase: 'factura', letra: 'A', numero: 'A3-00000055' });
    expect(leerTicket('NCR - R6-212')).toEqual({ clase: 'nc', letra: 'R', numero: 'R6-212' });
    expect(leerTicket('NDE - A-00000000').clase).toBe('nd');
    expect(leerTicket('AJUSTE').clase).toBe('interno');
  });
  it('pasa los medios a palabras comunes', () => {
    expect(medioLegible('CTA. CTE.')).toBe('Cuenta corriente');
    expect(medioLegible('MERCADO PAGO')).toBe('Mercado Pago');
    expect(medioLegible('CONTADO')).toBe('Contado');
    expect(medioLegible(null)).toBe('Sin dato');
  });
});

describe('ticketsDelCrack', () => {
  it('junta los renglones de un ticket y suma cantidad × precio', () => {
    const t = ticketsDelCrack([
      r({ cantidad: 2, precio_unitario: 150 }),
      r({ cantidad: '0.5', precio_unitario: '1000' }),
      r({ ticket: 'FAC - R3-139906', cantidad: 1, precio_unitario: 80, medio_pago: 'TARJETA' }),
    ]);
    expect(t).toHaveLength(2);
    const a = t.find((x) => x.letra === 'A')!;
    expect(a).toMatchObject({ total: 800, renglones: 2, tipo: 'Factura A', medio: 'Cuenta corriente', sucursal: 'st' });
  });
  it('la nota de crédito resta aunque el renglón venga en positivo', () => {
    const [nc] = ticketsDelCrack([r({ ticket: 'NCR - R6-212', cantidad: 1, precio_unitario: 500 })]);
    expect(nc.total).toBe(-500);
    const [nc2] = ticketsDelCrack([r({ ticket: 'NCR - R6-213', cantidad: -1, precio_unitario: 500 })]);
    expect(nc2.total).toBe(-500);
  });
  it('el mismo número otro día o de otro cliente es otro ticket', () => {
    expect(ticketsDelCrack([r({}), r({ fecha: '2026-11-04' }), r({ cliente_id: 'c2' })])).toHaveLength(3);
  });
});

describe('comprobantesDeNucleo', () => {
  it('numera estilo ARCA, ubica la sucursal por punto de venta y marca anulados', () => {
    const [c] = comprobantesDeNucleo(
      [{ id: 'x', tipo: 'NCB', punto_venta: 15, numero: 7, emitido_en: '2026-11-03T02:00:00Z', total: 300, estado: 'anulado', condicion_pago: 'cta_cte' }],
      { 15: 'st' },
    );
    expect(c).toMatchObject({ numero: '0015-00000007', sucursal: 'st', clase: 'nc', letra: 'B', total: -300, anulado: true, medio: 'Cuenta corriente' });
    // 02:00 UTC del 3/11 es el 2/11 a la noche en Buenos Aires
    expect(c.fecha).toBe('2026-11-02');
  });
});

describe('cifras y resumen del mes', () => {
  const lista = ticketsDelCrack([
    r({ cantidad: 1, precio_unitario: 1000 }),
    r({ ticket: 'FAC - B2-00000076', cliente_id: 'c2', cantidad: 1, precio_unitario: 500, medio_pago: 'TARJETA', sucursal: 'si' }),
    r({ ticket: 'NCR - R6-212', cantidad: 1, precio_unitario: 200, fecha: '2026-11-05' }),
    r({ ticket: 'REM - R1-1', cantidad: 1, precio_unitario: 9999 }),
  ]);
  it('facturado, notas de crédito y neto (los remitos no son venta facturada)', () => {
    expect(cifras(lista)).toEqual({ facturado: 1500, notasCredito: 200, neto: 1300, facturas: 2, notas: 1, clientes: 2, ticketPromedio: 750 });
  });
  it('los desgloses suman el neto', () => {
    const m = resumirMes(lista);
    expect(m.porMedio.reduce((s, p) => s + p.total, 0)).toBe(1300);
    expect(m.porSucursal.reduce((s, p) => s + p.total, 0)).toBe(1300);
    expect(m.porTipo.map((p) => p.etiqueta)).toEqual(['Factura A', 'Factura B']);
    expect(m.notasPorTipo[0]).toMatchObject({ etiqueta: 'Nota de crédito R', total: -200 });
  });
  it('por día: un casillero por día del mes', () => {
    const d = porDia(lista, '2026-11');
    expect(d).toHaveLength(30);
    expect(d[2]).toMatchObject({ fecha: '2026-11-03', neto: 1500, comprobantes: 2 });
    expect(d[4].neto).toBe(-200);
  });
  it('cuadrar reparte el resto del redondeo en la parte más grande', () => {
    const p = cuadrar([{ clave: 'a', etiqueta: 'a', total: 334, comprobantes: 1 }, { clave: 'b', etiqueta: 'b', total: 333, comprobantes: 1 }], 1000);
    expect(p.reduce((s, x) => s + x.total, 0)).toBe(1000);
  });
});

describe('meses', () => {
  it('días del mes y mes anterior (con cambio de año)', () => {
    expect(diasDelMes('2026-02')).toBe(28);
    expect(diasDelMes('2026-11')).toBe(30);
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(mesAnterior('2026-11')).toBe('2026-10');
  });
});

describe('antigüedad de la deuda', () => {
  const cuentas = [
    { id: 'a', saldo: 1000, dias: 10 },
    { id: 'b', saldo: 3000, dias: 45 },
    { id: 'c', saldo: 500, dias: 200 },
    { id: 'd', saldo: 100, dias: null },
    { id: 'e', saldo: -50, dias: 5 },
  ];
  it('cada cuenta entera en el tramo de su factura más vieja; las que no deben no cuentan', () => {
    const t = tramosDeDeuda(cuentas);
    expect(t.map((x) => [x.clave, x.total, x.cuentas])).toEqual([['0-30', 1000, 1], ['31-60', 3000, 1], ['61-90', 0, 0], ['90+', 500, 1], ['sin', 100, 1]]);
  });
  it('promedio ponderado por lo que debe cada uno', () => {
    expect(diasPromedio(cuentas)).toBe(Math.round((1000 * 10 + 3000 * 45 + 500 * 200) / 4500));
    expect(diasPromedio([])).toBeNull();
  });
});
