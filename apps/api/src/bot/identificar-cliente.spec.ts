// QUIÉN ESCRIBE Y SU CUENTA CORRIENTE (26/11/2026). Leandro: «necesito que el sistema reconozca
// las personas que tengan cuenta corriente así el bot puede gestionar el pedido». El caso real:
// Cristina (St Thomas 470) escribe desde un @lid; la cuenta es de la casa, «St Thomas 470
// (Salvador)», y ella es otra ficha unida a esa cuenta.
import { readFileSync } from 'fs';
import { join } from 'path';
import { cierreCuentaCorriente, cuentaCorrienteDe, fichaDelQueEscribe, TEXTO_PAGA_CTA_CTE } from './identificar-cliente';
import { formaDePagoDeNotas } from '../pedidos/alias-al-listo';

const CASA = { id: 'e0e17401', nombre: 'St Thomas 470 (Salvador)', razon_social: 'St Thomas 470 (Salvador)', cta_cte_habilitada: true, saldo_cta_cte: '2728584.00' };
const CRISTINA = { id: 'ca63baff', nombre: 'Cristina St Thomas 470', cta_cte_habilitada: false, saldo_cta_cte: '0', cuenta_corriente_de: 'e0e17401' };

describe('El bot reconoce la cuenta corriente de quien escribe', () => {
  it('la de la casa a la que está unida: el pedido va a esa cuenta', () => {
    expect(cuentaCorrienteDe(CRISTINA, CASA)).toEqual({ titularId: 'e0e17401', titular: 'St Thomas 470 (Salvador)', propia: false, saldo: 2728584 });
  });

  it('la suya propia', () => {
    expect(cuentaCorrienteDe(CASA, null)).toMatchObject({ titularId: 'e0e17401', propia: true });
  });

  it('sin cuenta, o con la de la casa dada de baja, no puede pagar así', () => {
    expect(cuentaCorrienteDe({ ...CRISTINA, cuenta_corriente_de: null }, null)).toBeNull();
    expect(cuentaCorrienteDe(CRISTINA, { ...CASA, cta_cte_habilitada: false })).toBeNull();
    // un titular que no es el de la ficha no vale
    expect(cuentaCorrienteDe(CRISTINA, { ...CASA, id: 'otra' })).toBeNull();
  });

  it('si el teléfono está en varias fichas, gana la que tiene o compra a una cuenta', () => {
    const sola = { id: 'x', nombre: 'Cristina', cta_cte_habilitada: false };
    expect(fichaDelQueEscribe([sola, CRISTINA])?.id).toBe('ca63baff');
    expect(fichaDelQueEscribe([sola, CRISTINA, CASA])?.id).toBe('e0e17401');
    expect(fichaDelQueEscribe([sola])?.id).toBe('x');
    expect(fichaDelQueEscribe([])).toBeNull();
  });

  it('al modelo le dice cómo anotarlo: «Paga con cuenta corriente», sin alias', () => {
    const t = TEXTO_PAGA_CTA_CTE({ titular: 'St Thomas 470 (Salvador)', propia: false });
    expect(t).toContain('la cuenta corriente de St Thomas 470 (Salvador)');
    expect(t).toContain('"Paga con cuenta corriente"');
    expect(t).toMatch(/no le mandes alias/);
    // y la base lo lee igual que el servidor
    expect(formaDePagoDeNotas('Paga con cuenta corriente')).toBe('cuenta_corriente');
    expect(formaDePagoDeNotas('Paga con cta cte. Tocar timbre')).toBe('cuenta_corriente');
    expect(formaDePagoDeNotas('Paga con transferencia')).toBe('transferencia');
  });

  it('el cierre dice a qué cuenta va y que no paga ahora', () => {
    expect(cierreCuentaCorriente({ titular: 'St Thomas 470 (Salvador)', propia: false }, 'Envío sin cargo a St Thomas 470. '))
      .toBe('Envío sin cargo a St Thomas 470. Va a la cuenta corriente de St Thomas 470 (Salvador): no tenés que pagar ahora.');
    expect(cierreCuentaCorriente({ titular: 'Debo', propia: true }, '')).toBe('Va a tu cuenta corriente: no tenés que pagar ahora.');
  });

  it('busca también por el teléfono real del @lid (las charlas llegan casi todas así)', () => {
    const f = readFileSync(join(__dirname, 'bot.service.ts'), 'utf8');
    const ident = f.slice(f.indexOf('async identificarCliente('), f.indexOf('async identificarCliente(') + 2500);
    expect(ident).toMatch(/from\('bot_contactos'\)\.select\('telefono_real'\)/);
    expect(ident).toMatch(/candidatosDeTelefono\(telefono/);
    expect(ident).toMatch(/cuenta_corriente_de/);
  });
});
