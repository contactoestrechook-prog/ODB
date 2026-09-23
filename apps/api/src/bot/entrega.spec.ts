import { eligeRetiroOEnvio, esperaRetiroOEnvio } from './entrega';

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
