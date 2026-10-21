// CUÁNDO CALLA EL BOT (21/10/2026), con las frases reales de la semana del 15 al 21/10: lo que
// los clientes, los proveedores y los conocidos de Jaqueline le escribieron a la línea de pedidos.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  aceptaNoContestar, botOfrecioAlgo, cierraConPreguntaPendiente, confirmaLaLista, esCierreDeCharla, esDespedida, esDespedidaPura, escritoPorUnaPersona,
  esperaRespuesta, esSoloSocial, HORAS_SIGUE_PERSONA, insiste, loUltimoDeLaCasaEsDeUnaPersona, nombraAAlguienDeLaCasa, paraElModelo, pideCompra,
  silencioPorReglas, telefonosDeLaCasa, terminaEnCierre, traeOtroTelefono,
} from './silencio';
import { esTextoInterno, explicaQueNoContesta, NOMBRES_INTERNOS } from './prolijo';
import { HERRAMIENTAS_PEDIDOS, HERRAMIENTAS_PROVEEDORES, SYSTEM_PEDIDOS } from './agente-bot';

// lo que mandaron los clientes (a veces nombrando a Jaqueline): esperan respuesta
const LOTE_112 = ['Buen diaa Jaky! te paso el pedido de la sra Fabiana', '6 yogurt bebibles Prot+ (proteico)\nbuen día', 'si puede enviarme éstos pedidos de lote 112'];
const CLIENTES_QUE_COMPRAN = [
  ...LOTE_112,
  '¿Te puedo pedir 2 picadas sin tacc para mañana? ¿Cuánto salen?',
  'Te puedo encargar una picada para este sábado',
  '¿Tendrás el contacto de odb fruit?',
  'Hola consulta\nCuál es el precio de este gin',
  'Hola Jackie, ¿me mandás 4 fernet?',
];
// lo que le mandaron a Jaqueline proveedores y conocidos: no es para el bot
const PARA_JAQUELINE = [
  'Hola buen día! no me pasaste nada!\nde esto digo',
  'Hola Jaqueline, buen día, si hoy se los paso',
  'Jacqui, feliz día!!',
  'Hola ya estoy\n¿Querés pasar?',
  'Cómo estás, qué te llevo mañana',
  'Jaqui buen día\n¿Necesitás mercadería?\nHoy a la tarde cargo la lista de precios nueva',
  'Buen día Jaqueline. ¿Pudieron ver nuestra propuesta?',
  'Acá está el logo',
  'Mañana a la mañana paso.',
  'Hola Shaki, feliz día. Espero que pases un día precioso',
  'Feliz día Jacqui\nUn abrazo',
];

describe('a quién le habla y qué pide', () => {
  it.each([
    'Buen diaa Jaky! te paso el pedido de la sra Fabiana', 'Hola Shaky, ahora lo veo en una hora y lo corrijo.', 'Jacqui, feliz día!!',
    'Hola Jaqueline, buen día', '¿Y materas Jacky?', 'Hola Shaki, feliz día', 'Jaqui buen día', 'hola, está Jacqueline?', 'Hola Jackie! como andas?',
  ])('«%s» nombra a alguien de la casa', (t) => expect(nombraAAlguienDeLaCasa(t)).toBe(true));

  it.each(['Hola, ¿tienen hielo?', 'Me encanta Shakira', 'Quiero 2 fernet'])('«%s» no nombra a nadie de la casa', (t) => expect(nombraAAlguienDeLaCasa(t)).toBe(false));

  it.each(CLIENTES_QUE_COMPRAN)('«%s» pide algo que la casa vende o resuelve', (t) => expect(pideCompra(t)).toBe(true));

  it.each(PARA_JAQUELINE)('«%s» no pide nada que la casa venda', (t) => expect(pideCompra(t)).toBe(false));
});

