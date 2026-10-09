// Candados del 9/10/2026, con la charla de Leandro (Odb Saint Thomas, 14:35–14:51).
import { sinOracionesRepetidas, totalConSuLista } from './candados';

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

describe('candado 2: nunca la misma oración dos veces', () => {
  it('14:51 repetía «Saco la sal y sumo…» de las 14:49: sale solo lo nuevo', () => {
    const antes = ['Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. ¿Lo retirás en la sucursal Saint Thomas o te lo enviamos?'];
    expect(sinOracionesRepetidas('Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. ¿A nombre de quién lo preparo?', antes))
      .toBe('¿A nombre de quién lo preparo?');
  });
  it('los renglones de una lista y el total se pueden repetir (es la lista actualizada)', () => {
    const lista = '• 2 × Fernet Branca 750 cc\n• 1 × Coca Cola 1,75 L\nTotal: $45.000';
    expect(sinOracionesRepetidas(lista, [lista])).toBe(lista);
  });
  it('si todo ya estaba dicho, no queda vacío', () => {
    expect(sinOracionesRepetidas('Te esperamos en la sucursal.', ['Te esperamos en la sucursal.'])).toBe('Te esperamos en la sucursal.');
  });
});
