import { esAutomaticoWhatsappBusiness, envioSinCargo, nombreSucursalCliente, saintThomas } from './prolijo';

describe('nombre de la sucursal ante el cliente', () => {
  it('Sant Thomas pasa a sucursal Saint Thomas', () => {
    expect(saintThomas('Estos son los whiskies de 1 litro con stock en Sant Thomas:')).toBe('Estos son los whiskies de 1 litro con stock en la sucursal Saint Thomas:');
    expect(saintThomas('Se retira en la sucursal Sant Thomas (Castex 3601)')).toBe('Se retira en la sucursal Saint Thomas (Castex 3601)');
    expect(saintThomas('Lo esperamos en Suc Sant Thomas.')).toBe('Lo esperamos en la sucursal Saint Thomas.');
    expect(saintThomas('Sant Thomas abre a las 8.')).toBe('Sucursal Saint Thomas abre a las 8.');
    expect(saintThomas('Santa Inés cierra a las 21.')).toBe('Santa Inés cierra a las 21.');
  });
  it('nombre de la base', () => {
    expect(nombreSucursalCliente('Suc Sant Thomas')).toBe('sucursal Saint Thomas');
    expect(nombreSucursalCliente('Suc Santa Ines')).toBe('Santa Ines');
  });
});

describe('automáticos de WhatsApp Business', () => {
  it('no son una persona', () => {
    expect(esAutomaticoWhatsappBusiness('Gracias por comunicarte con ODB PREMIUM MARKET. Por favor, haznos saber cómo podemos ayudarte.')).toBe(true);
    expect(esAutomaticoWhatsappBusiness('Gracias por tu mensaje. En este momento este celular se encuentra fuera del horario comercial.')).toBe(true);
    expect(esAutomaticoWhatsappBusiness('Gracias por tu compra, te lo llevo mañana')).toBe(false);
  });
});

describe('el envío en ODB es sin cargo', () => {
  it('corrige el cierre que cobraba la entrega', () => {
    expect(envioSinCargo('*Total: $176.000*\n\nEs el total de la mercadería; el envío va aparte.'))
      .toBe('*Total: $176.000*\n\nEl envío es sin cargo.');
    expect(envioSinCargo('El total de $13.650 corresponde a la mercadería; el costo del envío lo define el sector de reparto, ya avisado.'))
      .toMatch(/El envío es sin cargo\./);
    expect(envioSinCargo('El costo del envío no está incluido: lo define el sector de reparto.')).toBe('El envío es sin cargo.');
  });
  it('no toca un mensaje que ya está bien', () => {
    const t = 'Total: $13.650. El envío es sin cargo. ¿Lo confirmo?';
    expect(envioSinCargo(t)).toBe(t);
    expect(envioSinCargo('Te lo enviamos mañana a la mañana.')).toBe('Te lo enviamos mañana a la mañana.');
  });
});
