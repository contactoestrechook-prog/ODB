// EL «NADA MÁS» Y EL COMPROBANTE JUNTOS (5/10/2026, unión de main con el
// arreglo publicado). Main trajo el «nada más» que confirma (apagado con
// ODB_NADA_MAS_CONFIRMA), la pregunta del nombre para las picadas y la tarjeta
// del pedido confirmado; la rama publicada, el comprobante que confirma el
// pedido, el alias junto con el total y la limpieza de las promesas. Acá se
// prueba lo que aparece recién cuando están las dos cosas.
import { BotService } from './bot.service';
import { sinLoConsulto } from './prolijo';
import { confirmacionConDatosDePago, sinPedirConfirmo } from './pago-confirma';
import { retiraElMismoCliente } from './cierre';

// base falsa por operación (como la de pago-confirma.spec.ts)
type Consulta = { op: string; terminal: string; filtros: any[][] };
function dbPorOperacion(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: 'pedido-1', error: null })),
    from(tabla: string) {
      let op = 'select';
      const filtros: any[][] = [];
      const res = (terminal: string) => {
        const c = config[tabla];
        const q: Consulta = { op, terminal, filtros };
        const r = typeof c === 'function' ? c(q) : typeof c?.[op] === 'function' ? c[op](q) : c?.[op];
        return r ?? { data: null, error: null };
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res('then')).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res(String(k));
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op: String(k), fila }); return b; };
          return (...args: any[]) => { filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '137091732230271';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, alias_pago: 'outlet.de.bebidas', cbu_pago: '0720000000000000000000', titular_pago: 'Chinvenguencha SRL', banco_pago: 'Santander', bot_activo: true };
const COT = {
  id: '00d16356-6def-445c-8169-c7f07b9cdf08', total: 133500, tipo: 'pickup', direccion: null, notas: null, resumen: 'RESUMEN',
  creada_en: new Date(Date.now() - 20 * 60_000).toISOString(), confirmada_en: null, pedido_id: null, entrega_fecha: null, entrega_franja: null,
  items: [{ producto_id: 'p1', nombre: 'Combo Picada Box', cantidad: 3, subtotal: 133500 }],
};
const tu = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const resp = (content: any[], stop = 'tool_use') => ({ stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });

function armar(o: { cotizacion?: any; conversacion?: any[]; pagosAbiertos?: any[]; pedido?: any } = {}) {
  const cot = o.cotizacion === undefined ? COT : o.cotizacion;
  const db = dbPorOperacion({
    lineas_whatsapp: { select: { data: CFG } },
    alertas_internas: { select: { data: null } },
    bot_contactos: { select: { data: { nombre: 'Pablo' } } },
    // «confirmada hace poco» (gte confirmada_en) solo si la cotización está confirmada
    bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: cot ? [cot] : [] } : q.filtros.some((f) => f[0] === 'gte' && f[1] === 'confirmada_en') && !cot?.confirmada_en ? { data: null } : { data: cot }) },
    bot_pagos_en_confirmacion: { select: { data: o.pagosAbiertos ?? [] } },
    productos: { select: { data: [] } },
    pedidos: { select: { data: o.pedido ?? null } },
    bot_conversaciones: { select: { data: o.conversacion ? { mensajes: o.conversacion, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] } : null } },
  });
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-00D163566DEF', total: 133500, estado: 'recibido' })) };
  const s = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  (s as any).enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W1' }));
  (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
  const create = jest.fn(async () => resp([{ type: 'text', text: 'Dale.' }], 'end_turn'));
  (s as any).claude = { messages: { create } };
  return { s, db, create };
}

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });
afterEach(() => { delete process.env.ODB_NADA_MAS_CONFIRMA; });