describe('cierres', () => {
  // los que del 15 al 21/10 abrieron una consulta falsa a administración
  const CIERRES = ['Ok, graciasN', 'Ahh ok.', 'Muy buena!!!\nJajaja', 'Excelente buenísimo!! Nos vemos☺️', 'Buenos días, gracias', 'Graciasss', '👍', 'Muy amablees'];
  it.each(CIERRES)('«%s» es un cierre (también antes de llamar al modelo)', (t) => {
    expect(esCierreDeCharla(t)).toBe(true);
    expect(esCierreDeCharla(t, { conAfirmacion: true })).toBe(true);
  });

  // un «sí» o un «ok» pueden contestar algo o pedirlo: antes del modelo, no se callan
  it.each(['Sí, dale', 'Sii', 'Hola!!! Ok', 'ok'])('«%s» solo es cierre cuando el modelo ya no escribió nada', (t) => {
    expect(esCierreDeCharla(t)).toBe(false);
    expect(esCierreDeCharla(t, { conAfirmacion: true })).toBe(true);
  });

  it.each(['Sí, mandame una bolsa', 'Dale, confirmalo', 'a', 'Hola', 'Buenas noches', '¿gracias?', 'Nada más', 'Paso a las 18 a buscarlo', 'Gracias! Que me contacten'])(
    '«%s» no es un cierre', (t) => expect(esCierreDeCharla(t, { conAfirmacion: true })).toBe(false));

  it('termina en cierre: «Bueno, gracias!!» después de otra cosa, sin pregunta ni pedido', () => {
    expect(terminaEnCierre('Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!')).toBe(true);
    expect(terminaEnCierre('Te paso el pedido: 2 fernet. Gracias!')).toBe(false);
    expect(terminaEnCierre('¿Tienen el coreano? Gracias')).toBe(false);
    expect(terminaEnCierre('Gracias! Que me contacten')).toBe(false);
  });

  it('una despedida no espera respuesta; con una pregunta del bot pendiente, solo la pura o un «no, gracias»', () => {
    expect(esDespedida('Ok, graciasN')).toBe(true);
    expect(esperaRespuesta('Ok, graciasN', { botDejoPregunta: false })).toBe(false);
    expect(esperaRespuesta('Excelente buenísimo!! Nos vemos☺️', { botDejoPregunta: false })).toBe(false);
    expect(esperaRespuesta('Muchas gracias!', { botDejoPregunta: true })).toBe(false);
    expect(esperaRespuesta('No, gracias', { botDejoPregunta: true })).toBe(false);
    // (revisión del 21/10/2026) un «ok» con la despedida contesta la pregunta
    expect(esperaRespuesta('Ok, graciasN', { botDejoPregunta: true })).toBe(true);
  });

  it('un «ok» o un «sí» esperan respuesta solo si contestan una pregunta del bot; lo demás, sí', () => {
    expect(esperaRespuesta('ok', { botDejoPregunta: true })).toBe(true);
    expect(esperaRespuesta('ok', { botDejoPregunta: false })).toBe(false);
    expect(esperaRespuesta('sí', { botDejoPregunta: false })).toBe(false);
    expect(esperaRespuesta('Paso a las 18 a buscarlo', { botDejoPregunta: false })).toBe(true);
    expect(esperaRespuesta('¿y el de litro?', { botDejoPregunta: false })).toBe(true);
    expect(esperaRespuesta('gracias', { botDejoPregunta: false, conArchivo: true })).toBe(true);
  });
});

describe('no_contestar: lo pide el modelo, lo decide el código', () => {
  it.each(LOTE_112)('lote 112 «%s»: se rechaza (es una clienta pasando un pedido)', (t) => {
    expect(aceptaNoContestar('para_la_casa', t)).toMatchObject({ ok: false });
  });
  it.each(PARA_JAQUELINE)('«%s»: se acepta para la casa', (t) => {
    expect(aceptaNoContestar('para_la_casa', t)).toEqual({ ok: true });
  });
  it('a un proveedor se le acepta siempre, aunque nombre cantidades', () => {
    expect(aceptaNoContestar('para_la_casa', '30 cajas de napolitana para el jueves', { esProveedor: true })).toEqual({ ok: true });
    expect(aceptaNoContestar('para_la_casa', '30 cajas de napolitana para el jueves')).toMatchObject({ ok: false });
  });
  it('un cierre no trae pregunta; un motivo inventado no vale', () => {
    expect(aceptaNoContestar('cierre', 'Ok, gracias')).toEqual({ ok: true });
    expect(aceptaNoContestar('cierre', 'Gracias, ¿abren el domingo?')).toMatchObject({ ok: false });
    expect(aceptaNoContestar('porque si', 'hola')).toMatchObject({ ok: false });
    // un «sí» a «¿Te lo anoto?» contesta la pregunta: no es un cierre; «gracias» sí
    expect(aceptaNoContestar('cierre', 'sí', { botDejoPregunta: true })).toMatchObject({ ok: false });
    expect(aceptaNoContestar('cierre', 'Muchas gracias!', { botDejoPregunta: true })).toEqual({ ok: true });
    expect(aceptaNoContestar('cierre', 'Ok, gracias', { botDejoPregunta: false })).toEqual({ ok: true });
  });
  it('del otro lado un bot (Botmaker, 20/10): se acepta', () => {
    expect(aceptaNoContestar('automatico', 'Hola Emilia, entiendo que querés confirmar…\nEntiendo que me comentás que por este chat no se coordinan reuniones…')).toEqual({ ok: true });
  });
});

