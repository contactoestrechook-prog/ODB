// LOS MONTOS SE ESCRIBEN COMO EN ARGENTINA (26/11/2026): Melina pagó una factura de Noria Express
// de $ 288.723,40 escribiendo «288.723» y quedó un pago de $ 288,72 (campo type="number"); el
// resto, $ 288.435, rebotaba por 32 centavos. Ver apps/admin/app/lib/montos.ts y
// db/migracion-pago-factura-centavos.sql.
import { readFileSync } from 'fs';
import { join } from 'path';
import { conPuntos, montoEscrito, montoParaCampo, tieneCentavos } from '../../../admin/app/lib/montos';

describe('Montos con puntos de miles', () => {
  it('«288.723» son 288 mil pesos, no 288 con decimales', () => {
    expect(montoEscrito('288.723')).toBe(288723);
    expect(montoEscrito('288.723,40')).toBe(288723.4);
    expect(montoEscrito('1.500.000')).toBe(1500000);
    expect(montoEscrito('288434,68')).toBe(288434.68);
    expect(montoEscrito('$ 289.000')).toBe(289000);
    expect(montoEscrito('0')).toBeNull();
    expect(montoEscrito('')).toBeNull();
  });

  it('los puntos aparecen mientras se escribe', () => {
    expect(conPuntos('288723')).toBe('288.723');
    expect(conPuntos('288723,4')).toBe('288.723,4');
    expect(conPuntos('288.723,405')).toBe('288.723,40');
  });

  it('«Todo el saldo» pone el saldo exacto, con centavos', () => {
    expect(montoParaCampo(288434.677)).toBe('288.434,68');
    expect(montoEscrito(montoParaCampo(288434.677))).toBe(288434.68);
    expect(montoParaCampo(289000)).toBe('289.000');
    expect(tieneCentavos(288434.68)).toBe(true);
    expect(tieneCentavos(289000)).toBe(false);
  });

  it('el campo del pago de facturas de compra ya no es numérico y manda el monto leído así', () => {
    const f = readFileSync(join(__dirname, '../../../admin/app/ui/FacturasCompraWorkspace.tsx'), 'utf8');
    const campo = f.split('\n').find((l) => l.includes('aria-label="Monto del pago"')) ?? '';
    expect(campo).not.toContain('type="number"');
    expect(campo).toContain('conPuntos(');
    expect(f).toMatch(/accion: 'pagoFactura', id, monto: montoEscrito\(pago\.monto\)/);
    expect(f).toContain('Todo el saldo');
  });

  it('el precio de venta directo de la entrada por foto también va con puntos de miles (27/11/2026)', () => {
    const f = readFileSync(join(__dirname, '../../../admin/app/ui/ComprasWorkspace.tsx'), 'utf8');
    const precio = f.slice(f.indexOf('function PrecioDirecto'), f.indexOf('aria-label="Precio de venta"'));
    expect(precio).toContain('conPuntos(v)');
    expect(precio).toContain('montoParaCampo(precio)');
    expect(precio).not.toContain('String(precio)');
  });

  it('la base paga el saldo justo si se pasa por el redondeo de la pantalla', () => {
    const sql = readFileSync(join(__dirname, '../../../../db/migracion-pago-factura-centavos.sql'), 'utf8');
    expect(sql).toMatch(/v_monto := round\(p_monto, 2\)/);
    expect(sql).toMatch(/if v_monto > v_saldo and v_monto - v_saldo < 1 then v_monto := v_saldo; end if;/);
  });
});
