import { retiroOEnvio, sinCocinaInterna, minimoConMonto, asegurarEnvioSinCargo, campoLimpio, casiIgual, emprolijarListado, esAlucinacionDeTranscripcion, respuestaConConsulta, esAutomaticoWhatsappBusiness, envioSinCargo, nombreSucursalCliente, saintThomas } from './prolijo';

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
  it('corrige todas las formas de cobrarlo que salieron en charlas reales', () => {
    expect(envioSinCargo('*Total: $176.000*\n\nEs el total de la mercadería; el envío va aparte.'))
      .toBe('*Total: $176.000*\n\nEl envío es sin cargo.');
    expect(envioSinCargo('El total de $13.650 corresponde a la mercadería; el costo del envío lo define el sector de reparto, ya avisado.'))
      .toBe('El total de $13.650 corresponde a la mercadería; el envío es sin cargo.');
    expect(envioSinCargo('El costo del envío no está incluido: lo define el sector de reparto.')).toBe('El envío es sin cargo.');
    for (const frase of [
      'El envío tiene un costo de $3.500.',
      'El envío sale $4.000 según la zona.',
      'Al total hay que sumarle el envío, que se cobra aparte.',
      'El flete es adicional.',
      'La entrega tiene un recargo.',
      'El envío no está incluido en el total.',
    ]) {
      expect(envioSinCargo(frase)).toBe('El envío es sin cargo.');
    }
  });
  it('no toca lo que ya está bien ni la forma de pago', () => {
    for (const frase of [
      'Total: $13.650. El envío es sin cargo. ¿Lo confirmo?',
      'Te lo enviamos mañana a la mañana.',
      'Se abona al recibir el envío, en efectivo o con tarjeta.',
      'El envío sale hoy después de las 18.',
      'El envío es gratis.',
    ]) {
      expect(envioSinCargo(frase)).toBe(frase);
    }
  });
  it('NO toca la oración del total ni la del reemplazo (Catalina, 21/9/2026)', () => {
    for (const frase of [
      'Listo, reemplacé las Coca comunes por Coca Zero: el total queda en $75.000 con el envío. ¿Lo confirmo?',
      'Recibe Catalina. Se abona en efectivo al recibir y el envío es sin cargo, así que $75.000 es todo. ¿Lo confirmo?',
      'Te lo mando mañana por la mañana; el envío llega entre las 10 y las 13.',
      'Coca Cola Zero 1.75 L — $4.700 c/u. Envío a domicilio.',
    ]) expect(envioSinCargo(frase)).toBe(frase);
  });
  it('conserva los espacios y no repite la frase', () => {
    expect(envioSinCargo('El envío es sin cargo. Recibe Catalina. El envío va aparte. ¿Lo confirmo?'))
      .toBe('El envío es sin cargo. Recibe Catalina. ¿Lo confirmo?');
    expect(envioSinCargo('Recibe Catalina. El envío tiene un costo de $3.500. ¿Lo confirmo?'))
      .toBe('Recibe Catalina. El envío es sin cargo. ¿Lo confirmo?');
  });
  it('en un mensaje largo corrige solo la oración del costo', () => {
    const t = 'Pedido confirmado, código DOM-YD5GNY. El total de $13.650 corresponde a la mercadería; el costo del envío lo define el sector de reparto. Se abona al recibir, en efectivo o con tarjeta.';
    const r = envioSinCargo(t);
    expect(r).toMatch(/^Pedido confirmado, código DOM-YD5GNY\./);
    expect(r).toMatch(/el envío es sin cargo\./);
    expect(r).toMatch(/Se abona al recibir, en efectivo o con tarjeta\.$/);
    expect(r).not.toMatch(/sector de reparto/);
  });
});

describe('preguntó cuánto sale el envío', () => {
  it('la respuesta siempre dice que es sin cargo', () => {
    expect(asegurarEnvioSinCargo('Cuanto es el flete? me cobran el reparto aparte no?', 'Lo consulto y te confirmo por acá.'))
      .toBe('El envío es sin cargo. Lo consulto y te confirmo por acá.');
    expect(asegurarEnvioSinCargo('cuanto me sale el envio?', 'El envío es sin cargo: ese es el total.'))
      .toBe('El envío es sin cargo: ese es el total.');
    expect(asegurarEnvioSinCargo('¿el envío lo cobran aparte?', 'Te paso el total: $12.000.'))
      .toMatch(/^El envío es sin cargo\./);
  });
  it('si no preguntó por el costo, no agrega nada', () => {
    expect(asegurarEnvioSinCargo('¿a qué hora sale el reparto?', 'Sale después de las 18.')).toBe('Sale después de las 18.');
    expect(asegurarEnvioSinCargo('quiero 2 fernet', 'Te cotizo 2 Fernet Branca.')).toBe('Te cotizo 2 Fernet Branca.');
  });
});