describe('las reglas cuando el modelo no escribió nada', () => {
  const sin = { botDejoPregunta: false };
  it('un proveedor: para la casa, sin consulta; su «gracias» es un cierre (sin nota para nadie)', () => {
    expect(silencioPorReglas('Hola buen día! no me pasaste nada!\nde esto digo', { ...sin, esProveedor: true })).toBe('para_la_casa');
    expect(silencioPorReglas('Ok, gracias', { ...sin, esProveedor: true })).toBe('cierre');
  });
  it('la charla la venía llevando una persona y no pide nada: para la casa', () => {
    expect(silencioPorReglas('Acá está el logo', { ...sin, siguePersona: true })).toBe('para_la_casa');
    expect(silencioPorReglas('¿hasta qué hora puedo pasar a dejar el atril para el 31?', { ...sin, siguePersona: true })).toBe('para_la_casa');
  });
  it('si pide algo, nunca: la clienta del lote 112, aunque la charla viniera de una persona', () => {
    for (const t of LOTE_112) expect([t, silencioPorReglas(t, { ...sin, siguePersona: true, decidioNoContestar: true })]).toEqual([t, null]);
  });
  it('se registró como proveedor en el turno: para la casa (una nota_interna sola ya no alcanza: el modelo la deja también con clientes)', () => {
    expect(silencioPorReglas('Buen día Jaqueline. ¿Pudieron ver nuestra propuesta?', { ...sin, esProveedor: true })).toBe('para_la_casa');
  });
  it('nombra a alguien de la casa: para la casa solo si es un saludo o una felicitación, o si el modelo explicó que no era para él (revisión 21/10)', () => {
    expect(silencioPorReglas('Jacqui, feliz día!!', sin)).toBe('para_la_casa');
    expect(silencioPorReglas('Hola Shaki, feliz día. Espero que pases un día precioso', sin)).toBe('para_la_casa');
    expect(silencioPorReglas('Feliz día Jacqui\nUn abrazo', sin)).not.toBeNull();
    // lo demás va a la otra vuelta (y a la consulta si sigue vacía), como en producción
    expect(silencioPorReglas('Hola Jaqueline, buen día, si hoy se los paso', sin)).toBeNull();
    expect(silencioPorReglas('¿Y materas Jacky?', sin)).toBeNull();
    expect(silencioPorReglas('¿Y materas Jacky?', { ...sin, decidioNoContestar: true })).toBeNull();
    expect(silencioPorReglas('Jaqui buen día\n¿Necesitás mercadería?', { ...sin, decidioNoContestar: true })).toBe('para_la_casa');
  });
  it('un cierre o una despedida: cierre', () => {
    expect(silencioPorReglas('Ok, graciasN', sin)).toBe('cierre');
    expect(silencioPorReglas('Muchas gracias!', { botDejoPregunta: true })).toBe('cierre');
    expect(silencioPorReglas('Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!', sin)).toBe('cierre');
    expect(silencioPorReglas('sí', sin)).toBe('cierre');
    // un «sí» a una pregunta del bot no es un cierre: se le vuelve a pedir la respuesta al modelo
    expect(silencioPorReglas('sí', { botDejoPregunta: true })).toBeNull();
  });
  it('lo demás no se calla por reglas: un cliente común con una pregunta', () => {
    expect(silencioPorReglas('¿El Absolut es el de 750 o el de litro?', sin)).toBeNull();
    expect(silencioPorReglas('Hola Jackie! como andas?', sin)).toBeNull();
  });
});