describe('crearPedido con los tres modos', () => {
  it('«sí»: los 4 parámetros de siempre; «completo»: p_modo sin p_monto; «comprobante»: p_modo y p_monto', async () => {
    const reciente = { ...COT, creada_en: new Date().toISOString() };
    const si = armar({ cotizacion: reciente });
    await si.s.crearPedido({ telefono: TEL, confirmacion: 'sí', resumenPresentado: 'RESUMEN' });
    expect(si.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'sí' });

    const completo = armar({ cotizacion: reciente });
    await completo.s.crearPedido({ telefono: TEL, confirmacion: 'Solo eso', modo: 'completo', cotizacionId: COT.id });
    expect(completo.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'Solo eso', p_modo: 'completo' });

    const comprobante = armar();
    const r = await comprobante.s.crearPedido({ telefono: TEL, confirmacion: '[el cliente mandó este PDF]', modo: 'comprobante', monto: 133500, cotizacionId: COT.id });
    expect(comprobante.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: '[el cliente mandó este PDF]', p_modo: 'comprobante', p_monto: 133500 });
    // con el interruptor apagado (como está publicado), la respuesta de la rama tal cual
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
  });

  it('cada modo con su guarda: «completo» solo la recién guardada, «comprobante» solo la evaluada y con monto', async () => {
    // la del comprobante tiene 20 minutos: para «completo» ya no es la recién guardada
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'Solo eso', modo: 'completo', cotizacionId: COT.id })).rejects.toThrow(/resumen verificable/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: 'otra', monto: 133500 })).rejects.toThrow(/resumen verificable/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id })).rejects.toThrow(/confirmación inequívoca/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id, monto: 133500 })).resolves.toBeTruthy();
  });

  it('con el «nada más» prendido, el retiro con picadas confirmado por el comprobante también pregunta a nombre de quién', async () => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    const r = await armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id, monto: 133500 });
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.\n\n¿A nombre de quién lo retiran?');
  });
});

describe('el «nada más» con el alias pedido en el mismo turno', () => {
  // la respuesta real de crearPedido con el interruptor prendido: un retiro con picadas termina preguntando el nombre
  const CONFIRMACION = 'Pedido PICKUP-ABC123ABC123 confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.\n\n¿A nombre de quién lo retiran?';
  const conAliasYPregunta = (orden: string[]) => async () => {
    const { s } = armar({ cotizacion: null });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-1', resumen: '• Combo Picada Box — 3 × $44.500 = $133.500\nTotal: $133.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?', total: 133500, renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }] } as any);
    jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x', codigoRetiro: 'PICKUP-ABC123ABC123', total: 133500, estado: 'recibido', respuesta: CONFIRMACION } as any);
    const lista = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';
    const c: any = { ultimoBot: lista, ultimosBot: [lista], ultimosCliente: ['3 picadas', 'Solo eso, pasame el alias'], textoCliente: 'Solo eso, pasame el alias', fallos: new Map(), fija: {}, cierre: 'Solo eso', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    const herramientas: Record<string, any> = {
      d: tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias', monto: 0 }),
      p: tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }),
    };
    for (const h of orden) await (s as any).ejecutarHerramienta(herramientas[h], TEL, 'pedidos', c);
    const t: string = c.fija.texto;
    expect(t).toMatch(/^Pedido PICKUP-ABC123ABC123 confirmado\./);
    expect(t).toContain('Alias: outlet.de.bebidas');
    expect(t).not.toMatch(/¿Lo confirmo\?/);
    // los datos de pago van abajo de la confirmación y la pregunta del nombre queda última, una sola vez
    expect(t.indexOf('Se abona al retirar')).toBeLessThan(t.indexOf('Alias: outlet.de.bebidas'));
    expect(t.trim().endsWith('¿A nombre de quién lo retiran?')).toBe(true);
    expect(t.match(/¿A nombre de quién lo retiran\?/g)).toHaveLength(1);
    expect(t.match(/outlet\.de\.bebidas/g)).toHaveLength(1);
    expect(c.fallos.get('__pedido_creado__')).toBe(1);
  };

  it('la confirmación lleva los datos de pago abajo y la pregunta del nombre queda última (derivar_pago → preparar_pedido)', conAliasYPregunta(['d', 'p']));
  it('lo mismo con preparar_pedido → derivar_pago', conAliasYPregunta(['p', 'd']));

  it('sin la pregunta del nombre, los datos van abajo de todo, como antes', () => {
    const conf = 'Pedido PICKUP-ABC123ABC123 confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.';
    expect(confirmacionConDatosDePago(conf, 'Alias: a.\nCuando transfieras, mandame el comprobante por acá.')).toBe(`${conf}\n\nAlias: a.\nCuando transfieras, mandame el comprobante por acá.`);
    expect(confirmacionConDatosDePago(conf, '')).toBe(conf);
  });

  it('con un comprobante en el turno, el «nada más» no confirma: va «Recibido.»', async () => {
    const { s } = armar({ cotizacion: null });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-1', resumen: 'Total: $133.500\n¿Lo confirmo?', total: 133500, renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }] } as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const c: any = { ultimoBot: 'x', ultimosBot: ['x'], ultimosCliente: ['Solo eso'], textoCliente: 'Solo eso', fallos: new Map([['__comprobante__', 1]]), fija: { texto: 'Recibido.' }, cierre: 'Solo eso', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    expect(crear).not.toHaveBeenCalled();
    expect(c.fija.texto).toBe('Recibido.');
  });
});