describe('nunca el mismo mensaje dos veces', () => {
  it('detecta la repetición real de Catalina (21/9/2026)', () => {
    const a = 'El envío es sin cargo. Recibe Catalina y se abona en efectivo al recibir. El envío es sin cargo, así que $75.000 es todo. ¿Lo confirmo?';
    const b = 'El envío es sin cargo. Recibe Catalina. Se abona en efectivo al recibir y el envío es sin cargo, así que $75.000 es todo. ¿Lo confirmo?';
    expect(casiIgual(a, b)).toBe(true);
    expect(casiIgual(a, a)).toBe(true);
  });
  it('un mensaje distinto no se confunde', () => {
    expect(casiIgual('Pedido DOM-ABC123 confirmado. Total: $75.000. Envío sin cargo.', 'Recibe Catalina. Se abona en efectivo al recibir. ¿Lo confirmo?')).toBe(false);
    expect(casiIgual('Buen día. ¿Qué necesitás?', 'Buenas tardes. ¿Qué necesitás?')).toBe(false);
    expect(casiIgual('', 'hola')).toBe(false);
  });
});

describe('campos de herramienta sin basura', () => {
  it('descarta etiquetas y placeholders, conserva datos reales', () => {
    expect(campoLimpio('</antmlःparameter>')).toBe('');
    expect(campoLimpio('null')).toBe('');
    expect(campoLimpio('N/A')).toBe('');
    expect(campoLimpio('  Rivadavia 234, Canning ')).toBe('Rivadavia 234, Canning');
    expect(campoLimpio('2026-09-25')).toBe('2026-09-25');
  });
});

describe('consulta interna sin dejar mudo al cliente', () => {
  it('manda lo que sabe y el acuse una vez', () => {
    const r = respuestaConConsulta('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200. Las picadas las consulto y te confirmo por acá.', 'Buen día, ¿qué necesitás?');
    expect(r).toBe('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200.\n\nLo consulto y te confirmo por acá.');
  });
  it('conserva la lista renglón por renglón', () => {
    const r = respuestaConConsulta('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200\nLas picadas las consulto y te confirmo por acá.', null);
    expect(r).toBe('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200\n\nLo consulto y te confirmo por acá.');
  });
  it('sin nada útil: solo el acuse', () => {
    expect(respuestaConConsulta('', null)).toBe('Lo consulto y te confirmo por acá.');
    expect(respuestaConConsulta('Lo estoy consultando y te aviso en breve.', null)).toBe('Lo consulto y te confirmo por acá.');
  });
  it('el acuse sale una sola vez aunque el modelo lo diga con otras palabras (tono-02, 23/9/2026)', () => {
    expect(respuestaConConsulta('Queda registrada la consulta. En cuanto tenga la respuesta, te la paso por acá.', null)).toBe('Lo consulto y te confirmo por acá.');
  });
  it('no repite el acuse si ya lo dijo', () => {
    expect(respuestaConConsulta('', 'Lo consulto y te confirmo por acá.')).toBe('');
    expect(respuestaConConsulta('El fernet está a $20.500.', 'Lo consulto y te confirmo por acá.')).toBe('El fernet está a $20.500.');
  });
});

describe('la lista sin viñetas vuelve a ser lista (Rachel, 23/9/2026)', () => {
  it('cada renglón con cantidad y precio arranca con viñeta; el total no', () => {
    const t = 'Sigo con el resto de la lista:\n\n2 Chuker con Stevia 200 cc: 2 × $4.800 c/u = $9.600\n2 Pan Bimbo Blanco 400 g: 2 × $4.900 c/u = $9.800\n1 Club Social Original 6 x 24 g: 1 × $4.700\n2 Oreo Chocolate 118 g: 2 × $2.900 c/u = $5.800\nTotal de estos renglones: $49.300';
    const r = emprolijarListado(t);
    expect(r.split('\n').filter((l) => l.startsWith('• ')).length).toBe(4);
    expect(r).toMatch(/\*Total de estos renglones: \$49\.300\*/);
    expect(r).not.toMatch(/• Total/);
  });
  it('no toca un texto sin precios', () => {
    expect(emprolijarListado('2 de las 3 cosas las tengo.')).toBe('2 de las 3 cosas las tengo.');
  });
});