describe('lo que escribió una persona desde el teléfono', () => {
  it('la marca de: telefono, y los rótulos de antes de la marca', () => {
    expect(escritoPorUnaPersona({ role: 'assistant', content: 'Necesito el logo', de: 'telefono' })).toBe(true);
    expect(escritoPorUnaPersona({ role: 'assistant', content: '🎙️ Audio enviado' })).toBe(true);
    expect(escritoPorUnaPersona({ role: 'assistant', content: '📷 Foto enviada: el logo' })).toBe(true);
    expect(escritoPorUnaPersona({ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' })).toBe(false);
    expect(escritoPorUnaPersona({ role: 'user', content: 'hola', de: 'telefono' })).toBe(false);
  });
  it('lo último de la casa: los mensajes seguidos de una persona, hasta uno del bot', () => {
    const en = new Date(Date.now() - 40 * 60_000).toISOString();
    const hilo = [
      { role: 'assistant', content: 'Buen día. ¿Qué necesitás?' },
      { role: 'user', content: 'Hola, ¿hacen remeras con logo?' },
      { role: 'assistant', content: 'Holaaz', de: 'telefono', en },
      { role: 'assistant', content: 'Necesito el logo', de: 'telefono', en },
    ];
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo).map((m) => m.content)).toEqual(['Holaaz', 'Necesito el logo']);
    expect(loUltimoDeLaCasaEsDeUnaPersona([...hilo, { role: 'assistant', content: 'Te anoto 2 remeras.' }])).toEqual([]);
    expect(loUltimoDeLaCasaEsDeUnaPersona([...hilo, { role: 'user', content: 'Acá está el logo' }])).toHaveLength(2);
  });
  it('a la API va solo rol y texto', () => {
    expect(paraElModelo([{ role: 'assistant', content: 'Necesito el logo', de: 'telefono' }])).toEqual([{ role: 'assistant', content: 'Necesito el logo' }]);
  });
});

describe('la insistencia', () => {
  it.each(['¿Puede por favor responderme?', 'Sigo esperando', '??', 'Hola??', 'Hay alguien?', '¿Alguna novedad?', '¿Saben algo?', 'Nadie me contesta'])('«%s» insiste', (t) => expect(insiste(t)).toBe(true));
  it.each(['¿Esa dice para PISOS DE MADERA PLASTIFICADOS?', 'Quiero 2 fernet', 'gracias', 'Hola'])('«%s» no insiste', (t) => expect(insiste(t)).toBe(false));
});

describe('los teléfonos que da la casa (el de Fruit, regla del 12/10)', () => {
  const permitidos = telefonosDeLaCasa(SYSTEM_PEDIDOS, '');
  it('el de Fruit está en el prompt y se puede dar', () => {
    expect(permitidos.has('1176369642')).toBe(true);
    expect(traeOtroTelefono('Para frutas y verduras escribile a Fruit: wa.me/5491176369642 (11 7636-9642).', permitidos)).toBe(false);
  });
  it('otro número sigue sin salir; uno de la información vigente sí', () => {
    expect(traeOtroTelefono('Para eso escribí al 11 2521-3601.', permitidos)).toBe(true);
    expect(traeOtroTelefono('Para eso escribí al 11 2521-3601.', telefonosDeLaCasa(SYSTEM_PEDIDOS, 'Wine Fest: consultas al 11 2521-3601'))).toBe(false);
  });
});

describe('texto interno: la narración se reconoce y las respuestas de verdad no se tocan', () => {
  // la fuga del 16/10 y lo que el modelo escribió del 16 al 21/10
  const FUGA = 'Este mensaje no lleva respuesta al cliente. Leandro le escribe a "Shaky", que parece ser alguien de la casa que le mandó la foto y el audio. Dice que lo revisa en una hora y lo corrige, así que no hay nada que contestarle ahora.\n\nLe dejé una nota al equipo. Lo importante: el pedido PICKUP-B2FE7627C0D9 quedó confirmado en $272.900, pero en la cotización sumaba $316.200.';
  const NO_CONTESTA = [
    FUGA,
    'Este mensaje es para Jaqueline, no para mí. Le dejé una nota al equipo.',
    'El mensaje va dirigido a Jackie: no contesto nada.',
    'Es para Jackie, no es para mí.',
    'El proveedor le habla a Jaqui, así que la respuesta queda vacía.',
    'Este mensaje no es para mí.',
  ];
  it.each(NO_CONTESTA.map((t) => [t]))('«%s» explica que no contesta', (t) => {
    expect(explicaQueNoContesta(t)).toBe(true);
  });
  it.each([
    'Le dejé una nota al equipo para que Jaqueline lo vea.',
    'El cliente pregunta por el Fernet. Sale $20.500.',
    'Nota interna: revisar el precio.',
    'Le paso el dato al cliente cuando conteste administración.',
    'Le confirmo al cliente que sale hoy.',
  ])('«%s» es texto interno', (t) => expect(esTextoInterno(t)).toBe(true));

  // las que la regla del 16/10 cortaba y son para el cliente
  it.each([
    'Este mensaje es para confirmarte que tu pedido DOM-ABC123 sale hoy entre las 15 y las 18 h.',
    'Te lo dejamos al cliente en la portería del barrio.',
    'Te lo dejamos en la guardia del barrio, a nombre del cliente que figura en el pedido.',
    'Le dejé una nota al repartidor para que toque timbre.',
    'Soy Emilia, la asistente de O.D.B. Jaqueline no está por acá ahora. ¿Qué necesitás?',
    'Para frutas y verduras escribile a Fruit: wa.me/5491176369642 (11 7636-9642).',
    'Te anoto:\n• 6 × Yogur bebible Prot+ 1 L\n¿Querés sumar algo y cómo lo pagás: efectivo, transferencia o tarjeta?',
  ])('«%s» es una respuesta al cliente: no es interna ni explica que no contesta', (t) => {
    expect(esTextoInterno(t)).toBe(false);
    expect(explicaQueNoContesta(t)).toBe(false);
  });
});

describe('el prompt (21/10/2026)', () => {
  it('quien nombra a alguien de la casa sigue siendo un cliente; callar es con la herramienta, nunca con la respuesta vacía', () => {
    expect(SYSTEM_PEDIDOS).toContain('Quien nombra a alguien de la casa sigue siendo un cliente');
    expect(SYSTEM_PEDIDOS).toContain('Todo lo que escribís le llega al cliente tal cual');
    expect(SYSTEM_PEDIDOS).toMatch(/llamá no_contestar/);
    expect(SYSTEM_PEDIDOS).not.toMatch(/le habla por su nombre a alguien de la casa, o contesta lo que le mandó una persona desde el teléfono— no escribas nada/);
    expect(SYSTEM_PEDIDOS).not.toMatch(/tu respuesta queda vacía/);
  });
  it('lo que nombra una foto que no vino se pregunta, no se consulta', () => {
    expect(SYSTEM_PEDIDOS).toMatch(/en este turno no vino ningún archivo[^.]*preguntale en una línea cuál es/);
  });
});


// ============================================================
// REVISIÓN DEL 21/10/2026 (los hallazgos sobre la rama bot-silencio)
// ============================================================
// las 17 narraciones que les llegaron a clientes y proveedores del 21/9 al 21/10 (bot_mensajes, línea
// pedidos), además de la fuga del 16/10: el modelo narra en pasado y con el nombre del contacto
const NARRACIONES_REALES: { fecha: string; texto: string }[] = JSON.parse(readFileSync(join(__dirname, 'narraciones-reales.json'), 'utf8'));
const esInterno = (t: string) => esTextoInterno(t) || explicaQueNoContesta(t);

describe('revisión 21/10 · la barrera reconoce las narraciones reales', () => {
  it('son 17', () => expect(NARRACIONES_REALES).toHaveLength(17));
  it.each(NARRACIONES_REALES.map((n) => [n.fecha, n.texto]))('%s «%s» es interno', (_f, t) => expect(esInterno(t)).toBe(true));

  // la primera oración de cada una alcanza: el texto entero cuenta como interno (bot.service, recortarLoInterno)
  it.each([
    'No le respondí al cliente.', 'No le respondí nada al cliente en este turno.', 'No le escribí nada a Juan Manuel.',
    'No le mandé nada a Credifin esta vez.', 'No contesto este mensaje: es el proveedor La Máquina de Vender.',
    'Al transportista no le contesté nada: según las reglas de la casa, la respuesta le llega directo.',
  ])('«%s» explica que no contesta', (t) => expect(explicaQueNoContesta(t)).toBe(true));

  // las que la barrera vieja (fe2e6d4) paraba y la de la rama dejaba pasar
  it.each([
    'Le aclaré al cliente que atiende Emilia y le pasé los precios.', 'Le dejé una nota a compras.', 'Le dejé una nota a administración para que lo vean.',
    'Este mensaje es de un proveedor (Nestlé) ofreciendo mercadería a Jaqui.', 'La lista del cliente: 6 yogures', 'Datos del cliente: lote 112',
    'Es un proveedor ofreciéndole mercadería a Jaqueline; lo registro.', 'Es un proveedor de fiambres que le reclama a Jaqueline una lista.',
    'Registré al proveedor y le dejé nota a compras.', 'Lo registré como proveedor con un resumen.', 'Se lo pregunté a administración.',
    'Su única duda era si la segunda persona puede entrar.', 'Edward le escribió a Jackie sobre las cajas navideñas.',
    'La clienta le habla a Jacky. Tenemos materas de calabaza a $12.000.',
  ])('«%s» es interno', (t) => expect(esTextoInterno(t)).toBe(true));

  it('los nombres de las herramientas y de los motivos, escritos como texto, son internos (también las que se sumen)', () => {
    for (const h of [...HERRAMIENTAS_PEDIDOS, ...HERRAMIENTAS_PROVEEDORES]) expect([h.name, NOMBRES_INTERNOS.includes(h.name)]).toEqual([h.name, true]);
    expect(esTextoInterno('no_contestar (para_la_casa)')).toBe(true);
    expect(esTextoInterno('Llamo a no_contestar (para_la_casa): es para Jaqueline')).toBe(true);
    expect(esTextoInterno('Uso nota_interna para avisarle a compras.')).toBe(true);
    // un link de pago con guion bajo no es un nombre de herramienta
    expect(esTextoInterno('Te paso el link: https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc')).toBe(false);
  });

  it('las descriptivas son internas pero no dicen que no contesta (deciden las reglas, con otra vuelta)', () => {
    expect(explicaQueNoContesta('La clienta le habla a Jacky. Tenemos materas de calabaza a $12.000.')).toBe(false);
    expect(explicaQueNoContesta('Parece ser alguien de la casa.')).toBe(false);
  });

  it.each([
    'No hace falta responder ahora, avisame cuando quieras.',
    'No es para mí decidirlo, pero el envío es sin cargo.',
    'Le dejé una nota al repartidor para que toque timbre.',
    'Te lo dejamos en la guardia del barrio, a nombre del cliente que figura en el pedido.',
    'El queso es de un proveedor de Tandil y sale $9.800 el kilo.',
    'Te mandamos el pedido a tu casa entre las 15 y las 18 h.',
    // a un proveedor (25/9 y 15/10, respuestas de verdad)
    'Buen día. Te habla Emilia, la asistente de O.D.B. Ya le pasé a compras lo de las pastas y salsas De Cecco.',
    'Buenas tardes. Te damos la bienvenida a O.D.B. Soy Emilia. Registré el contacto y le pasé la propuesta a la encargada de compras.',
    'Fabio, todo lo que mandaste va junto a la encargada de compras.',
    'Esta vez no tenemos el Rutini Malbec, pero tengo el Trumpeter a $14.500.',
  ])('«%s» es para el cliente: sale entero', (t) => {
    expect(esTextoInterno(t)).toBe(false);
    expect(explicaQueNoContesta(t)).toBe(false);
  });
});

describe('revisión 21/10 · los pedidos a Jackie se contestan siempre', () => {
  const PEDIDOS_A_JACKIE = [
    'Jaqui necesito 2 picadas para mañana', 'Hola Jackie! 3 picadas XL para el sábado', 'Jackie quiero 2 Rutini',
    'Jacky me guardás 2 brie para el sábado', 'Jackie separame la picada XL', 'Jackie el lunes paso a retirar lo que te encargué',
    '¿Y materas Jacky?', 'Sí, reservámela para el sábado a las 12', 'Hola! Ya puedo pasar a buscarlo?', 'Sí, mandámelo',
  ];
  it.each(PEDIDOS_A_JACKIE)('«%s»: pide algo; no_contestar se rechaza y las reglas no lo callan', (t) => {
    expect(pideCompra(t)).toBe(true);
    expect(aceptaNoContestar('para_la_casa', t)).toMatchObject({ ok: false });
    expect(silencioPorReglas(t, { botDejoPregunta: false, siguePersona: true, decidioNoContestar: true })).toBeNull();
  });
  it.each(['Jacky, ¿te llegó la transferencia?', 'Ya te transferí', 'Te paso el comprobante', 'Pasame el alias'])('«%s»: un pago tampoco se calla', (t) => {
    expect(pideCompra(t)).toBe(true);
    expect(aceptaNoContestar('para_la_casa', t)).toMatchObject({ ok: false });
    expect(aceptaNoContestar('cierre', t)).toMatchObject({ ok: false });
  });
  it('«te quiero» no es un pedido; un saludo o una felicitación a Jackie sí se calla para la casa', () => {
    expect(pideCompra('Jacky te quiero mucho')).toBe(false);
    expect(esSoloSocial('Hola Shaki, feliz día. Espero que pases un día precioso')).toBe(true);
    expect(esSoloSocial('Hola Jaqueline, buen día, si hoy se los paso')).toBe(false);
  });
});

describe('revisión 21/10 · con una foto o un PDF no se calla (salvo a un proveedor)', () => {
  it('no_contestar con archivo se rechaza; a un proveedor registrado, para la casa, se acepta', () => {
    expect(aceptaNoContestar('para_la_casa', '', { conArchivo: true })).toMatchObject({ ok: false });
    expect(aceptaNoContestar('cierre', 'Graciass', { conArchivo: true })).toMatchObject({ ok: false });
    expect(aceptaNoContestar('para_la_casa', '', { conArchivo: true, esProveedor: true })).toEqual({ ok: true });
  });
  it('las reglas no callan una foto de un cliente, aunque la charla la llevara una persona o haya nota', () => {
    expect(silencioPorReglas('', { conArchivo: true, siguePersona: true })).toBeNull();
    expect(silencioPorReglas('Lote 112, la lista', { conArchivo: true })).toBeNull();
    expect(silencioPorReglas('', { conArchivo: true, esProveedor: true })).toBe('para_la_casa');
  });
});

describe('revisión 21/10 · lo de la persona cuenta unas horas, y no después de devolverle la charla al bot', () => {
  const hilo = (en?: string, de = 'telefono') => [{ role: 'user', content: '¿Me lo guardás?' }, { role: 'assistant', content: 'Dale, te lo guardo', de, ...(en ? { en } : {}) }];
  const ahora = Date.parse('2026-10-21T15:00:00-03:00');
  const hace = (h: number) => new Date(ahora - h * 3600_000).toISOString();
  it('de hace 40 minutos cuenta; de hace tres días no; sin hora (de antes del 21/10) no', () => {
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(hace(0.7)), { ahora })).toHaveLength(1);
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(hace(HORAS_SIGUE_PERSONA + 1)), { ahora })).toEqual([]);
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(hace(72)), { ahora })).toEqual([]);
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(), { ahora })).toEqual([]);
  });
  it('lo del panel, después de que se la devolvieron al bot a mano, no cuenta', () => {
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(hace(1), 'persona'), { ahora, devueltaAlBotEn: ahora - 30 * 60_000 })).toEqual([]);
    expect(loUltimoDeLaCasaEsDeUnaPersona(hilo(hace(1), 'persona'), { ahora })).toHaveLength(1);
  });
});

