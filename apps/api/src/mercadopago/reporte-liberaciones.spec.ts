import { leerReporteLiberaciones } from './reporte-liberaciones';

describe('reporte de liberaciones de Mercado Pago', () => {
  it('ODB: RECORD_TYPE y saldo calculado desde el saldo inicial', () => {
    const csv = [
      'DATE;SOURCE_ID;EXTERNAL_REFERENCE;RECORD_TYPE;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;SELLER_AMOUNT;MP_FEE_AMOUNT',
      '2026-09-30T23:00:00.000-04:00;;;initial_available_balance;;2514379.43;0.00;2514379.43;0.00;0.00',
      '2026-10-01T10:00:00.000-04:00;111;;release;payment;10000.00;0.00;10200.00;0.00;-200.00',
      '2026-10-01T20:44:31.000-04:00;222;;release;reserve_for_payout;0.00;150900.00;-150900.00;0.00;0.00',
      '2026-10-01T20:44:31.000-04:00;222;;release;reserve_for_payout;150900.00;0.00;150900.00;0.00;0.00',
      '2026-10-01T20:44:31.000-04:00;222;333;release;payout;0.00;150900.00;-150000.00;0.00;0.00',
      '2026-10-31T23:59:59.000-04:00;;;total;;2373479.43;0.00;0.00;0.00;-200.00',
    ].join('\n');
    const m = leerReporteLiberaciones('principal', csv);
    expect(m.map((x) => x.descripcion)).toEqual(['initial_available_balance', 'payment', 'reserve_for_payout', 'reserve_for_payout', 'payout', 'total']);
    expect(m[1]).toMatchObject({ credito: 10000, comision: -200, saldo: 2524379.43 });
    expect(m[4]).toMatchObject({ debito: 150900, saldo: 2373479.43 });
    expect(m[5].saldo).toBeNull();
  });

  it('Santa Inés: sin RECORD_TYPE, con BALANCE_AMOUNT', () => {
    const csv = [
      'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID',
      '2026-09-30T23:00:00.000-04:00;;;1000.00;0.00;1000.00;0;0;;;;;1000.00;;',
      '2026-10-02T09:00:00.000-04:00;9;payment;500.00;0.00;510.00;-10;0;visa;;;;1500.00;credit_card;',
      '2026-10-31T23:59:59.000-04:00;;;1500.00;0.00;0;0;0;;;;;1500.00;;',
    ].join('\n');
    const m = leerReporteLiberaciones('santa_ines', csv);
    expect(m.map((x) => x.descripcion)).toEqual(['initial_available_balance', 'payment', 'total']);
    expect(m[1]).toMatchObject({ saldo: 1500, medio: 'credit_card' });
  });

  it('la misma línea en dos reportes da el mismo id; repetida en uno, ids distintos', () => {
    const cab = 'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT';
    const l = '2026-10-02T09:00:00.000-04:00;9;payment;500.00;0.00';
    const a = leerReporteLiberaciones('x', [cab, '2026-10-01T00:00:00.000-03:00;;;0;0', l].join('\n'));
    const b = leerReporteLiberaciones('x', [cab, '2026-09-01T00:00:00.000-03:00;;;0;0', l, l].join('\n'));
    expect(a[1].id).toBe(b[1].id);
    expect(b[1].id).not.toBe(b[2].id);
  });
});

import { inicioMesAnterior, medianocheArgentina } from './mp-reportes.service';
describe('fechas de los reportes', () => {
  it('medianoche argentina', () => {
    expect(new Date(medianocheArgentina(Date.parse('2026-11-05T13:00:00Z'))).toISOString()).toBe('2026-11-05T03:00:00.000Z');
    expect(new Date(medianocheArgentina(Date.parse('2026-11-05T02:00:00Z'))).toISOString()).toBe('2026-11-04T03:00:00.000Z');
  });
  it('hacia atrás de a un mes', () => {
    expect(new Date(inicioMesAnterior(Date.parse('2026-11-02T03:00:00Z'))).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(new Date(inicioMesAnterior(Date.parse('2026-11-01T03:00:00Z'))).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(new Date(inicioMesAnterior(Date.parse('2026-01-01T03:00:00Z'))).toISOString()).toBe('2025-12-01T03:00:00.000Z');
  });
});