describe('el «nada más» con el comprobante en el turno: el resultado no depende del orden', () => {
  // Lista anotada → «Nada más» → el bot dio el total y preguntó retiro o envío
  // (sin «¿Lo confirmo?»: la lista está cerrada) → el cliente manda el PDF de la
  // transferencia con «Retiro, ahí va la transferencia».
  const LISTA = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';
  const COTIZO = 'Son $133.500 en total. ¿Lo retirás en la sucursal o te lo enviamos?';
  const PDF_TXT = 'Retiro, ahí va la transferencia';
  const HIST = [
    { role: 'user', content: '3 picadas' }, { role: 'assistant', content: LISTA },
    { role: 'user', content: 'Nada más' }, { role: 'assistant', content: COTIZO },
  ];
  const PREP = { cotizacionId: COT.id, resumen: '• Combo Picada Box — 3 × $44.500 = $133.500\nTotal: $133.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?', total: 133500, renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
  const ctxPdf = (): any => ({
    ultimoBot: COTIZO, ultimosBot: [COTIZO, LISTA], ultimosCliente: ['3 picadas', 'Nada más', PDF_TXT], textoCliente: PDF_TXT,
    archivoUrl: 'https://publico/comprobante.pdf', archivo: { base64: 'JVBERi0xLjQK', mime: 'application/pdf' }, historial: HIST,
    fallos: new Map(), fija: {}, salidas: [], cierre: 'Nada más', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }],
  });
  const herramientas: Record<string, any> = {
    preparar_pedido: tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }),
    derivar_pago: tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 133500, motivo: 'Transfirió $133.500 por las picadas', de_quien: 'Pablo' }),
  };

  it.each([
    ['preparar_pedido → derivar_pago', ['preparar_pedido', 'derivar_pago']],
    ['derivar_pago → preparar_pedido', ['derivar_pago', 'preparar_pedido']],
  ])('%s: no se crea el pedido en modo completo, va «Recibido.» y administración recibe el comprobante una vez', async (_n, orden) => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    // la cotización recién guardada: el modo 'completo' la aceptaría
    const { s, db } = armar({ cotizacion: { ...COT, creada_en: new Date().toISOString() } });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const c = ctxPdf();
    for (const h of orden as string[]) await (s as any).ejecutarHerramienta(herramientas[h], TEL, 'pedidos', c);
    expect(crear).not.toHaveBeenCalledWith(expect.objectContaining({ modo: 'completo' }));
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
    expect(c.fallos.get('__pedido_creado__')).toBeUndefined();
    const avisos = ((s as any).enviarPorWhatsapp as jest.Mock).mock.calls.map((x: any[]) => x[0]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].text).toMatch(/Comprobante recibido/);
    expect(avisos[0].text).not.toMatch(/Se cobra al retirar/);
  });

  it('un archivo en el turno (aunque no haya derivar_pago) tampoco confirma por el «nada más»: queda el «¿Lo confirmo?»', async () => {
    const { s } = armar({ cotizacion: { ...COT, creada_en: new Date().toISOString() } });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const c = ctxPdf();
    await (s as any).ejecutarHerramienta(herramientas.preparar_pedido, TEL, 'pedidos', c);
    expect(crear).not.toHaveBeenCalled();
    expect(c.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });

  it('en un turno siguiente, con el comprobante abierto en administración, el «nada más» no confirma con «Se abona al retirar»', async () => {
    const abierto = { id: 'pago-1', monto: 133500, creado_en: new Date(Date.now() - 5 * 60_000).toISOString(), confirmado_en: null };
    const { s } = armar({ cotizacion: { ...COT, creada_en: new Date().toISOString() }, pagosAbiertos: [abierto] });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const c: any = { ...ctxPdf(), archivo: undefined, archivoUrl: undefined, ultimoBot: 'Recibido.', ultimosBot: ['Recibido.', COTIZO, LISTA], textoCliente: 'Lo paso a buscar a las 18' };
    await (s as any).ejecutarHerramienta(herramientas.preparar_pedido, TEL, 'pedidos', c);
    expect(crear).not.toHaveBeenCalled();
    expect(c.fija.texto).toMatch(/¿Lo confirmo\?$/);
    expect(c.fija.texto).not.toMatch(/Se abona/);
  });

  it('sin archivo ni comprobante abierto, el «nada más» sigue confirmando como en main', async () => {
    const { s } = armar({ cotizacion: { ...COT, creada_en: new Date().toISOString() } });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const c: any = { ...ctxPdf(), archivo: undefined, archivoUrl: undefined, textoCliente: 'Lo retiro' };
    await (s as any).ejecutarHerramienta(herramientas.preparar_pedido, TEL, 'pedidos', c);
    expect(c.fija.texto).toMatch(/^Pedido PICKUP-00D163566DEF confirmado\./);
  });
});

