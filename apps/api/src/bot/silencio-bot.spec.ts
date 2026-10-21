// «EL BOT NO ESTÁ RESPONDIENDO» (21/10/2026), de punta a punta en charla(). Del 15 al 21/10 el
// 45 % de los turnos del modelo terminó sin nada para el cliente: la regla del 16/10 le pedía
// la respuesta vacía para callar, y todo vacío se tomaba como «no sabe» (consulta a
// administración con el texto crudo). Estas pruebas usan los mensajes reales de esa semana,
// con el modelo simulado: nunca se llama a la API.
import { BotService } from './bot.service';
import * as TEXTO from './textos-fijos';

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return col in fila && String(fila[col]) === String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return col in fila && String(fila[col]) >= String(val);
    return true;
  });
}
function baseFalsa(config: Record<string, Record<string, any>> = {}) {
  const escrituras: Escritura[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const ctx: Ctx = { filtros: [] };
      const res = () => {
        const out = config[tabla]?.[op] ?? { data: null, error: null };
        return op === 'select' && Array.isArray(out.data) ? { ...out, data: out.data.filter((f: any) => cumple(f, ctx.filtros)) } : out;
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (k === 'select') return (columnas?: string) => { if (op === 'select') ctx.columnas = columnas; return b; };
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) {
            return (fila: any) => { op = String(k); ctx.fila = fila; escrituras.push({ tabla, op, fila, filtros: ctx.filtros }); return b; };
          }
          return (...args: any[]) => { ctx.filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '11282929475750';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, bot_activo: true };
const conv = (mensajes: any[], extra: any = {}) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [], ...extra }, error: null });
const usage = { input_tokens: 10, output_tokens: 20 };
const pensar = (firma: string) => ({ type: 'thinking', thinking: '', signature: firma });
const herramienta = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const conHerramientas = (...content: any[]) => ({ stop_reason: 'tool_use', content, usage });
const final = (firma: string, t: string) => ({ stop_reason: 'end_turn', content: [pensar(firma), { type: 'text', text: t }], usage });
const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'insert');
const guardado = (db: any) => db.escrituras.filter((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert').at(-1)?.fila;
const SIN_CONSULTAS = { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } };

function servicio(db: any, ...principal: any[]) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W-1' }));
  s.respondeRegistrar = jest.fn(async () => null);
  s.estadoAtencion = jest.fn(async () => ({ abierto: true, cierra: '21:00' }));
  s.derivarAHumano = jest.fn(async () => ({ derivado: true }));
  s.buscarProductos = jest.fn(async () => ({ items: [{ sku: 'Y1', nombre: 'Yogur bebible Prot+ 1 L', precio: 3900, disponible: true }] }));
  const llamadas: any[] = [];
  const create = jest.fn(async (p: any) => {
    llamadas.push(JSON.parse(JSON.stringify(p)));
    const siguiente = principal.shift();
    return typeof siguiente === 'function' ? siguiente(p) : siguiente ?? vacia('fin');
  });
  s.claude = { messages: { create } };
  return { s, llamadas, create };
}
const armar = (hist: any[], extra: { conv?: any; contacto?: any; consultas?: any } = {}) => baseFalsa({
  bot_conversaciones: { select: conv(hist, extra.conv) },
  lineas_whatsapp: { select: { data: CFG, error: null } },
  bot_consultas_internas: extra.consultas ?? SIN_CONSULTAS,
  ...(extra.contacto ? { bot_contactos: { select: { data: extra.contacto, error: null } } } : {}),
});