describe('revisión 21/10 · lo que termina en «Gracias» después de pedir algo no es un cierre', () => {
  const REALES = [
    'Hola quisiera saber hasta qué hora está abierto hoy la sucursal de Santa Inés . Gracias',
    'Hola buenas tardes\nMe podrias decir\nEn que horario esta abierto el negocio\nGracias',
    'No se que es eso q me ofreces\nNecesito destapar piletas de cocina\nGracias',
  ];
  it.each(REALES)('«%s»: espera respuesta y no se calla', (t) => {
    expect(terminaEnCierre(t)).toBe(false);
    expect(silencioPorReglas(t, { botDejoPregunta: false })).toBeNull();
    expect(esperaRespuesta(t, { botDejoPregunta: false })).toBe(true);
    expect(aceptaNoContestar('cierre', t, { botDejoPregunta: true })).toMatchObject({ ok: false });
    expect(aceptaNoContestar('cierre', t)).toMatchObject({ ok: false });
  });
  it('«Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!» sigue siendo un cierre, también con la pregunta del bot', () => {
    expect(terminaEnCierre('Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!')).toBe(true);
    expect(cierraConPreguntaPendiente('Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!')).toBe(true);
  });
});

describe('revisión 21/10 · con una pregunta, la lista o un ofrecimiento pendiente, «sí, gracias» contesta', () => {
  it.each(['Sí, gracias!', 'Ok gracias', 'Nada más, gracias', 'No, nada más. Gracias!', 'Listo, ya está, gracias', 'Genial, gracias'])('«%s»: no es un cierre', (t) => {
    expect(esDespedidaPura(t)).toBe(false);
    expect(cierraConPreguntaPendiente(t)).toBe(false);
    expect(aceptaNoContestar('cierre', t, { botDejoPregunta: true })).toMatchObject({ ok: false });
    expect(silencioPorReglas(t, { botDejoPregunta: true })).toBeNull();
    expect(esperaRespuesta(t, { botDejoPregunta: true })).toBe(true);
  });
  it.each(['Gracias', 'Muchas gracias!', 'Nos vemos, saludos', 'No, gracias'])('«%s»: sí es un cierre', (t) => {
    expect(cierraConPreguntaPendiente(t)).toBe(true);
    expect(aceptaNoContestar('cierre', t, { botDejoPregunta: true })).toEqual({ ok: true });
  });
  it('la lista del bot o un ofrecimiento sin «?» esperan un sí; un precio solo, no', () => {
    expect(botOfrecioAlgo('Te anoto:\n• 2 × Fernet Branca 750 ml\n• 1 × Coca-Cola 2,25 L')).toBe(true);
    expect(botOfrecioAlgo('Tengo el Rutini a $25.000. Te lo puedo reservar.')).toBe(true);
    expect(botOfrecioAlgo('Si querés, te lo anoto.')).toBe(true);
    expect(botOfrecioAlgo('El Fernet Branca 750 cc sale $20.500.')).toBe(false);
  });
  it('«nada más», «ya está», «eso es todo» dan por completa la lista', () => {
    for (const t of ['Listo, nada más, gracias', 'Ya está, gracias', 'Perfecto, nada más. Gracias!', 'Eso es todo']) expect([t, confirmaLaLista(t)]).toEqual([t, true]);
    expect(confirmaLaLista('Gracias')).toBe(false);
  });
});