describe('«¿A nombre de quién lo retiran?» después de confirmar: el cliente que la contesta no queda mudo', () => {
  const CONF = 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.\n\n¿A nombre de quién lo retiran?';
  const PEDIDO = { id: 'pedido-1', notas: 'YA TRANSFIRIÓ $133.500 por WhatsApp', estado: 'recibido' };

  it.each(['Sí, a mi nombre', 'Sí, yo mismo', 'Si, a nombre mío', 'Dale, lo retiro yo', 'A mi nombre', 'Yo'])('«%s»: queda a nombre del contacto y se le contesta', async (dicho) => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    const { s, db, create } = armar({ conversacion: [{ role: 'user', content: '[el cliente mandó este PDF]' }, { role: 'assistant', content: CONF }], pedido: PEDIDO });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: dicho });
    expect(r.respuesta).toBe('Listo, queda a tu nombre.');
    expect(create).not.toHaveBeenCalled();
    const nota = db.escrituras.find((e: any) => e.tabla === 'pedidos' && e.op === 'update');
    expect(nota.fila.notas).toBe('YA TRANSFIRIÓ $133.500 por WhatsApp · Retira: Pablo (el mismo cliente)');
  });

  it('con un nombre, como en main', async () => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    const { s } = armar({ conversacion: [{ role: 'user', content: 'Sí' }, { role: 'assistant', content: CONF }], pedido: PEDIDO });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ok, a nombre de Juan Pérez' });
    expect(r.respuesta).toBe('Listo, queda a nombre de Juan Pérez.');
  });

  it('«Sí, lo retira mi hijo» no se calla: contesta el modelo, avisado de que el pedido ya está confirmado', async () => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    const { s, create, db } = armar({ conversacion: [{ role: 'user', content: 'Sí' }, { role: 'assistant', content: CONF }], pedido: PEDIDO });
    create.mockResolvedValue(resp([{ type: 'text', text: 'Perfecto, lo retira tu hijo con el código del pedido.' }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí, lo retira mi hijo' });
    expect(create).toHaveBeenCalled();
    expect(r.respuesta).toBeTruthy();
    expect(JSON.stringify((create.mock.calls[0] as any[])[0])).toContain('PICKUP-00D163566DEF YA QUEDÓ CONFIRMADO');
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });

  it('y preparar_pedido no arma otro pedido por ese «sí» (sí, si trae un cambio)', async () => {
    const { s } = armar();
    const preparar = jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-2', resumen: 'Total: $133.500\n¿Lo confirmo?', total: 133500, renglones: [] } as any);
    const ctx = (texto: string): any => ({ ultimoBot: CONF, ultimosBot: [CONF], ultimosCliente: ['[el cliente mandó este PDF]', texto], textoCliente: texto, fallos: new Map(), fija: {} });
    const r: any = await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', ctx('Dale'));
    expect(preparar).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/ya quedó confirmado/);
    // con un cambio no lo frena esta guarda (sigue el camino de siempre)
    const r2: any = await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', ctx('Sí, y sumame 2 hielos'));
    expect(String(r2.content)).not.toMatch(/ya quedó confirmado/);
  });

  it('retiraElMismoCliente es estricto', () => {
    for (const t of ['Sí, a mi nombre', 'Sí, yo mismo', 'Si, a nombre mío', 'Dale, lo retiro yo', 'yo misma', 'Lo retiro yo, gracias', 'A mi nombre nomás']) expect(retiraElMismoCliente(t)).toBe(true);
    for (const t of ['Sí', 'Juan', 'A nombre de Juan', 'Lo retiro mañana', 'Yo no, mi hijo', 'Sí, gracias', 'no']) expect(retiraElMismoCliente(t)).toBe(false);
  });
});

