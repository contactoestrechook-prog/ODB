// Candados del 9/10/2026, con la charla de Leandro (Odb Saint Thomas, 14:35–14:51).
import { totalConSuLista } from './candados';

const cot = {
  renglones: [
    { nombre: 'Coca Cola Zero 1,75 L', renglon: '8 × $4.700 c/u = $37.600', subtotal: 37600 },
    { nombre: 'Chandon Extra Brut 750 cc', renglon: '2 × $22.700 c/u = $45.400', subtotal: 45400, subtotalEfectivo: 40860 },
    { nombre: 'Absolut vodka clásico 750 cc', renglon: '1 × $33.500 c/u = $33.500', subtotal: 33500, subtotalEfectivo: 30150 },
    { nombre: 'Agua KO 1 L', renglon: '2 × $2.000 c/u = $4.000', subtotal: 4000 },
  ],
  total: 120500,
  totalEfectivo: 110510,
};

describe('candado 1: un total nunca sale sin su lista', () => {
  it('14:51 «me pasás la cuenta final?»: la línea del cambio con el total → la lista entera desde la cotización', () => {
    const r = totalConSuLista('Saco la sal y sumo 1 × Absolut vodka clásico — $33.500 ($30.150 en efectivo o transferencia).\n\nTotal: $120.500, o $110.510 en efectivo o transferencia. ¿A nombre de quién preparo el pedido para retirar en la sucursal Saint Thomas?', cot);
    expect(r).toBe([
      '• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600',
      '• Chandon Extra Brut 750 cc — 2 × $22.700 c/u = $45.400 ($40.860 en efectivo o transferencia)',
      '• Absolut vodka clásico 750 cc — 1 × $33.500 c/u = $33.500 ($30.150 en efectivo o transferencia)',
      '• Agua KO 1 L — 2 × $2.000 c/u = $4.000',
      '',
      'Total: $120.500, o $110.510 en efectivo o transferencia',
      '',
      '¿A nombre de quién preparo el pedido para retirar en la sucursal Saint Thomas?',
    ].join('\n'));
  });
  it('si la respuesta ya trae toda la lista y el total, no se toca', () => {
    const ok = '• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600\n• Chandon Extra Brut 750 cc — 2 × $22.700 c/u = $45.400\n• Absolut vodka clásico 750 cc — 1 × $33.500 c/u = $33.500\n• Agua KO 1 L — 2 × $2.000 c/u = $4.000\n\nTotal: $120.500\n¿Lo retirás o te lo enviamos?';
    expect(totalConSuLista(ok, cot)).toBe(ok);
  });
  it('sin cotización en el turno, o sin plata en el texto, no se toca', () => {
    expect(totalConSuLista('Total: $120.500', null)).toBe('Total: $120.500');
    expect(totalConSuLista('¿A nombre de quién lo preparo?', cot)).toBe('¿A nombre de quién lo preparo?');
  });
});

describe('candado 1, revisión del 9/10', () => {
  it('con una cotización parcial (sin stock, reemplazo sin aceptar o renglón con error) no arma nada', () => {
    const r = 'La de Zero no la tengo; ¿le cotizo la común a $4.500? Total: $120.500';
    expect(totalConSuLista(r, { ...cot, hayFaltantes: true })).toBe(r);
    expect(totalConSuLista(r, { ...cot, reemplazoSinConfirmar: 'x' })).toBe(r);
    expect(totalConSuLista(r, { ...cot, renglones: [...cot.renglones, { nombre: 'Hielo', error: 'sin precio' }] })).toBe(r);
    expect(totalConSuLista(r, { ...cot, renglones: cot.renglones.map((x, i) => (i ? x : { ...x, alcanzaElStock: false })) })).toBe(r);
  });
  it('se queda con el mínimo de envío y con la pregunta aunque tenga un monto; se va un total mal hecho', () => {
    const r = totalConSuLista('Sumo el agua. Total: $119.000. El envío es sin cargo desde $70.000. ¿Te lo mando a Mitre 1234 o pasás por la sucursal?', cot);
    expect(r).toContain('Total: $120.500, o $110.510 en efectivo o transferencia');
    expect(r).not.toContain('$119.000');
    expect(r).toContain('El envío es sin cargo desde $70.000.');
    expect(r).toMatch(/¿Te lo mando a Mitre 1234 o pasás por la sucursal\?$/);
  });
});

describe('candado 1: la frase que presentaba la lista no queda colgada', () => {
  it('«Así queda el pedido: El envío es sin cargo. ¿Lo retirás…?» (charla de Leandro, 9/10 23:34)', () => {
    const r = totalConSuLista('Así queda el pedido:\n• Coca Cola Zero — 8 × $4.700\nTotal: $120.500\nEl envío es sin cargo. ¿Lo retirás hoy en la sucursal Saint Thomas antes de las 21:00 o te lo enviamos mañana?', cot);
    expect(r).not.toMatch(/Así queda el pedido/);
    expect(r).toMatch(/\n\nEl envío es sin cargo\. ¿Lo retirás hoy en la sucursal Saint Thomas antes de las 21:00 o te lo enviamos mañana\?$/);
    expect(totalConSuLista('Te paso el detalle: Total: $1. ¿Lo retirás o te lo enviamos?', cot)).toMatch(/\n\n¿Lo retirás o te lo enviamos\?$/);
  });
});

