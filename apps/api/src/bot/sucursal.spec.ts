import { sinLoConsulto, retiroOEnvio, sinCocinaInterna, minimoConMonto, asegurarEnvioSinCargo, campoLimpio, casiIgual, emprolijarListado, esAlucinacionDeTranscripcion, respuestaConConsulta, esAutomaticoWhatsappBusiness, envioSinCargo, nombreSucursalCliente, saintThomas } from './prolijo';
import { acuseDe, conAviso, consultaAbiertaQueNombra, consultaSinRepetir, juntarConsulta, mismaConsulta, mismoTema, prometeConsultar, sinPromesas, temaDeConsulta, temaDeLaPromesa, todaviaNoLoTengo } from './prolijo';

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
    expect(asegurarEnvioSinCargo('Cuanto es el flete? me cobran el reparto aparte no?', 'Ya te confirmo por acá.'))
      .toBe('El envío es sin cargo. Ya te confirmo por acá.');
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
  // 5/10/2026: el segundo argumento son los temas de las consultas NUEVAS del
  // turno (antes era el último mensaje del bot); '' = consulta sin tema
  it('manda lo que sabe y el aviso una vez, con el tema', () => {
    const r = respuestaConConsulta('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200. Las picadas las consulto y te confirmo por acá.', ['las picadas armadas']);
    expect(r).toBe('Coca Cola Zero 1,75 L a $4.700 y chips a $1.200.\n\nLo de las picadas armadas te lo confirmo por acá.');
  });
  it('conserva la lista renglón por renglón', () => {
    const r = respuestaConConsulta('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200\nLas picadas las consulto y te confirmo por acá.', ['']);
    expect(r).toBe('• 10 × Coca Cola Zero 1,75 L = $47.000\n• 4 × Papas Lays 330 g = $49.200\nTotal: $96.200\n\nYa te confirmo por acá.');
  });
  it('sin nada útil: solo el aviso (sin tema, el genérico)', () => {
    expect(respuestaConConsulta('', [''])).toBe('Ya te confirmo por acá.');
    expect(respuestaConConsulta('Lo estoy consultando y te aviso en breve.', [''])).toBe('Ya te confirmo por acá.');
    expect(respuestaConConsulta('Lo consulto y vuelvo a vos.', ['el contenido del kit'])).toBe('Lo del contenido del kit te lo confirmo por acá.');
  });
  it('el aviso sale una sola vez aunque el modelo lo diga con otras palabras (tono-02, 23/9/2026)', () => {
    expect(respuestaConConsulta('Queda registrada la consulta. En cuanto tenga la respuesta, te la paso por acá.', [''])).toBe('Ya te confirmo por acá.');
    // el modelo escribió su propio aviso: se saca y va el del sistema, una vez (antes salían los dos)
    const m8 = 'Podés llevar una de cada una o tres iguales, el precio por botella es el mismo.';
    expect(respuestaConConsulta(`${m8} Lo de las cajas individuales te lo confirmo por acá.`, ['la caja para viajar']))
      .toBe(`${m8}\n\nLo de la caja para viajar te lo confirmo por acá.`);
  });
  it('si la consulta ya estaba abierta y avisada, no hay aviso', () => {
    expect(respuestaConConsulta('', [])).toBe('');
    expect(respuestaConConsulta('El fernet está a $20.500.', [])).toBe('El fernet está a $20.500.');
    expect(respuestaConConsulta('El fernet está a $20.500. Ya te confirmo por acá lo del otro.', [])).toBe('El fernet está a $20.500.');
  });
});

describe('el aviso dice de qué se trata (Leandro, 5/10/2026: "que sea más directo")', () => {
  it('«Lo de <tema> te lo confirmo por acá.», con la contracción del', () => {
    expect(acuseDe('la caja para viajar')).toBe('Lo de la caja para viajar te lo confirmo por acá.');
    expect(acuseDe('el PerSe Inseparable')).toBe('Lo del PerSe Inseparable te lo confirmo por acá.');
    expect(acuseDe('El PerSe Inseparable.')).toBe('Lo del PerSe Inseparable te lo confirmo por acá.');
    expect(acuseDe('lo de la caja')).toBe('Lo de la caja te lo confirmo por acá.');
    expect(acuseDe('«las cajas individuales»')).toBe('Lo de las cajas individuales te lo confirmo por acá.');
  });
  it('sin tema, o con algo interno, el genérico', () => {
    expect(acuseDe('')).toBe('Ya te confirmo por acá.');
    expect(acuseDe(null)).toBe('Ya te confirmo por acá.');
    expect(acuseDe('el stock de la sucursal Saint Thomas')).toBe('Ya te confirmo por acá.');
    expect(acuseDe('si hay 6 unidades')).toBe('Ya te confirmo por acá.');
    expect(acuseDe('lo que diga compras del Raquis')).toBe('Ya te confirmo por acá.');
    expect(acuseDe('una frase larguísima que no es un tema sino una explicación entera de todo')).toBe('Ya te confirmo por acá.');
    expect(temaDeConsulta('la caja para viajar')).toBe('la caja para viajar');
  });
  it('si la consulta ya estaba abierta, no se repite el aviso: todavía no está', () => {
    expect(todaviaNoLoTengo('la caja para viajar')).toBe('Lo de la caja para viajar todavía no lo tengo.');
    expect(todaviaNoLoTengo('el PerSe Inseparable', true)).toBe('Lo del PerSe Inseparable sigue pendiente.');
    expect(todaviaNoLoTengo('')).toBe('Eso todavía no lo tengo.');
  });
});