describe('transcripciones inventadas', () => {
  it('descarta los créditos de subtítulos que inventa Whisper', () => {
    expect(esAlucinacionDeTranscripcion('Subtítulos realizados por la comunidad de Amara.org')).toBe(true);
    expect(esAlucinacionDeTranscripcion('Gracias por ver el video.')).toBe(true);
    expect(esAlucinacionDeTranscripcion('Hola Jackie, ¿me mandás 4 fernet?')).toBe(false);
  });
});

describe('el mínimo de envío con su monto', () => {
  it('agrega el monto en la oración del mínimo', () => {
    expect(minimoConMonto('Con ese total todavía no llegamos al mínimo para envío a domicilio. Podés sumar algo.'))
      .toBe('Con ese total todavía no llegamos al mínimo de $70.000 para envío a domicilio. Podés sumar algo.');
  });
  it('con el total en el renglón de arriba y "mínimo de compra" (banco 25/9)', () => {
    expect(minimoConMonto('• Fernet — 2 × $20.500 c/u = $41.000\n\n*Total: $55.100*\n\nPara envío hay un mínimo de compra que este pedido todavía no alcanza.'))
      .toContain('Para envío hay un mínimo de compra de $70.000 que este pedido todavía no alcanza.');
  });
  it('no toca lo que ya tiene el monto ni otros mínimos', () => {
    expect(minimoConMonto('El envío es para pedidos desde $70.000.')).toBe('El envío es para pedidos desde $70.000.');
    expect(minimoConMonto('El mínimo de compra del vino es 6 botellas.')).toBe('El mínimo de compra del vino es 6 botellas.');
  });
});

describe('lo interno queda puertas adentro (Karina, 30/9/2026)', () => {
  it('sin cantidades ni sucursales del stock', () => {
    expect(sinCocinaInterna('De tu lista, en la sucursal Saint Thomas hay:')).toBe('De tu lista hay:');
    expect(sinCocinaInterna('• Grey Goose 750 cc: queda 1 botella; el de 1 L sin stock ahora')).toBe('• Grey Goose 750 cc; el de 1 L sin stock ahora');
    expect(sinCocinaInterna('• Absolut Elyx 1 L: quedan 2. El Absolut clásico está sin stock en Saint Thomas; sí hay Citron')).toBe('• Absolut Elyx 1 L. El Absolut clásico está sin stock; sí hay Citron');
    expect(sinCocinaInterna('• Negroni Restinga 500 cc (quedan 7)')).toBe('• Negroni Restinga 500 cc');
    expect(sinCocinaInterna('Sí, tenemos difusor Saphirus a $7.900, con 7 unidades en la sucursal Saint Thomas.')).toBe('Sí, tenemos difusor Saphirus a $7.900.');
    expect(sinCocinaInterna('De Quilmes clásica no tengo stock en la sucursal Saint Thomas, que es de donde salen los envíos; sí tengo IPA.')).toBe('De Quilmes clásica no tengo stock; sí tengo IPA.');
  });
  it('sin "el sistema"', () => {
    expect(sinCocinaInterna('En el sistema lo tengo cargado: Johnnie Walker Black Label 1 L a $59.400.')).toBe('Johnnie Walker Black Label 1 L a $59.400.');
    expect(sinCocinaInterna('Las picadas armadas hoy me figuran sin stock en sistema.')).toBe('Las picadas armadas hoy están sin stock.');
  });
  it('la entrega y los horarios no se tocan', () => {
    for (const t of ['Retiro en la sucursal Saint Thomas.', '¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?', 'La sucursal Saint Thomas abre de 8 a 21.', '• Fernet Branca 750 cc — 2 × $20.500 c/u = $41.000'])
      expect(sinCocinaInterna(t)).toBe(t);
  });
});

describe('retiro o envío, siempre las dos', () => {
  it('completa la pregunta', () => {
    expect(retiroOEnvio('Total: $53.800\n\n¿Lo retirás por la sucursal Saint Thomas, Castex 3601?')).toBe('Total: $53.800\n\n¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?');
    const ok = '¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?';
    expect(retiroOEnvio(ok)).toBe(ok);
  });
});
