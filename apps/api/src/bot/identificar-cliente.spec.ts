// QUIÉN ESCRIBE Y SU CUENTA CORRIENTE (26/11/2026). Leandro: «necesito que el sistema reconozca
// las personas que tengan cuenta corriente así el bot puede gestionar el pedido». El caso real:
// Cristina (St Thomas 470) escribe desde un @lid; la cuenta es de la casa, «St Thomas 470
// (Salvador)», y ella es otra ficha unida a esa cuenta.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  cierreCuentaCorriente, cuentaCorrienteDe, cuentaPorDireccion, direccionDe, fichaDelQueEscribe, mismaDireccion,
  TEXTO_PAGA_CTA_CTE, TEXTO_PAGA_CTA_CTE_POR_DIRECCION,
} from './identificar-cliente';
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
    expect(ident).toMatch(/from\('bot_contactos'\)\.select\('telefono_real[,']/);
    expect(ident).toMatch(/candidatosDeTelefono\(telefono/);
    expect(ident).toMatch(/cuenta_corriente_de/);
  });
});

// POR LA DIRECCIÓN (26/11/2026): Leandro, «que todos los clientes que tengan cuenta corriente sean
// reconocidos también por su dirección, como en este caso». Nombres reales de cuentas de ODB.
describe('La cuenta corriente se reconoce por la dirección de la casa', () => {
  const CUENTAS = [
    { id: 'st470', nombre: 'St Thomas 470 (Salvador)', razon_social: 'St Thomas 470 (Salvador)', saldo_cta_cte: '2728584' },
    { id: 'st409', nombre: 'St Thomas 409', domicilio: 'Canning, Buenos Aires', saldo_cta_cte: '0' },
    { id: 'oeste655', nombre: 'St Thomas Oeste 655', saldo_cta_cte: '1000' },
    { id: 'este293', nombre: 'St thomas este 293' },
    { id: 'h161', nombre: 'Horqueta 161' },
    { id: 'jordy', nombre: 'Jordy Santa Ines 201' },
    { id: 'castex', nombre: 'Castex 497 (Durlock)' },
    { id: 'talca', nombre: 'Talcahuano 4700 almafuert' },
    { id: 'walter', nombre: 'Walter Perez (464)', domicilio: 'Canning, Buenos Aires' },
    { id: 'griller', nombre: 'Griller' },
  ];
  const cuenta = (...t: string[]) => cuentaPorDireccion(t, CUENTAS)?.titularId ?? null;

  it('lee calle y número del nombre, sin lo que va entre paréntesis ni teléfonos', () => {
    expect(direccionDe('St Thomas 470 (Salvador)')).toEqual({ calle: ['st', 'thomas'], numero: '470' });
    expect(direccionDe('Cristina St Thomas 470')).toEqual({ calle: ['st', 'thomas'], numero: '470' });
    expect(direccionDe('Saint Thomas Oeste nº 655')).toEqual({ calle: ['thomas', 'oeste'], numero: '655' });
    expect(direccionDe('Talcahuano 4700 almafuert')).toEqual({ calle: ['talcahuano'], numero: '4700' });
    expect(direccionDe('Walter Perez (464)')).toBeNull();
    expect(direccionDe('Cel 1134602714')).toBeNull();
    expect(direccionDe('Griller')).toBeNull();
  });

  it('la misma casa: mismo número, y una calle termina como la otra; este/oeste y otro número no', () => {
    expect(mismaDireccion(direccionDe('Horqueta 161'), direccionDe('Juan Horqueta 161'))).toBe(true);
    expect(mismaDireccion(direccionDe('St Thomas 470'), direccionDe('st. thomas 470, Canning'))).toBe(true);
    expect(mismaDireccion(direccionDe('St Thomas 470'), direccionDe('St Thomas Oeste 470'))).toBe(false);
    expect(mismaDireccion(direccionDe('St Thomas 470'), direccionDe('St Thomas 471'))).toBe(false);
    expect(mismaDireccion(direccionDe('St Thomas Este 293'), direccionDe('St Thomas 293'))).toBe(false);
  });

  it('encuentra la cuenta de la casa por el nombre de la ficha o la dirección dicha', () => {
    expect(cuenta('Cristina St Thomas 470')).toBe('st470');
    expect(cuenta('Mandalo a st thomas oeste 655 por favor')).toBe('oeste655');
    expect(cuenta('Santa Inés 201')).toBe('jordy');
    expect(cuenta('Castex 497')).toBe('castex');
    expect(cuenta('Marido St Thomas Oeste 623')).toBeNull(); // esa casa no tiene cuenta
    expect(cuenta('St Thomas 293')).toBeNull(); // la cuenta es de St Thomas ESTE 293
    expect(cuenta('Walter 464')).toBeNull(); // «(464)» no es una dirección
    expect(cuenta('Cristina', '')).toBeNull();
  });

  it('dos cuentas en la misma dirección no se adivinan', () => {
    const dobles = [...CUENTAS, { id: 'st470bis', nombre: 'Familia St Thomas 470' }];
    expect(cuentaPorDireccion(['St Thomas 470'], dobles)).toBeNull();
  });

  it('dice la dirección como se lee y que solo vale con envío ahí', () => {
    const m = cuentaPorDireccion(['Cristina St Thomas 470'], CUENTAS)!;
    expect(m).toMatchObject({ titular: 'St Thomas 470 (Salvador)', direccion: 'St Thomas 470', saldo: 2728584 });
    const t = TEXTO_PAGA_CTA_CTE_POR_DIRECCION(m);
    expect(t).toContain('SOLO si el pedido es con envío a St Thomas 470');
    expect(t).toMatch(/retirar o mandarlo a otra dirección, la cuenta corriente no va/);
  });

  it('al confirmar: la reconocida por dirección pide envío a esa casa; si no, lo confirma el local', () => {
    const f = readFileSync(join(__dirname, 'bot.service.ts'), 'utf8');
    expect(f).toMatch(/!dicha\.porDireccion \|\| \(envioA && mismaDireccion\(direccionDe\(dicha\.porDireccion\), direccionDe\(envioA\)\)\)/);
    // sin cuenta reconocida no se promete nada (consulta silenciosa): solo el envío
    expect(f).toMatch(/: paga === 'cuenta_corriente'\s*\n\s*\? envio\.trim\(\)/);
    // la herramienta usa siempre el teléfono del chat: la dirección va aparte
    expect(f).toMatch(/direccion \? this\.identificarCliente\(telefono, \{ direccion \}\) : this\.identificarCliente\(telefono\)/);
  });
});