// ============================================================
// 1. CLIENTES QUE NOMBRAN A ALGUIEN DE LA CASA: SE LES CONTESTA
// ============================================================
describe('la clienta del lote 112 (21/10): le habla a «Jaky» y pasa un pedido', () => {
  const HIST = [{ role: 'user', content: 'Hola Jaky, ¿me mandás el pedido de siempre?' }, { role: 'assistant', content: 'Tomo el reclamo del lote 112.' }];
  const LISTA = 'Te anoto:\n• 6 × Yogur bebible Prot+ 1 L\n\n¿Querés sumar algo y cómo lo pagás: efectivo, transferencia o tarjeta?';

  it('si el modelo pide no_contestar, el código lo rechaza y la respuesta sale; sin consulta a administración', async () => {
    const db = armar(HIST);
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), herramienta('n1', 'no_contestar', { motivo: 'para_la_casa', para_quien: 'Jaqueline', resumen: 'pedido de la sra Fabiana' })),
      final('b', LISTA));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Buen diaa Jaky! te paso el pedido de la sra Fabiana\n6 yogurt bebibles Prot+ (proteico)' });
    expect(r.respuesta).toBe(LISTA);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    // al modelo se le dijo que es una clienta y que la atiende
    expect(JSON.stringify(llamadas[1].messages.at(-1).content)).toMatch(/no_contestar no se acepta[^"]*Es un cliente y espera respuesta/);
  });

  it('si insiste con no_contestar, cuenta como falla: a la segunda se le ordena parar y a la tercera la vuelta va sin herramientas', async () => {
    const db = armar(HIST);
    const pide = (id: string) => conHerramientas(pensar(id), herramienta(id, 'no_contestar', { motivo: 'para_la_casa', para_quien: 'Jaqueline', resumen: 'pedido' }));
    const { s, llamadas } = servicio(db, pide('a'), pide('b'), pide('c'), final('d', LISTA));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Buen diaa Jaky! te paso el pedido de la sra Fabiana\n6 yogurt bebibles Prot+ (proteico)' });
    expect(r.respuesta).toBe(LISTA);
    expect(JSON.stringify(llamadas[2].messages.at(-1).content)).toMatch(/YA FALLÓ 2 VECES/);
    expect(llamadas[3].tool_choice).toEqual({ type: 'none' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('si explica que el mensaje es para Jackie, no sale nada de eso ni «¿me repite?»: se le pide la respuesta otra vez y sale', async () => {
    const db = armar(HIST);
    const { s, llamadas } = servicio(db, final('a', 'Este mensaje es para Jackie, no para mí. Le dejé una nota al equipo.'), final('b', LISTA));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '[audio] Hola, buen día, Jackie. ¿Te puedo pasar el pedido de la señora Fabiana? No lo puse en la lista. Seis yogures bebibles pro', deAudio: true });
    expect(r.respuesta).toBe(LISTA);
    expect(r.respuesta).not.toMatch(/me repite/);
    expect(JSON.stringify(llamadas[1].messages.at(-1).content)).toMatch(/aunque le hable por su nombre a alguien de la casa, lo atendés vos/);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('«si puede enviarme éstos pedidos de lote 112» con el modelo vacío: no se calla por reglas, se le pide la respuesta', async () => {
    const db = armar(HIST);
    const { s, create } = servicio(db, vacia('a'), final('b', '¿Me pasás qué productos querés en el pedido para el lote 112?'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'si puede enviarme éstos pedidos de lote 112' });
    expect(r.respuesta).toBe('¿Me pasás qué productos querés en el pedido para el lote 112?');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('el sistema le pasa al modelo la herramienta no_contestar y el prompt nuevo', async () => {
    const db = armar([]);
    const { s, llamadas } = servicio(db, final('a', 'Buen día. Soy Emilia, la asistente de O.D.B. ¿Qué materas buscás?'));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y materas Jacky?' });
    expect(llamadas[0].tools.map((t: any) => t.name)).toContain('no_contestar');
    expect(JSON.stringify(llamadas[0].system)).toContain('Quien nombra a alguien de la casa sigue siendo un cliente');
  });
});

// ============================================================
// 2. LO QUE ES PARA JAQUELINE: SILENCIO SIN CONSULTA, CON NOTA Y ESPERA
// ============================================================
describe('mensajes para Jaqueline (62 de los 108 vacíos): silencio, sin consulta a administración', () => {
  // la charla del proveedor de merchandising: el bot volvió solo y lo de Jaqueline quedó en el hilo
  const HIST_TEL = [
    { role: 'user', content: 'Hola, ¿cómo va? Te paso el presupuesto de las remeras' },
    { role: 'assistant', content: 'Holaaz', de: 'telefono' },
    { role: 'assistant', content: 'Necesito el logo', de: 'telefono' },
  ];

  it('«Acá está el logo» después de lo que escribió Jaqueline: no_contestar aceptada, una sola llamada, nota para ella y la charla queda esperando', async () => {
    const db = armar(HIST_TEL);
    const { s, llamadas, create } = servicio(db, conHerramientas(pensar('a'), herramienta('n1', 'no_contestar', { motivo: 'para_la_casa', para_quien: 'Jaqueline', resumen: 'mandó el logo que le pediste' })));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Acá está el logo' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'bot_notas_equipo').map((e: Escritura) => e.fila.nota)).toEqual(['[para Jaqueline] mandó el logo que le pediste']);
    expect(guardado(db).esperando_desde).toBeTruthy();
    // el estado le dijo al modelo quién escribió eso, y a la API no le llega la marca
    expect(JSON.stringify(llamadas[0].messages.at(-1).content)).toMatch(/lo escribió una persona desde el teléfono, no vos: «Holaaz», «Necesito el logo»/);
    expect(JSON.stringify(llamadas[0].messages)).not.toMatch(/"de":"telefono"/);
    // y en el hilo guardado la marca sigue
    expect(guardado(db).mensajes.filter((m: any) => m.de === 'telefono')).toHaveLength(2);
  });

  it('el mismo mensaje con el modelo vacío (sin herramienta): lo decide la regla, sin otra vuelta y sin consulta', async () => {
    const db = armar(HIST_TEL);
    const { s, create } = servicio(db, vacia('a'), final('b', 'NO DEBERÍA LLAMARSE'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Acá está el logo' });
    expect(r.respuesta).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'bot_notas_equipo')).toHaveLength(1);
  });

  it('proveedor registrado, «Hola buen día! no me pasaste nada! de esto digo» con registrar_proveedor y nota_interna y el modelo vacío: sin consulta falsa', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }], { contacto: { tipo: 'proveedor', nombre: 'Don Tomás' } });
    const { s, create } = servicio(db,
      conHerramientas(pensar('a'), herramienta('r1', 'registrar_proveedor', { nombre: 'Don Tomás', oferta: 'Reclama que no le pasaron el pedido', urgente: false }), herramienta('n1', 'nota_interna', { nota: 'Don Tomás dice que no le pasaron el pedido' })),
      vacia('b'));
    s.registrarProveedor = jest.fn(async () => ({ ok: true }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola buen dia! no me pasaste nada!\nde esto digo' });
    expect(r.respuesta).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    // la nota ya la dejó el modelo: no se suma otra
    expect(insertsDe(db, 'bot_notas_equipo')).toHaveLength(1);
  });

  it('«Jacqui, feliz día!!» con el modelo vacío: para la casa, sin consulta', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const { s, create } = servicio(db, vacia('a'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Jacqui, feliz dia!!' });
    expect(r.respuesta).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('Nestlé («Jaqui… ¿Necesitás mercadería?») y el modelo explica que no es para él: silencio, sin narrar nada ni consultar (caso de control)', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const { s } = servicio(db, final('a', 'Este mensaje es para Jaqui, no para mí: es un proveedor que le ofrece mercadería.'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Jaqui buen día\n¿Necesitás mercadería?\nHoy a la tarde cargo la lista de precios nueva' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('el proveedor de uniformes (20/10) con el audio de Jackie en el hilo y el modelo explicando: ni «¿me repite?» ni consulta', async () => {
    const db = armar([{ role: 'user', content: 'Jacqui, feliz dia!!' }, { role: 'assistant', content: '🎙️ Audio enviado' }]);
    const { s } = servicio(db, final('a', 'El mensaje va dirigido a Jackie, que le mandó un audio. No contesto nada.'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '[audio] Jackie, ¿cómo andás? Recién acabo de escuchar tu audio', deAudio: true });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });
});

// ============================================================
// 3. CIERRES Y MÁQUINAS: SILENCIO, SIN CONSULTA
// ============================================================
describe('cierres (15 de los 108): silencio sin consulta falsa', () => {
  const HIST = [{ role: 'user', content: '¿Cuánto sale el Fernet?' }, { role: 'assistant', content: 'El Fernet Branca 750 cc sale $20.500.' }];
  it.each(['Ok, graciasN', 'Excelente buenísimo!! Nos vemos☺️', 'Muy buena!!!\nJajaja', 'Buenos días, gracias', 'Ahh ok.'])('«%s»: ni el modelo ni consulta', async (t) => {
    const db = armar(HIST);
    const { s, create } = servicio(db, final('a', 'NO DEBERÍA LLAMARSE'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
    expect(r.respuesta).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('«Ok, graciasN» con una pregunta del bot pendiente va al modelo; si vuelve vacío, es un cierre: sin otra vuelta ni consulta', async () => {
    const db = armar([{ role: 'assistant', content: 'El Fernet Branca 750 cc sale $20.500. ¿Te lo anoto?' }]);
    const { s, create } = servicio(db, vacia('a'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ok, graciasN' });
    expect(r.respuesta).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('«Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!» (19/10) y el modelo narra: ni «¿me repite?» ni consulta', async () => {
    const db = armar([{ role: 'user', content: '¿Tenés Shin Ramyun?' }, { role: 'assistant', content: 'El Shin Ramyun no lo tengo ahora. Tengo el ramen Maruchan de pollo a $2.900. ¿Te sirve?' }]);
    const { s } = servicio(db, final('a', 'El cliente dijo que quería el coreano y cerró la charla. Le dejé una nota al equipo.'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ah Nono! Quería el Coreano de verdad. Bueno, gracias !!' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('del otro lado el bot de Botmaker (20/10): no_contestar automático, sin nota ni consulta', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const { s } = servicio(db, conHerramientas(pensar('a'), herramienta('n1', 'no_contestar', { motivo: 'automatico', para_quien: '', resumen: '' })));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola Emilia, entiendo que querés confirmar…\nEntiendo que me comentás que por este chat no se coordinan reuniones…' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'bot_notas_equipo')).toHaveLength(0);
    expect(guardado(db)).toMatchObject({ esperando_desde: null });
  });
});

// ============================================================
// 4. LA ÚLTIMA BARRERA: NUNCA «¿ME REPITE SU CONSULTA?»
// ============================================================
describe('la última barrera nunca deja «Disculpe, ¿me repite su consulta?»', () => {
  const HIST = [{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }];
  it.each([
    'Le dejé una nota al equipo para que Jaqueline lo vea.',
    'Este mensaje es para Jaqueline, no para mí. Le dejé una nota al equipo.',
    'El cliente pregunta algo que no entiendo. [nota: revisar]',
  ])('el modelo escribe «%s»: no sale nada de eso ni «¿me repite?»', async (t) => {
    const db = armar(HIST);
    const { s } = servicio(db, final('a', t), vacia('b'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hacen tortas por encargo?' });
    expect(r.respuesta ?? '').not.toMatch(/me repite|nota|cliente|Jaqueline/i);
  });

  it('si al sacar la narración queda lo que era para el cliente, sale eso', async () => {
    const db = armar(HIST);
    const { s } = servicio(db, final('a', 'El cliente pregunta por el horario del domingo. Los domingos abrimos de 9 a 14 h en la sucursal Saint Thomas.'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Abren el domingo?' });
    expect(r.respuesta).toBe('Los domingos abrimos de 9 a 14 h en la sucursal Saint Thomas.');
  });

  it('«Este mensaje es para confirmarte…» es para el cliente: sale entero (la regla del 16/10 lo cortaba)', async () => {
    const db = armar(HIST);
    const t = 'Este mensaje es para confirmarte que el envío sale hoy entre las 15 y las 18 h.';
    const { s } = servicio(db, final('a', t));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hoy sale el envío?' });
    expect(r.respuesta).toBe(t);
  });
});

// ============================================================
// 5. FRUIT, LA INSISTENCIA Y LA CONSULTA SILENCIOSA QUE SIGUE
// ============================================================
describe('el contacto de Fruit (17/10)', () => {
  it('«¿Tendrás el contacto de odb fruit?»: el contacto de la regla del 12/10 sale tal cual, sin consulta', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const fruit = 'Para frutas y verduras escribile a Fruit: wa.me/5491176369642 (11 7636-9642).';
    const { s } = servicio(db, final('a', fruit));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tendrás el contacto de odb fruit?' });
    expect(r.respuesta).toBe(fruit);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });
});

describe('«¿Puede por favor responderme?» con la consulta de la cera abierta (19/10)', () => {
  const HIST = [
    { role: 'assistant', content: '• Cera Suiza líquida incolora 900 ml — $7.400' },
    { role: 'user', content: '¿Esa dice para PISOS DE MADERA PLASTIFICADOS?' },
  ];
  const abierta = (minutos: number) => ({ select: { data: [{ id: 'q-cera', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'administracion', consulta: '¿La Cera Suiza sirve para pisos de madera plastificados?', tema: 'la cera para pisos plastificados', creado_en: new Date(Date.now() - minutos * 60_000).toISOString() }], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } });

  it('a las dos horas sin respuesta: pasa a una persona y al cliente le llega la frase fija (sin nombrar la consulta)', async () => {
    const db = armar(HIST, { consultas: abierta(126) });
    const { s } = servicio(db, vacia('a'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Puede por favor responderme?' });
    expect(r.respuesta).toBe(TEXTO.PASA_A_UNA_PERSONA);
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(String(s.derivarAHumano.mock.calls[0][2])).toMatch(/insiste.*la cera para pisos plastificados.*126 min/);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('a los 10 minutos sigue la consulta silenciosa: nada al cliente, ni otra consulta, ni derivación', async () => {
    const db = armar(HIST, { consultas: abierta(10) });
    const { s } = servicio(db, vacia('a'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Puede por favor responderme?' });
    expect(r.respuesta).toBeNull();
    expect(s.derivarAHumano).not.toHaveBeenCalled();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });
});

describe('la consulta silenciosa de siempre (regla del 6/10) no cambia', () => {
  it('«¿Te puedo pedir 2 picadas sin tacc para mañana? ¿Cuánto salen?» con consultar_interno: nada al cliente y una consulta', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const { s } = servicio(db,
      conHerramientas(pensar('a'), herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Hacemos picadas sin TACC para mañana? ¿Precio de 2?', direccion: '', tema: 'las picadas sin TACC' })),
      vacia('b'));
    s.consultarInterno = jest.fn(async () => ({ consultado: true, yaEstaba: false, tema: 'las picadas sin TACC' }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Te puedo pedir 2 picadas sin tacc para mañana? ¿Cuánto salen?' });
    expect(r.respuesta).toBeNull();
    expect(s.consultarInterno).toHaveBeenCalledTimes(1);
  });

  it('un cliente común y el modelo vacío dos veces: ahí sí, la consulta silenciosa (lo que no sabe)', async () => {
    const db = armar([{ role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }]);
    const { s, create } = servicio(db, vacia('a'), vacia('b'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿El Absolut es el de 750 o el de litro?' });
    expect(r.respuesta).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });
});