describe('el «sí» de más después de una confirmación', () => {
  it.each([
    ['la de main (dónde y cómo se paga)', 'Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.'],
    ['con la frase del envío adelante', 'El envío es sin cargo. Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.'],
    ['la del comprobante', 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.'],
  ])('%s: un «Sí, gracias» se calla (no arma otro pedido)', async (_n, conf) => {
    const { s, create, db } = armar({ conversacion: [{ role: 'user', content: 'Sí' }, { role: 'assistant', content: conf }] });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí, gracias' });
    expect(r.respuesta ?? null).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });
});

describe('la tarjeta del pedido confirmado por el comprobante', () => {
  // pedidos: los renglones a precio de lista; bot_cotizaciones: lo que dejó la base al confirmar («comprobante: $X»)
  const falso = (o: { items?: any[]; confirmacion?: string | null } = {}) => {
    const consulta = (data: any): any => { const c: any = { select: () => c, eq: () => c, limit: () => c, maybeSingle: async () => ({ data }) }; return c; };
    const pedido = { id: 'p1', destino_direccion: null, entrega_fecha: null, entrega_franja: null, pedidos_items: o.items ?? [{ cantidad: 3, precio_unitario: 44500, productos: { nombre: 'Combo Picada Box' } }] };
    const confirmacion = o.confirmacion === undefined ? 'comprobante: $133.500' : o.confirmacion;
    return {
      db: {
        from: (t: string) => consulta(t === 'bot_cotizaciones' ? (confirmacion === null ? null : { confirmacion }) : pedido),
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://publico/cartel.png' } }) }) },
      },
      log: { warn: () => undefined },
      subirPaginas: (BotService.prototype as any).subirPaginas,
    };
  };

  it('el que transfirió el total con descuento lo ve al pie (Pablo: $285.390 de $317.100), sin «pagado» ni «acreditado»', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const f = falso({ items: [{ cantidad: 3, precio_unitario: 105700, productos: { nombre: 'Judas Malbec 750 cc' } }], confirmacion: 'comprobante: $285.390' });
    const conf = 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.';
    const r = await (BotService.prototype as any).cartelDePedido.call(f, conf);
    // la tarjeta es la del pedido (los renglones a precio de lista y su total)…
    expect((espia.mock.calls[0][0] as any).total).toBe(317100);
    // …y el pie dice el total con descuento por transferencia
    expect(r.pie).toBe('Recibido. Tu pedido quedó confirmado. Total con descuento por transferencia: $285.390.');
    expect(r.pie).not.toMatch(/pagad|acreditad/i);
    // con la pregunta del nombre, la pregunta sigue última
    const r2 = await (BotService.prototype as any).cartelDePedido.call(f, `${conf}\n\n¿A nombre de quién lo retiran?`);
    expect(r2.pie).toBe('Recibido. Tu pedido quedó confirmado. Total con descuento por transferencia: $285.390.\n\n¿A nombre de quién lo retiran?');
    espia.mockRestore();
  });

  it('con «El envío es sin cargo.» adelante, el pie igual dice de qué confirmación se trata', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const f = falso({ items: [{ cantidad: 3, precio_unitario: 105700, productos: { nombre: 'Judas Malbec 750 cc' } }], confirmacion: 'comprobante: $285.390' });
    const r = await (BotService.prototype as any).cartelDePedido.call(f, 'El envío es sin cargo. Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(r.pie).toBe('El envío es sin cargo. Recibido. Tu pedido quedó confirmado. Total con descuento por transferencia: $285.390.');
    const r2 = await (BotService.prototype as any).cartelDePedido.call(falso(), 'El envío es sin cargo. Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.');
    expect(r2.pie).toBe('El envío es sin cargo. Pedido confirmado. Se abona al retirar, en efectivo o tarjeta.');
    espia.mockRestore();
  });

  it('si no se puede leer lo que transfirió, no hay tarjeta: va el texto, como en producción', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const r = await (BotService.prototype as any).cartelDePedido.call(falso({ confirmacion: null }), 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(r).toBeNull();
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('el pie no repite «Pedido confirmado.» ni el código: «Recibido. Tu pedido quedó confirmado.»', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const r = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(r.pie).toBe('Recibido. Tu pedido quedó confirmado.');
    expect((espia.mock.calls[0][0] as any).subtitulo).toBe('PICKUP-00D163566DEF');
    // con la pregunta del nombre (el «nada más» prendido), la pregunta queda al final, aparte
    const r2 = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.\n\n¿A nombre de quién lo retiran?');
    expect(r2.pie).toBe('Recibido. Tu pedido quedó confirmado.\n\n¿A nombre de quién lo retiran?');
    espia.mockRestore();
  });

  it('la confirmación por el «sí» sigue como en main', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const r = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.');
    expect(r.pie).toBe('Pedido confirmado. Se abona al retirar, en efectivo o tarjeta.');
    espia.mockRestore();
  });
});

describe('la limpieza final sin aplanar ni dejar huecos (quitarOraciones)', () => {
  it('sinLoConsulto saca el renglón entero y la lista queda en sus renglones', () => {
    expect(sinLoConsulto('Te anoto:\n• 2 × Judas Malbec 750 cc\nLo consulto con el local.\n\n¿Está completo el pedido o querés sumar algo?'))
      .toBe('Te anoto:\n• 2 × Judas Malbec 750 cc\n\n¿Está completo el pedido o querés sumar algo?');
    expect(sinLoConsulto('Del Catena no tengo ahora. Lo consulto. ¿Te sirve el Judas?')).toBe('Del Catena no tengo ahora. ¿Te sirve el Judas?');
  });

  it('sinPedirConfirmo tampoco deja un renglón vacío en el medio', () => {
    expect(sinPedirConfirmo('Total: $317.100\nDecime «confirmo» y lo dejo preparado.\nRetiro en la sucursal Saint Thomas.'))
      .toBe('Total: $317.100\nRetiro en la sucursal Saint Thomas.');
  });
});
