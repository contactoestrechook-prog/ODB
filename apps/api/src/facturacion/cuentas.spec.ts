import { saldosPorCliente, agruparResumen, numeroLindo } from './cuentas';

describe('saldosPorCliente (debe − haber)', () => {
  it('suma debe y resta haber por cliente, ordenado por deuda', () => {
    const r = saldosPorCliente([
      { cliente_id: 'a', debe: 1000, haber: 0, cliente: { nombre: 'A' } },
      { cliente_id: 'a', debe: 0, haber: 400 },
      { cliente_id: 'b', debe: 5000, haber: 0, cliente: { nombre: 'B' } },
    ]);
    expect(r[0]).toMatchObject({ saldo: 5000 }); // B primero (más deuda)
    expect(r[1]).toMatchObject({ saldo: 600 });  // A: 1000 - 400
  });
  it('maneja strings numéricos y saldo a favor (negativo)', () => {
    const r = saldosPorCliente([{ cliente_id: 'x', debe: '0', haber: '250.5' }]);
    expect(r[0].saldo).toBe(-250.5);
  });
});

describe('agruparResumen', () => {
  const hoy = '2026-06-21';
  it('agrupa por tipo, ignora anulados y suma IVA del mes solo de facturas', () => {
    const r = agruparResumen([
      { tipo: 'FA', total: 121, iva: 21, estado: 'emitido', emitido_en: hoy + 'T10:00:00Z' },
      { tipo: 'FB', total: 100, iva: 0, estado: 'emitido', emitido_en: '2026-06-02T10:00:00Z' },
      { tipo: 'NCA', total: 50, iva: 8.68, estado: 'emitido', emitido_en: hoy },
      { tipo: 'FA', total: 999, iva: 173, estado: 'anulado', emitido_en: hoy }, // ignorado
    ], hoy);
    expect(r.grupos.facturas).toEqual({ cantidad: 2, total: 221, iva: 21 });
    expect(r.grupos.notasCredito.cantidad).toBe(1);
    expect(r.facturadoHoy).toBe(121); // solo la FA de hoy
    expect(r.ivaMes).toBe(21);        // IVA débito = solo facturas
  });
});

describe('numeroLindo', () => {
  it('formatea PV-número estilo AFIP', () => {
    expect(numeroLindo({ punto_venta: 2, numero: 61855 })).toBe('0002-00061855');
  });
});
