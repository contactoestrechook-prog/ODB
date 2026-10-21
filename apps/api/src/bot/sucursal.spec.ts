import { sinCocinaInterna, campoLimpio, casiIgual, emprolijarListado, esAlucinacionDeTranscripcion, esAutomaticoWhatsappBusiness, envioSinCargo, nombreSucursalCliente } from './prolijo';
import { consultaAbiertaQueNombra, juntarConsulta, mencionaConsulta, mismaConsulta, mismoTema, respuestaDelAreaParaCliente, sinMencionDeConsulta, sinPromesas, temaDeConsulta, temaDeLaPromesa } from './prolijo';

describe('nombre de la sucursal ante el cliente', () => {
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
      .toBe('El total de $13.650 corresponde a la mercadería; el envío es sin cargo en pedidos desde $70.000.');
    expect(envioSinCargo('El costo del envío no está incluido: lo define el sector de reparto.')).toBe('El envío es sin cargo en pedidos desde $70.000.');
    for (const frase of [
      'El envío tiene un costo de $3.500.',
      'El envío sale $4.000 según la zona.',
      'Al total hay que sumarle el envío, que se cobra aparte.',
      'El flete es adicional.',
      'La entrega tiene un recargo.',
      'El envío no está incluido en el total.',
    ]) {
      expect(envioSinCargo(frase)).toBe('El envío es sin cargo en pedidos desde $70.000.');
    }
  });
  it('no toca lo que ya está bien ni la forma de pago', () => {
    for (const frase of [
      'Te lo enviamos mañana a la mañana.',
      'Se abona al recibir el envío, en efectivo o con tarjeta.',
      'El envío sale hoy después de las 18.',
      'Total: $99.300. El envío es sin cargo. ¿Lo retirás o te lo enviamos?',
      'Envío sin cargo a Mitre 1234. Recibe Leandro.',
    ]) {
      expect(envioSinCargo(frase)).toBe(frase);
    }
    // sin un total que ya pase el mínimo, el mínimo se dice (9/10/2026)
    expect(envioSinCargo('Total: $13.650. El envío es sin cargo. ¿Lo confirmo?')).toBe('Total: $13.650. El envío es sin cargo en pedidos desde $70.000. ¿Lo confirmo?');
    expect(envioSinCargo('El envío es gratis.')).toBe('El envío es gratis en pedidos desde $70.000.');
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
      .toBe('El envío es sin cargo en pedidos desde $70.000. Recibe Catalina. ¿Lo confirmo?');
    expect(envioSinCargo('Recibe Catalina. El envío tiene un costo de $3.500. ¿Lo confirmo?'))
      .toBe('Recibe Catalina. El envío es sin cargo en pedidos desde $70.000. ¿Lo confirmo?');
  });
  it('en un mensaje largo corrige solo la oración del costo', () => {
    const t = 'Pedido confirmado, código DOM-YD5GNY. El total de $13.650 corresponde a la mercadería; el costo del envío lo define el sector de reparto. Se abona al recibir, en efectivo o con tarjeta.';
    const r = envioSinCargo(t);
    expect(r).toMatch(/^Pedido confirmado, código DOM-YD5GNY\./);
    expect(r).toMatch(/el envío es sin cargo en pedidos desde \$70\.000\./);
    expect(r).toMatch(/Se abona al recibir, en efectivo o con tarjeta\.$/);
    expect(r).not.toMatch(/sector de reparto/);
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

// CONSULTA SILENCIOSA (Leandro, 6/10/2026): «Si no sabe algo, lo consulta
// directamente con la administración, pero no se lo avisa al cliente que lo está
// consultando.» Hasta el 5/10 se le pegaba «Lo de <tema> te lo confirmo por
// acá.»; ahora al cliente le va solo lo que el bot sabe.
describe('consulta silenciosa: al cliente solo lo que se sabe (6/10/2026)', () => {
  it('manda lo que sabe, sin la promesa', () => {
    expect(sinPromesas('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200. Las picadas las consulto y te confirmo por acá.')).toBe('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200.');
  });
  it('conserva la lista renglón por renglón', () => {
    expect(sinPromesas('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200\nLas picadas las consulto y te confirmo por acá.'))
      .toBe('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200');
  });
  it('si no había nada más que lo consultado, no queda nada (al cliente no le sale ningún mensaje)', () => {
    for (const t of ['', 'Lo estoy consultando y te aviso en breve.', 'Lo consulto y vuelvo a vos.', 'Queda registrada la consulta. En cuanto tenga la respuesta, te la paso por acá.', 'Ya te confirmo por acá.', 'Lo de la caja para viajar te lo confirmo por acá.'])
      expect(sinPromesas(t)).toBe('');
  });
  it('ni «ese dato no lo tengo» ni «sigue pendiente» (la propuesta que Leandro rechazó)', () => {
    for (const t of ['Ese dato no lo tengo.', 'No tengo esa información.', 'No tengo ese dato.', 'Lo de la caja para viajar sigue pendiente.', 'Lo del PerSe Inseparable todavía no lo tengo.', 'Eso todavía no lo tengo.', 'Todavía no tengo la respuesta.', 'No lo sé.'])
      expect(sinPromesas(t)).toBe('');
  });
  it('el modelo escribió su propio aviso: se saca y no se pone ninguno', () => {
    const m8 = 'Podés llevar una de cada una o tres iguales, el precio por botella es el mismo.';
    expect(sinPromesas(`${m8} Lo de las cajas individuales te lo confirmo por acá.`)).toBe(m8);
  });
  it('sin promesas ni menciones, queda igual', () => {
    expect(sinPromesas('El fernet está a $20.500.')).toBe('El fernet está a $20.500.');
    expect(sinPromesas('El fernet está a $20.500. Ya te confirmo por acá lo del otro.')).toBe('El fernet está a $20.500.');
  });
});
describe('el tema es de uso interno y encabeza la respuesta del área (6/10/2026)', () => {
  it('el tema, presentable y sin nada interno', () => {
    expect(temaDeConsulta('la caja para viajar')).toBe('la caja para viajar');
    expect(temaDeConsulta('El PerSe Inseparable.')).toBe('el PerSe Inseparable');
    expect(temaDeConsulta('lo de la caja')).toBe('la caja');
    expect(temaDeConsulta('«las cajas individuales»')).toBe('las cajas individuales');
    for (const t of ['', null, 'el stock de la sucursal Saint Thomas', 'si hay 6 unidades', 'lo que diga compras del Raquis', 'una frase larguísima que no es un tema sino una explicación entera de todo'])
      expect(temaDeConsulta(t)).toBe('');
  });
  it('la respuesta del área se entiende sola: si no nombra de qué se trata, va encabezada por el tema', () => {
    expect(respuestaDelAreaParaCliente('la caja para viajar', 'Sí, vienen en estuche individual de cartón.')).toBe('Sobre la caja para viajar: sí, vienen en estuche individual de cartón.');
    expect(respuestaDelAreaParaCliente('el PerSe Inseparable', 'Entra el jueves.')).toBe('Sobre el PerSe Inseparable: entra el jueves.');
    expect(respuestaDelAreaParaCliente('el envío', 'Sí, llegamos el sábado.')).toBe('Sobre el envío: sí, llegamos el sábado.');
    // un nombre propio al arrancar no se baja a minúscula
    expect(respuestaDelAreaParaCliente('la caja para viajar', 'Bodega Catena las manda en estuche.')).toBe('Sobre la caja para viajar: Bodega Catena las manda en estuche.');
  });
  it('si ya lo nombra, o no hay tema (consultas de antes de la columna), va tal cual: lo escribió una persona', () => {
    expect(respuestaDelAreaParaCliente('la caja para viajar', 'Sí, vienen en caja individual.')).toBe('Sí, vienen en caja individual.');
    expect(respuestaDelAreaParaCliente('el envío', 'El envío llega el sábado.')).toBe('El envío llega el sábado.');
    expect(respuestaDelAreaParaCliente(null, 'Sí, llegamos hoy a Terra 812.')).toBe('Sí, llegamos hoy a Terra 812.');
    expect(respuestaDelAreaParaCliente('si hay 6 unidades', 'Sí.')).toBe('Sí.');
    // lo que arma el sistema no dice «te confirmo» ni «como te dije»
    expect(mencionaConsulta(respuestaDelAreaParaCliente('la caja para viajar', 'Sí, vienen en estuche.'))).toBe(false);
  });
});
describe('el mensaje 2 de Pablo: la lista y la pregunta, sin nada de la consulta del PerSe (6/10/2026)', () => {
  const M2 = 'Del PerSe Inseparable no tengo ahora, ya te confirmo por acá si entra. En esa misma línea de Gualtallary sí tengo:\n• Adrianna River Malbec 750 cc — $182.000, o $163.800 en efectivo o transferencia\n\nPor ahora quedan anotados:\n• 1 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
  it('el hecho del catálogo se queda, la promesa se va y la pregunta sigue última', () => {
    const r = sinPromesas(M2);
    expect(r.startsWith('Del PerSe Inseparable no tengo ahora. En esa misma línea')).toBe(true);
    expect(r).toContain('• 1 × Bressia Conjuro 750 cc');
    expect(r.trim().endsWith('• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?')).toBe(true);
    expect(mencionaConsulta(r)).toBe(false);
  });
  it('«¿Lo confirmo?» y dos preguntas seguidas quedan como estaban', () => {
    const resumen = '• Judas Malbec — 2 × $79.900 c/u = $159.800\nTotal: $159.800\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    expect(sinPromesas(`${resumen.replace('\n¿Lo confirmo?', '')}\nLo de la caja te lo confirmo por acá.\n¿Lo confirmo?`)).toBe(resumen);
    expect(sinPromesas('Te anoté el Judas.\nLo de la caja te lo confirmo por acá.\n¿Te sirve el Adrianna River?\n¿Está completo el pedido o querés sumar algo?'))
      .toBe('Te anoté el Judas.\n¿Te sirve el Adrianna River?\n¿Está completo el pedido o querés sumar algo?');
  });
});
describe('las promesas del modelo salen sin comerse lo útil (5/10/2026)', () => {
  it('saca solo la parte que promete', () => {
    expect(sinPromesas('Del PerSe no tengo ahora, ya te confirmo si entra.')).toBe('Del PerSe no tengo ahora.');
    expect(sinPromesas('Dale, Pablo, te las dejo a tu nombre para retirar en un rato y lo de la caja te lo confirmo por acá.'))
      .toBe('Dale, Pablo, te las dejo a tu nombre para retirar en un rato.');
    expect(sinPromesas('Si entra el PerSe, te confirmo por acá.')).toBe('');
    expect(sinPromesas('Sobre la caja, ya te confirmo por acá.')).toBe('');
    expect(sinPromesas('Perfecto, Pablo. Lo de la caja para llevarlas en la valija te lo confirmo por acá.')).toBe('Perfecto, Pablo.');
    expect(sinPromesas('Coca Zero a $4.700, y chips a $1.200, lo de las picadas te lo confirmo por acá.')).toBe('Coca Zero a $4.700, y chips a $1.200.');
  });
  it('no toca las preguntas al cliente ni lo que no promete', () => {
    expect(sinPromesas('Total: $159.800\n¿Lo confirmo?')).toBe('Total: $159.800\n¿Lo confirmo?');
    expect(sinPromesas('¿Te lo confirmo así?')).toBe('¿Te lo confirmo así?');
    expect(sinPromesas('Te anoto 2 Judas para retirar en un rato.')).toBe('Te anoto 2 Judas para retirar en un rato.');
  });
  it('una mención sin herramienta se reconoce en todas sus formas (la red de respaldo la consulta en silencio)', () => {
    for (const t of ['Voy a consultar si entra.', 'Lo consultamos y te digo.', 'Lo verifico con el local.', 'Te lo confirmo por acá.', 'Ya te confirmo.', 'Te aviso apenas sepa.', 'Te paso el dato por acá.', 'Te paso los datos en un rato.', 'Vuelvo a vos.', 'Lo averiguo.', 'Ese dato no lo tengo.', 'No tengo esa información.', 'Lo de la caja sigue pendiente.', 'Tomo tu consulta y doy aviso al sector correspondiente.', 'Lo revisa alguien de la casa.', 'Administración te responde por este mismo chat.'])
      expect(mencionaConsulta(t)).toBe(true);
    for (const t of ['¿Lo confirmo?', 'El envío es sin cargo.', 'Pedido PICKUP-AB12 confirmado.', '¿Te lo confirmo así?', 'De Raquis Monasterio no tengo ahora.', 'Esa cantidad no la tengo disponible ahora.', 'Te paso por acá los precios:', 'Te paso con una persona del local.', 'Cuando transfieras, mandame el comprobante por acá.'])
      expect(mencionaConsulta(t)).toBe(false);
  });
});
describe('la misma consulta no se hace dos veces (caja de Pablo, 16:02 y 16:17)', () => {
  const caja1602 = 'Cliente viaja a España: ¿Judas Malbec 750, Catena Zapata Malbec Argentino 750 y Conjuro Bressia 750 vienen en caja/estuche individual? ¿Tenemos embalaje para llevar en avión?';
  const caja1617 = 'Cliente Pablo retira en un rato 4 botellas y las lleva a España en valija: ¿tenemos caja o embalaje de protección para darle?';
  it('las dos preguntas por la caja son la misma (parecidas() daba 0,43)', () => {
    expect(mismaConsulta({ consulta: caja1617 }, { consulta: caja1602 })).toBe(true);
  });
  it('mismo tema, aunque las palabras cambien', () => {
    expect(mismaConsulta({ consulta: '¿Tenés algo para protegerlas?', tema: 'la caja para viajar' }, { consulta: caja1602, tema: 'La caja para viajar.' })).toBe(true);
  });
  it('dos cosas distintas siguen separadas', () => {
    expect(mismaConsulta({ consulta: 'Cliente Pablo pregunta si entra el Raquis Monasterio 750 cc', tema: 'el Raquis Monasterio' }, { consulta: caja1602, tema: 'la caja para viajar' })).toBe(false);
    expect(mismaConsulta({ consulta: '¿Hay stock de Raquis?' }, { consulta: '¿Hay stock del PerSe?' })).toBe(false);
    expect(mismaConsulta({ consulta: 'Cliente Pablo pregunta si entra el PerSe Inseparable' }, { consulta: 'Cliente Pablo pregunta si entra el Raquis Monasterio' })).toBe(false);
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

describe('sin consulta en el turno, lo que no promete no se toca', () => {
  it('queda igual', () => {
    expect(sinPromesas('El envío es sin cargo.')).toBe('El envío es sin cargo.');
  });
});
describe('la última limpieza: nada de una consulta en NINGUNA respuesta (1/10 y 6/10/2026)', () => {
  it('saca lo que dice que consulta, que confirma o avisa después, que no lo sabe o que está pendiente; deja lo demás', () => {
    expect(sinMencionDeConsulta('El precio vigente es $4.700.\n\nYa te confirmo por acá.')).toBe('El precio vigente es $4.700.');
    // antes quedaba «Por ser una cantidad grande.» colgando
    expect(sinMencionDeConsulta('Por ser una cantidad grande, lo estoy consultando con el local. ¿Está completo el pedido?')).toBe('¿Está completo el pedido?');
    expect(sinMencionDeConsulta('Ya te confirmo por acá.')).toBe('');
    expect(sinMencionDeConsulta('Tomo tu consulta y doy aviso al equipo.')).toBe('');
    expect(sinMencionDeConsulta('Del PerSe no tengo ahora, ya te confirmo si entra.')).toBe('Del PerSe no tengo ahora.');
    expect(sinMencionDeConsulta('Te paso con una persona del local, te contesta por acá.')).toBe('Te paso con una persona del local.');
  });
  it('no toca lo que no habla de una consulta (los plazos sueltos los cubre el prompt)', () => {
    for (const t of ['Recibido.', 'Te aviso que los domingos no hay reparto.', 'Te anoto 2 Judas para retirar en un rato.', 'De Raquis Monasterio no tengo ahora.', 'Esa cantidad no la tengo disponible ahora.', 'Te paso por acá los precios:', 'Cuando transfieras, mandame el comprobante por acá.'])
      expect(sinMencionDeConsulta(t)).toBe(t);
  });
});
describe('revisión del aviso (5/10/2026): lo que promete y lo que no', () => {
  it('«te lo confirmo» que afirma un dato, en pasado o como pregunta no es promesa y sale tal cual', () => {
    for (const t of [
      'Sí, te lo confirmo: $317.100.',
      'Sí, te lo confirmo: el domingo abrimos de 10 a 14.',
      'Sí, te lo confirmo, el retiro es en la sucursal Saint Thomas, Castex 3601.',
      // un «sí» delante: contesta «¿me confirmás que…?», no promete nada
      'Sí, te lo confirmo.',
      'Si te lo confirmo!',
      'Ya te confirmé el pedido PICKUP-AB12.',
      'Sí, ya te confirmamos el pedido PICKUP-AB12.',
      'Te confirmo que el envío es sin cargo.',
      'Podés consultar con tu banco.',
      'Te consulto, ¿es para retirar?',
    ]) {
      expect(mencionaConsulta(t)).toBe(false);
      expect(sinPromesas(t)).toBe(t);
      expect(sinMencionDeConsulta(t)).toBe(t);
    }
  });
  it('con una marca de después, cerrando la oración o con «ya» delante, sí promete', () => {
    for (const t of ['Lo de la caja te lo confirmo por acá.', 'Lo de la caja te lo confirmo.', 'Ya te confirmo.', 'Ya te confirmo el horario.', 'Te confirmo si entra.', 'Te lo confirmo apenas lo tenga.', 'Te lo confirmo más tarde.', 'Recibido, le confirmo por acá.', 'Te lo confirman por acá.', 'Lo tengo que consultar.', 'Dejame consultarlo.', 'Sí, te lo confirmo por acá.', 'Sí, ya te confirmo.'])
      expect(mencionaConsulta(t)).toBe(true);
    expect(sinPromesas('Lo consultamos y te digo.')).toBe('');
  });
  it('el tema de lo prometido sale de la oración', () => {
    expect(temaDeLaPromesa('Dale, Pablo, te los dejo a tu nombre. La caja te la confirmo por acá.')).toBe('la caja');
    expect(temaDeLaPromesa('Lo de la caja para viajar te lo confirmo por acá.')).toBe('la caja para viajar');
    expect(temaDeLaPromesa('Te confirmo por acá lo del Catena.')).toBe('el Catena');
    expect(temaDeLaPromesa('Sobre la caja, ya te confirmo por acá.')).toBe('la caja');
    expect(temaDeLaPromesa('Ya te confirmo por acá.')).toBe('');
    expect(temaDeLaPromesa('Sí, te lo confirmo: $317.100.')).toBe('');
  });
});

describe('revisión del aviso (5/10/2026): el tema no deja pasar basura ni lo interno', () => {
  it.each(['N/A', 'ninguno', 'undefined', '</parameter>', '<b>la caja</b>', 'las 2 botellas de Santa Inés', 'el Rutini en Saint Thomas', 'las 3 disponibles del Rutini', 'la caja, te la confirmo', 'lo que tenemos del Rutini'])('«%s» → sin tema', (t) => {
    expect(temaDeConsulta(t)).toBe('');
    // y la respuesta del área va tal cual, sin encabezado con basura
    expect(respuestaDelAreaParaCliente(t, 'Sí, vienen en estuche.')).toBe('Sí, vienen en estuche.');
  });
});
describe('revisión del aviso (5/10/2026): la misma consulta, sin juntar de más', () => {
  const caja1602 = 'Cliente viaja a España: ¿Judas Malbec 750, Catena Zapata Malbec Argentino 750 y Conjuro Bressia 750 vienen en caja/estuche individual? ¿Tenemos embalaje para llevar en avión?';
  it('dos temas propios distintos son dos cosas, aunque compartan la marca', () => {
    expect(mismaConsulta({ consulta: '¿Tenemos Catena Zapata Malbec Argentino en magnum 1,5 L?', tema: 'el Catena Zapata en magnum' }, { consulta: caja1602, tema: 'la caja para viajar' })).toBe(false);
    expect(mismaConsulta({ consulta: '¿El Rutini Cabernet Malbec viene con estuche?', tema: 'el estuche del Rutini' }, { consulta: '¿Entra el Rutini Cabernet Malbec 750 esta semana?', tema: 'el Rutini Cabernet Malbec' })).toBe(false);
  });
  it('un tema genérico («el envío») no alcanza: la dirección nueva corta la coincidencia', () => {
    expect(mismaConsulta({ consulta: '¿Llegamos a Barrio El Carmen, lote 45, Berazategui el sábado?', tema: 'el envío' }, { consulta: '¿Llegamos a Ruta 52 km 30, Canning el sábado?', tema: 'el envío' })).toBe(false);
  });
  it('otro producto de la misma bodega no es la misma consulta', () => {
    expect(mismaConsulta({ consulta: '¿Hay Catena Zapata Adrianna Vineyard?' }, { consulta: '¿Hay Catena Zapata Malbec Argentino?' })).toBe(false);
  });
  it('el mismo tema con un dato nuevo sí (el dato le llega al área aparte)', () => {
    expect(mismaConsulta({ consulta: 'Si no hay Casancrem, que mandemos el descremado', tema: 'el Casancrem' }, { consulta: '¿Hay Casancrem tapa roja?', tema: 'el Casancrem' })).toBe(true);
    expect(mismoTema('la caja', 'la caja para viajar')).toBe(true);
    expect(mismoTema('el envío', 'el envío')).toBe(false);
  });
  it('la red de respaldo reconoce la abierta por lo prometido o porque el cliente no trae nada nuevo; un archivo nuevo es nuevo', () => {
    const abiertas = [{ id: 'f7', consulta: caja1602, tema: null }];
    expect(consultaAbiertaQueNombra({ textoCliente: '¿Y lo de la caja?', prometio: true }, abiertas)?.id).toBe('f7');
    expect(consultaAbiertaQueNombra({ temaPrometido: 'la caja', textoCliente: 'En un ratito los paso a buscar, a nombre de Pablo', prometio: true }, abiertas)?.id).toBe('f7');
    expect(consultaAbiertaQueNombra({ textoCliente: '¿Tenés el Catena en magnum?', prometio: true }, abiertas)).toBeNull();
    expect(consultaAbiertaQueNombra({ textoCliente: '', conArchivo: true }, abiertas)).toBeNull();
    expect(consultaAbiertaQueNombra({ textoCliente: '¿cuánto sale?', prometio: false }, abiertas)).toBeNull();
  });
});

describe('revisión del aviso (5/10/2026): sumar sin perder lo último y sin repetir', () => {
  it('pasado el tope se conserva la pregunta original y la suma más nueva', () => {
    const sumas = Array.from({ length: 9 }, (_, i) => `suma ${i} ${'x'.repeat(200)}`);
    let t = 'ORIGINAL: ¿hay Café Cabrales molido?';
    for (const s of sumas) t = juntarConsulta(t, s);
    expect(t.length).toBeLessThanOrEqual(2000);
    expect(t.startsWith('ORIGINAL: ¿hay Café Cabrales molido?')).toBe(true);
    expect(t).toContain('suma 8');
    expect(juntarConsulta('a', 'b')).toBe('a\n+ b');
  });
});

describe('sin cargo, desde el mínimo (Leandro, 9/10/2026: «la compra mínima para el envío sin cargo son 70.000 pesos»)', () => {
  it('22:21 «¿Siempre es sin cargo el envío?» → nunca «siempre»: con el mínimo', () => {
    expect(envioSinCargo('Sí, el envío es siempre sin cargo.')).toBe('Sí, el envío es sin cargo en pedidos desde $70.000.');
  });
  it('22:15 «El envío es sin cargo. Si querés que te lo mandemos…» → con el mínimo, una sola vez', () => {
    expect(envioSinCargo('El envío es sin cargo. Si querés que te lo mandemos, pasame el nombre de quien recibe y la dirección con calle y número.'))
      .toBe('El envío es sin cargo en pedidos desde $70.000. Si querés que te lo mandemos, pasame el nombre de quien recibe y la dirección con calle y número.');
  });
  it('no toca lo que ya dice el mínimo, ni el resumen o la confirmación de un envío', () => {
    for (const t of ['El envío es sin cargo en pedidos desde $70.000.', 'El envío a domicilio es para pedidos desde $70.000 y este suma $45.000.', 'Pedido DOM-ABC confirmado. Total: $80.000.\nEnvío sin cargo a Mitre 1234. Se abona al recibir, en efectivo.']) {
      expect(envioSinCargo(t)).toBe(t);
    }
  });
});