describe('el aviso va antes de la pregunta al cliente (mensaje 2 de Pablo, 5/10/2026)', () => {
  const M2 = 'Del PerSe Inseparable no tengo ahora, ya te confirmo por acá si entra. En esa misma línea de Gualtallary sí tengo:\n• Adrianna River Malbec 750 cc — $182.000, o $163.800 en efectivo o transferencia\n\nPor ahora quedan anotados:\n• 1 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
  it('lista + «¿Está completo…?» + consulta nueva del PerSe: el aviso una vez, antes de la pregunta', () => {
    const r = respuestaConConsulta(M2, ['el PerSe Inseparable']);
    const aviso = 'Lo del PerSe Inseparable te lo confirmo por acá.';
    expect(r.split(aviso)).toHaveLength(2);
    expect(r.trim().endsWith(`${aviso}\n\n¿Está completo el pedido o querés sumar algo?`)).toBe(true);
    // la información de la oración mixta no se pierde
    expect(r.startsWith('Del PerSe Inseparable no tengo ahora. En esa misma línea')).toBe(true);
    expect(r).not.toMatch(/ya te confirmo/i);
    expect(r).toContain('• 1 × Bressia Conjuro 750 cc');
  });
  it('«¿Lo confirmo?» sigue siendo la última línea', () => {
    const resumen = '• Judas Malbec — 2 × $79.900 c/u = $159.800\nTotal: $159.800\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    expect(conAviso(resumen, 'Lo de la caja te lo confirmo por acá.'))
      .toBe('• Judas Malbec — 2 × $79.900 c/u = $159.800\nTotal: $159.800\nRetiro en la sucursal Saint Thomas.\n\nLo de la caja te lo confirmo por acá.\n\n¿Lo confirmo?');
  });
  it('una pregunta al final de un párrafo: el aviso entra justo antes, en el mismo renglón', () => {
    expect(conAviso('Dale, Pablo, te los dejo a tu nombre. ¿Los retirás hoy?', 'Lo de la caja te lo confirmo por acá.'))
      .toBe('Dale, Pablo, te los dejo a tu nombre. Lo de la caja te lo confirmo por acá. ¿Los retirás hoy?');
    expect(conAviso('Tengo el Judas, ¿te lo reservo?', 'Lo de la caja te lo confirmo por acá.'))
      .toBe('Lo de la caja te lo confirmo por acá.\n\nTengo el Judas, ¿te lo reservo?');
  });
  it('sin pregunta al final, el aviso va al final', () => {
    expect(conAviso('El Judas está a $79.900.', 'Lo de la caja te lo confirmo por acá.')).toBe('El Judas está a $79.900.\n\nLo de la caja te lo confirmo por acá.');
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
  it('una promesa sin herramienta se reconoce también en las formas que saca sinLoConsulto', () => {
    for (const t of ['Voy a consultar si entra.', 'Lo consultamos y te digo.', 'Lo verifico con el local.', 'Te lo confirmo por acá.', 'Ya te confirmo.'])
      expect(prometeConsultar(t)).toBe(true);
    for (const t of ['¿Lo confirmo?', 'El envío es sin cargo.', 'Pedido PICKUP-AB12 confirmado.', '¿Te lo confirmo así?'])
      expect(prometeConsultar(t)).toBe(false);
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

describe('el aviso de una consulta ya abierta no se repite (5/10/2026: por consulta, no por mensaje)', () => {
  it('sin consultas nuevas en el turno, no se agrega', () => {
    expect(respuestaConConsulta('El envío es sin cargo.', [])).toBe('El envío es sin cargo.');
  });
});

describe('el flete se contesta aunque haya una consulta pendiente', () => {
  it('consulta ya avisada + pregunta por el flete = "El envío es sin cargo."', () => {
    const vacia = respuestaConConsulta('', []);
    expect(vacia).toBe('');
    expect(asegurarEnvioSinCargo('Cuanto es el flete? me cobran el reparto aparte no?', vacia)).toBe('El envío es sin cargo.');
  });
});

describe('prohibido "lo consulto" (Leandro, 1/10/2026)', () => {
  it('se saca la oración; el aviso ya no lo pega acá (lo arma un solo lugar, 5/10/2026)', () => {
    expect(sinLoConsulto('El precio vigente es $4.700.\n\nYa te confirmo por acá.')).toBe('El precio vigente es $4.700.\n\nYa te confirmo por acá.');
    // antes: '¿Está completo el pedido?\n\nYa te confirmo por acá.' (el aviso abajo de la pregunta)
    expect(sinLoConsulto('Por ser una cantidad grande, lo estoy consultando con el local. ¿Está completo el pedido?')).toBe('¿Está completo el pedido?');
    expect(sinLoConsulto('Ya te confirmo por acá.')).toBe('Ya te confirmo por acá.');
  });
  it('no toca lo que no habla de consultar', () => {
    const t = 'Recibido.';
    expect(sinLoConsulto(t)).toBe(t);
    expect(sinLoConsulto('Tomo tu consulta y doy aviso al equipo.')).toBe('Tomo tu consulta y doy aviso al equipo.');
  });
});

// REVISIÓN DEL 5/10/2026: los casos que encontraron los revisores
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
      expect(prometeConsultar(t)).toBe(false);
      expect(sinPromesas(t)).toBe(t);
    }
    expect(sinLoConsulto('Te consulto, ¿es para retirar?')).toBe('Te consulto, ¿es para retirar?');
    expect(sinLoConsulto('Podés consultar con tu banco.')).toBe('Podés consultar con tu banco.');
  });
  it('con una marca de después, cerrando la oración o con «ya» delante, sí promete', () => {
    for (const t of ['Lo de la caja te lo confirmo por acá.', 'Lo de la caja te lo confirmo.', 'Ya te confirmo.', 'Ya te confirmo el horario.', 'Te confirmo si entra.', 'Te lo confirmo apenas lo tenga.', 'Te lo confirmo más tarde.', 'Recibido, le confirmo por acá.', 'Te lo confirman por acá.', 'Lo tengo que consultar.', 'Dejame consultarlo.', 'Sí, te lo confirmo por acá.', 'Sí, ya te confirmo.'])
      expect(prometeConsultar(t)).toBe(true);
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
  it.each(['N/A', 'ninguno', 'undefined', '</parameter>', '<b>la caja</b>', 'las 2 botellas de Santa Inés', 'el Rutini en Saint Thomas', 'las 3 disponibles del Rutini', 'la caja, te la confirmo', 'lo que tenemos del Rutini'])('«%s» → el genérico', (t) => {
    expect(acuseDe(t)).toBe('Ya te confirmo por acá.');
    expect(temaDeConsulta(t)).toBe('');
  });
});

describe('revisión del aviso (5/10/2026): nunca pegado abajo de una pregunta', () => {
  const aviso = 'Lo de la caja te lo confirmo por acá.';
  it('dos preguntas al final, en renglones seguidos: el aviso va antes de la primera', () => {
    expect(conAviso('Te anoté el Judas.\n¿Te sirve el Adrianna River?\n¿Está completo el pedido o querés sumar algo?', aviso))
      .toBe(`Te anoté el Judas.\n\n${aviso}\n\n¿Te sirve el Adrianna River?\n¿Está completo el pedido o querés sumar algo?`);
  });
  it('dos preguntas en el mismo renglón: el aviso entra antes de la primera', () => {
    expect(respuestaConConsulta('Dale. ¿Retirás hoy? ¿A nombre de quién?', ['la caja'])).toBe(`Dale. ${aviso} ¿Retirás hoy? ¿A nombre de quién?`);
  });
  it('un importe con punto o unos puntos suspensivos no cortan la oración', () => {
    expect(conAviso('Hola... ¿qué tal? El precio es $4.700. ¿Te lo anoto?', 'AVISO.')).toBe('Hola... ¿qué tal? El precio es $4.700. AVISO. ¿Te lo anoto?');
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
  it('lo armado con el aviso no repite el último mensaje del bot', () => {
    expect(consultaSinRepetir('Ya te confirmo por acá.', 'Ya te confirmo por acá.', [''])).toBe('Eso también te lo confirmo por acá.');
    expect(consultaSinRepetir('Lo de la caja para viajar todavía no lo tengo.', 'Lo de la caja para viajar todavía no lo tengo.', [], ['la caja para viajar'])).toBe('Lo de la caja para viajar sigue pendiente.');
    expect(consultaSinRepetir('El Judas está a $79.900.', 'Otra cosa.', [''])).toBe('El Judas está a $79.900.');
  });
});
