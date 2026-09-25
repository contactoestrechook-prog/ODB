import { eligeRetiroOEnvio, eligioModalidad, esperaRetiroOEnvio } from './entrega';

describe('retiro o envío lo elige el cliente', () => {
  it('reconoce la pregunta del bot', () => {
    expect(esperaRetiroOEnvio('*Total: $41.000*\n\n¿Lo retirás por la sucursal Saint Thomas o te lo enviamos a domicilio?')).toBe(true);
    expect(esperaRetiroOEnvio('¿Te lo enviamos o pasás a retirar?')).toBe(true);
    expect(esperaRetiroOEnvio('Total: $41.000\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?')).toBe(false);
  });
  it('"sumale 1 smirnoff" no elige', () => {
    expect(eligeRetiroOEnvio('y sumale 1 smirnoff')).toBe(false);
    expect(eligeRetiroOEnvio('agregale 2 coca de 1.75')).toBe(false);
  });
  it('retiro, envío o una dirección sí eligen', () => {
    for (const t of ['lo retiro', 'paso a buscar', 'retiro yo', 'envio', 'mandamelo', 'a Los Talas 15', 'Av. Castex 1200', 'por la sucursal']) expect(eligeRetiroOEnvio(t)).toBe(true);
  });
});

describe('la modalidad la tiene que haber elegido el cliente', () => {
  it('"Branca 750" no es una dirección ni un retiro', () => {
    expect(eligioModalidad('pickup', '', ['Necesito:\n2 fernet branca 750\n6 coca cola 1.75', 'sí, es todo'])).toBe(false);
  });
  it('retiro dicho con palabras; envío pedido o con su dirección', () => {
    expect(eligioModalidad('pickup', '', ['3 coca zero para retirar, Pedro'])).toBe(true);
    expect(eligioModalidad('domicilio', 'Los Talas 15', ['16 coca zero para envío a Los Talas 15'])).toBe(true);
    expect(eligioModalidad('domicilio', 'Rivadavia 234, Canning', ['Rivadavia 234, a nombre de Ana'])).toBe(true);
  });
});
