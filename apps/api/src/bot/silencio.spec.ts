// CUÁNDO CALLA EL BOT (21/10/2026), con las frases reales de la semana del 15 al 21/10: lo que
// los clientes, los proveedores y los conocidos de Jaqueline le escribieron a la línea de pedidos.
import {
  aceptaNoContestar, esCierreDeCharla, esDespedida, escritoPorUnaPersona, esperaRespuesta, insiste, loUltimoDeLaCasaEsDeUnaPersona,
  nombraAAlguienDeLaCasa, paraElModelo, pideCompra, silencioPorReglas, telefonosDeLaCasa, terminaEnCierre, traeOtroTelefono,
} from './silencio';
import { esTextoInterno, explicaQueNoContesta } from './prolijo';
import { SYSTEM_PEDIDOS } from './agente-bot';

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

  it('una despedida no espera respuesta, aunque el bot haya preguntado algo', () => {
    expect(esDespedida('Ok, graciasN')).toBe(true);
    expect(esperaRespuesta('Ok, graciasN', { botDejoPregunta: true })).toBe(false);
    expect(esperaRespuesta('Excelente buenísimo!! Nos vemos☺️', { botDejoPregunta: false })).toBe(false);
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
    expect(aceptaNoContestar('cierre', 'Ok, gracias', { botDejoPregunta: true })).toEqual({ ok: true });
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
  it('ya dejó nota_interna o registrar_proveedor en el turno: para la casa', () => {
    expect(silencioPorReglas('Buen día Jaqueline. ¿Pudieron ver nuestra propuesta?', { ...sin, anotoEnElTurno: true })).toBe('para_la_casa');
  });
  it('nombra a alguien de la casa sin preguntar nada: para la casa; con una pregunta, solo si el modelo explicó que no era para él', () => {
    expect(silencioPorReglas('Hola Jaqueline, buen día, si hoy se los paso', sin)).toBe('para_la_casa');
    expect(silencioPorReglas('Jacqui, feliz día!!', sin)).toBe('para_la_casa');
    expect(silencioPorReglas('¿Y materas Jacky?', sin)).toBeNull();
    expect(silencioPorReglas('Jaqui buen día\n¿Necesitás mercadería?', { ...sin, decidioNoContestar: true })).toBe('para_la_casa');
  });
  it('un cierre o una despedida: cierre', () => {
    expect(silencioPorReglas('Ok, graciasN', { botDejoPregunta: true })).toBe('cierre');
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
    const hilo = [
      { role: 'assistant', content: 'Buen día. ¿Qué necesitás?' },
      { role: 'user', content: 'Hola, ¿hacen remeras con logo?' },
      { role: 'assistant', content: 'Holaaz', de: 'telefono' },
      { role: 'assistant', content: 'Necesito el logo', de: 'telefono' },
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