describe('revisión 21/10 · emojis y saludos', () => {
  it.each(['❓❓', '🤔', '😡😡', 'Hola 👋', 'Buenas tardes 🙂', 'Hola buen día 😊', 'Buen día ☀️', 'Hola qué tal 😊', '👋'])('«%s» no es un cierre', (t) => {
    expect(esCierreDeCharla(t)).toBe(false);
    expect(esCierreDeCharla(t, { conAfirmacion: true })).toBe(false);
  });
  it.each(['👍', '🙏', '👍🏻', '❤️', 'Gracias 👋', 'Nos vemos☺️'])('«%s» es un cierre', (t) => expect(esCierreDeCharla(t)).toBe(true));
});

describe('revisión 21/10 · la insistencia', () => {
  it.each(['¿Alguien me responde?', 'Me dicen algo?', 'No me contestaron', 'Y?', 'Hola? Alguien?', '¿Pudieron ver lo de la cera?', '¿Hay novedades?', '¿Novedades?'])(
    '«%s» insiste', (t) => expect(insiste(t)).toBe(true));
  it.each(['¿Qué novedades tienen de vinos?', '¿Qué novedades tienen en vinos naranjos?', 'Quiero 2 fernet'])('«%s» no insiste', (t) => expect(insiste(t)).toBe(false));
});

describe('revisión 21/10 · el prompt', () => {
  it('«este» sin foto se pregunta solo si por la charla no se sabe de qué producto habla', () => {
    expect(SYSTEM_PEDIDOS).toMatch(/por la charla no se sabe de qué producto habla/);
    expect(SYSTEM_PEDIDOS).toMatch(/¿Este viene con estuche\?/);
  });
  it('con una pregunta o la lista pendiente, «Sí, gracias» o «Nada más, gracias» contestan', () => {
    expect(SYSTEM_PEDIDOS).toMatch(/«Nada más, gracias»[^.]*te contestan/);
  });
});
