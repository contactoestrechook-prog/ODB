import * as fs from 'fs';
import * as path from 'path';
import { BotService } from './bot.service';
import { conAviso, diceQueNoSabe, esSoloSaludo, mencionaConsulta, respuestaDelAreaParaCliente, sinMencionDeConsulta, sinPromesas } from './prolijo';
import { datosDePagoParaResumen, respuestaPedidoPorComprobante } from './pago-confirma';
import * as TEXTO from './textos-fijos';

// CONSULTA SILENCIOSA (Leandro, 6/10/2026). Textual, en este orden:
//   «No, que no diga te lo confirmo por acá, porque no lo confirma y no lo vuelve
//   a escribir. ¿Se entiende? Que dé una respuesta final.»
//   (al proponerle «Ese dato no lo tengo») «No, ese dato no lo tengo tampoco. Si
//   no sabe algo, lo consulta directamente con la administración, pero no se lo
//   avisa al cliente que lo está consultando. ¿Se entiende?»
// Lo que el bot no sabe va por adentro (fila, campanita, WhatsApp al área) y al
// cliente no se le dice nada de eso: en el mismo mensaje, solo lo que sí sabe; si
// preguntó solo lo que no se sabe, nada; y cuando el área contesta, esa es la
// respuesta final. Estas pruebas usan la charla real de Pablo (vinos a España, 5/10/2026).

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

// la misma base falsa de consulta-interna.spec.ts: filtra con eq/is/gte como la de verdad
function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return col in fila && String(fila[col]) === String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return col in fila && String(fila[col]) >= String(val);
    return true;
  });
}
function baseFalsa(config: Record<string, Record<string, any> | ((op: string, ctx: Ctx) => any)> = {}) {
  const escrituras: Escritura[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const ctx: Ctx = { filtros: [] };
      const res = () => {
        const c = config[tabla];
        const r = typeof c === 'function' ? c(op, ctx) : c?.[op];
        const out = r ?? { data: null, error: null };
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

const TEL = '137091732230271';
const ADMIN = '5491125213601';
const CFG = { derivar_pagos_a: ADMIN, avisar_proveedores_a: null, bot_activo: true };
const conv = (mensajes: any[]) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] }, error: null });
const h = (...p: [string, string][]) => p.map(([role, content]) => ({ role, content }));
const usage = { input_tokens: 1, output_tokens: 1 };
const herramienta = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const conHerramientas = (...content: any[]) => ({ stop_reason: 'tool_use', content, usage });
const texto = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'insert');
// todo lo que al cliente no se le dice nunca, en palabras sueltas (además de mencionaConsulta)
const NADA_DE_LA_CONSULTA = /confirm|consult|avis|pendiente|no lo tengo|no tengo (?:ese|esa|el|la) (?:dato|info)|vuelvo a vos|revis/i;

// los textos reales de la charla de Pablo (5/10/2026)
const M2 = 'Del PerSe Inseparable no tengo ahora, ya te confirmo por acá si entra. En esa misma línea de Gualtallary sí tengo:\n• Adrianna River Malbec 750 cc — $182.000, o $163.800 en efectivo o transferencia\n\nPor ahora quedan anotados:\n• 1 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
const M8 = 'Perfecto, quedate tranquilo con la elección: podés llevar una de cada una o tres iguales, el precio por botella es el mismo.';
const M12 = 'Te anoto:\n• 2 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Conjuro Bressia 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
const CAJA_1602 = 'Cliente viaja a España: ¿Judas Malbec 750, Catena Zapata Malbec Argentino 750 y Conjuro Bressia 750 vienen en caja/estuche individual? ¿Tenemos embalaje para llevar en avión?';
const CAJA_1617 = 'Cliente Pablo retira en un rato 4 botellas y las lleva a España en valija: ¿tenemos caja o embalaje de protección para darle?';
const AUDIO_14 = 'En un ratito los puedo pasar a buscar, y si tenés alguna caja para ponerlos... a nombre de Pablo, por las dudas.';
const abiertaCaja = (extra: any = {}) => ({ id: 'q-caja', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'administracion', consulta: CAJA_1602, tema: 'la caja para viajar', waha_msg_id: 'W-CAJA', respuesta_admin: null, enviado_a: ADMIN, nombre: 'Pablo', creado_en: new Date(Date.now() - 15 * 60_000).toISOString(), ...extra });

function servicio(db: any) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  const wsp = jest.fn(async () => ({ enviado: true, id: 'W-NUEVO' }));
  s.enviarPorWhatsapp = wsp;
  s.respondeRegistrar = jest.fn(async () => null);
  return { s, wsp };
}
// el verificador de preguntas (Haiku) contesta "todo atendido"; el modelo principal, en orden
const claudeCon = (...principal: any[]) => jest.fn(async (p: any) => p.model === 'claude-haiku-4-5'
  ? { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sin_responder":[]}' }], usage }
  : principal.length > 1 ? principal.shift() : principal[0]);

describe('la charla de Pablo con la consulta silenciosa (6/10/2026)', () => {
  it('(1) mensaje 2: lista + «¿Está completo…?» + consulta del PerSe → ninguna mención de la consulta, y «Del PerSe Inseparable no tengo ahora» queda', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Quiero 1 Judas Malbec, 1 Catena Zapata Malbec Argentino y 1 PerSe Inseparable para retirar'], ['assistant', 'Sumé el Bressia Conjuro 750 cc a la lista. Decime si cerramos así.'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-perse' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Entra el PerSe Inseparable 750 cc? El cliente lo quiere para retirar.', tema: 'el PerSe Inseparable', direccion: '' })),
      texto(M2),
    ) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Opcion 4' });
    // el hecho del catálogo queda, la lista y la pregunta final también
    expect(r.respuesta.startsWith('Del PerSe Inseparable no tengo ahora. En esa misma línea de Gualtallary sí tengo:')).toBe(true);
    expect(r.respuesta.trim().endsWith('• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?')).toBe(true);
    // y nada de la consulta, en ninguna forma
    expect(mencionaConsulta(r.respuesta)).toBe(false);
    expect(r.respuesta).not.toMatch(NADA_DE_LA_CONSULTA);
    // la consulta salió igual: fila con su tema y WhatsApp al número de administración
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ tema: 'el PerSe Inseparable', area: 'administracion', enviado_a: ADMIN });
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].to).toBe(ADMIN);
  });

  it('(2) «Son para llevar a España, vienen en cajas individuales?» como único contenido + consulta nueva → se registra la consulta y al cliente no le sale nada', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: CAJA_1602, tema: 'la caja para viajar', direccion: '' })),
      // el modelo igual escribe la promesa: se saca y no queda nada
      texto('Lo de las cajas individuales te lo confirmo por acá apenas lo sepa.'),
    );
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Son para llevar a España, vienen en cajas individuales?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    // registrada: fila, campanita y WhatsApp a administración
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ tema: 'la caja para viajar', enviado_a: ADMIN });
    expect(insertsDe(db, 'alertas_internas').some((e: Escritura) => e.fila.tipo === 'consulta')).toBe(true);
    expect(wsp).toHaveBeenCalledTimes(1);
    // y en el historial no queda ningún mensaje del bot (no salió nada)
    const guardado = db.escrituras.filter((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert').at(-1);
    expect(guardado.fila.mensajes.at(-1)).toEqual({ role: 'user', content: 'Son para llevar a España, vienen en cajas individuales?' });
    // sin reescritura: no había nada más que contestar
    expect(crear.mock.calls.filter((c: any[]) => c[0].model !== 'claude-haiku-4-5')).toHaveLength(2);
  });

  it('(3) el audio de Pablo (nombre, retiro, caja) con la caja ya consultada → contesta nombre y retiro, nada sobre la caja, y no consulta de nuevo', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Son para llevar a España, vienen en cajas individuales?'], ['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })),
      texto('Dale, Pablo, te los dejo a tu nombre para retirar en la sucursal Saint Thomas. Lo de la caja sigue pendiente: te aviso apenas lo sepa.'),
    );
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).toBe('Dale, Pablo, te los dejo a tu nombre para retirar en la sucursal Saint Thomas.');
    expect(r.respuesta).not.toMatch(/caja/i);
    expect(r.respuesta).not.toMatch(NADA_DE_LA_CONSULTA);
    // la misma consulta: sin otra fila; se le suma el dato y al área le llega solo lo nuevo (no otra consulta)
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].text).toMatch(/^Dato nuevo para una consulta que sigue sin respuesta/);
    // el modelo supo desde el arranque que la caja estaba en manos de administración y que no se menciona
    const primero = crear.mock.calls[0][0].messages.at(-1).content;
    const textoPrimero = typeof primero === 'string' ? primero : primero.map((b: any) => b.text ?? '').join(' ');
    expect(textoPrimero).toContain('ya en manos de administración (al cliente NO le menciones nada de eso');
  });

  it('(3b) si el modelo solo escribió lo de la caja, UNA reescritura con razonamiento (que solo puede leer y cotizar) contesta lo demás', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
    });
    const { s } = servicio(db);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    const crear = claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })),
      texto('Te confirmo por acá lo de la caja.'),
      texto(dale),
    );
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).toBe(dale);
    const principales = crear.mock.calls.map((c: any[]) => c[0]).filter((p: any) => p.model !== 'claude-haiku-4-5');
    const reescritura = principales[2];
    // 6/10/2026 (Opus 5.5): la reescritura ve la MISMA lista de herramientas que el
    // bucle (achicarla invalida el razonamiento guardado y la caché); nada que
    // consulte, derive o cree un pedido se EJECUTA (ver la prueba siguiente)
    expect(reescritura.tools).toEqual(principales[0].tools);
    expect(reescritura.tool_choice).toBeUndefined();
    expect(reescritura.thinking).toEqual({ type: 'adaptive' });
    expect(reescritura.output_config).toEqual(principales[0].output_config);
    const ultimo = reescritura.messages.at(-1).content;
    const nota = typeof ultimo === 'string' ? ultimo : ultimo.map((x: any) => x.text ?? '').join(' ');
    expect(nota).toMatch(/Al cliente NO le menciones nada de eso/);
    expect(nota).toMatch(/Si no hay nada más que contestar, no escribas nada/);
    expect(nota).toMatch(/solo podés buscar, cotizar o preparar el pedido/);
  });

  it('(3c) en la reescritura, lo que no puede usar no se ejecuta: consultar o derivar contestan «no disponible» y no cuentan como hechos', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s } = servicio(db);
    const derivar = jest.spyOn(s, 'derivarAHumano').mockResolvedValue({ derivado: true } as any);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    const crear = claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })),
      texto('Te confirmo por acá lo de la caja.'),
      // en la reescritura intenta consultar otra cosa y derivar: no se ejecuta ninguna
      conHerramientas({ type: 'thinking', thinking: '', signature: 's1' }, herramienta('c2', 'consultar_interno', { area: 'administracion', consulta: '¿Tienen bolsas térmicas?', tema: 'las bolsas térmicas', direccion: '' }), herramienta('d2', 'derivar_a_humano', { motivo: 'caja' })),
      texto(dale),
    );
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).toBe(dale);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(derivar).not.toHaveBeenCalled();
    const principales = crear.mock.calls.map((c: any[]) => c[0]).filter((p: any) => p.model !== 'claude-haiku-4-5');
    const resultados = principales[3].messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === 'tool_result' && ['c2', 'd2'].includes(b.tool_use_id));
    expect(resultados).toHaveLength(2);
    for (const x of resultados) { expect(x.is_error).toBe(true); expect(String(x.content)).toMatch(/No disponible en esta vuelta/); }
  });

  it('(4) administración contesta la consulta de la caja → al cliente le llega un mensaje que se entiende solo, sin «te confirmo» ni «como te dije»', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: { ...CFG, whatsapp_reparto: null, whatsapp_compras: null }, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
      bot_pagos_en_confirmacion: { select: { data: [], error: null } },
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12], ['user', 'Son para llevar a España, vienen en cajas individuales?'])) },
    });
    db.rpc.mockImplementation(async (fn: string) => (fn === 'tomar_entrega_consulta_bot' ? { data: [{ id: 'q-caja' }], error: null } : { data: null, error: null }));
    const { s, wsp } = servicio(db);
    const r: any = await s.respuestaDeAdministracion(ADMIN, { body: 'Sí, vienen en estuche individual de cartón.', replyTo: { id: 'true_5491125213601@c.us_W-CAJA' } });
    expect(r).toMatchObject({ contestado: true });
    const alCliente = (wsp.mock.calls as any[]).map((c) => c[0]).find((p) => p.to === `${TEL}@lid`);
    // al cliente no se le había dicho nada: la respuesta dice de qué se trata
    expect(alCliente.text).toBe('Sobre la caja para viajar: sí, vienen en estuche individual de cartón.');
    expect(alCliente.text).not.toMatch(/confirm|como te dije|te paso|pendiente/i);
    expect(mencionaConsulta(alCliente.text)).toBe(false);
    // queda como respuesta final: cerrada, con el texto que salió, y en el historial
    const updates = db.escrituras.filter((e: Escritura) => e.tabla === 'bot_consultas_internas' && e.op === 'update');
    expect(updates.some((u: Escritura) => u.fila.mensaje_cliente === alCliente.text)).toBe(true);
    expect(updates.some((u: Escritura) => u.fila.respondido_en)).toBe(true);
    const guardado = db.escrituras.filter((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert').at(-1);
    expect(guardado.fila.mensajes.at(-1)).toEqual({ role: 'assistant', content: alCliente.text });
  });

  it('(4b) si es lo primero que le escribe la casa (la consulta salió en silencio en su primer mensaje), va con el saludo de la hora', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
      bot_pagos_en_confirmacion: { select: { data: [], error: null } },
      bot_conversaciones: { select: conv(h(['user', 'Son para llevar a España, vienen en cajas individuales?'])) },
    });
    db.rpc.mockImplementation(async (fn: string) => (fn === 'tomar_entrega_consulta_bot' ? { data: [{ id: 'q-caja' }], error: null } : { data: null, error: null }));
    const { s, wsp } = servicio(db);
    await s.respuestaDeAdministracion(ADMIN, { body: 'Sí, vienen en estuche individual de cartón.', replyTo: { id: 'true_5491125213601@c.us_W-CAJA' } });
    const alCliente = (wsp.mock.calls as any[]).map((c) => c[0]).find((p) => p.to === `${TEL}@lid`);
    expect(alCliente.text).toMatch(/^(?:Buen día|Buenas tardes|Buenas noches)\. Sobre la caja para viajar: sí, vienen en estuche individual de cartón\.$/);
  });

  it('(4c) el WhatsApp al área le dice que al cliente no se le avisó: su respuesta tiene que entenderse sola', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'administracion', CAJA_1602, '', undefined, 'la caja para viajar');
    expect(r).toMatchObject({ consultado: true, yaEstaba: false, tema: 'la caja para viajar' });
    expect((wsp.mock.calls[0] as any[])[0]).toMatchObject({ to: ADMIN, text: expect.stringContaining('al cliente no se le avisó que se consultaba, así que tiene que entenderse sola') });
    // y al modelo: nada al cliente sobre la consulta; si no hay nada más, no escribe
    expect(r.aviso).toMatch(/Al cliente NO le menciones nada de eso/);
    expect(r.aviso).not.toMatch(/el sistema le avisa/);
  });
});

describe('(5) barrido: ningún texto fijo del sistema que llega al cliente promete ni menciona una consulta', () => {
  // cada texto fijo que el sistema le manda al cliente, como sale
  const TEXTOS_AL_CLIENTE: string[] = [
    ...(Object.values(TEXTO) as unknown[]).filter((v): v is string => typeof v === 'string'),
    TEXTO.pagoRecibido(' de $85.000'), TEXTO.pagoRecibido(),
    TEXTO.pagoNoFigura(' de $85.000'), TEXTO.pagoNoFigura(),
    respuestaPedidoPorComprobante({ codigo: 'PICKUP-00D163566DEF', tipo: 'pickup' }),
    respuestaPedidoPorComprobante({ codigo: 'DOM-ABC123', tipo: 'domicilio', direccion: 'Rivadavia 234, Canning' }),
    datosDePagoParaResumen({ datosDePago: 'Alias: outlet.de.bebidas · CBU: 0720000000000000000000' }),
    'Sí, ya lo tengo.',
    'Alias: outlet.de.bebidas · CBU: 0720000000000000000000 · Titular: Chinvenguencha SRL (Santander). Cuando transfieras, mandame el comprobante por acá.',
    'Pedido PICKUP-1 confirmado. Total: $41.000.\nSe abona al retirar, en efectivo o tarjeta.',
    'Disculpe, ¿me repite su consulta?',
  ];
  it.each(TEXTOS_AL_CLIENTE.map((t) => [t]))('«%s»', (t) => {
    expect(mencionaConsulta(t)).toBe(false);
    expect(sinPromesas(t)).toBe(t.trim());
    expect(sinMencionDeConsulta(t)).toBe(t);
    // los avisos viejos, en ninguna forma
    expect(t).not.toMatch(/confirm(?:o|amos) por ac[aá]|doy aviso|aviso al sector|lo revisa alguien|te contesta por ac[aá]|te responde por|en un rato|todav[ií]a no lo tengo|sigue pendiente|ese dato no lo tengo/i);
  });

  it('en el código (src/bot y src/avisos), una frase así solo aparece en instrucciones al modelo o en textos para el equipo', () => {
    const raiz = path.join(__dirname, '..');
    // lo que va al equipo (notas, campanita, logs), no al cliente
    const INTERNOS = ['no salió el aviso a administración', 'pero el aviso a administración falló'];
    const sueltas: string[] = [];
    for (const dir of ['bot', 'avisos']) {
      // agente-bot.ts es el prompt entero: todo ahí es para el modelo
      for (const f of fs.readdirSync(path.join(raiz, dir)).filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts') && x !== 'agente-bot.ts')) {
        const src = fs.readFileSync(path.join(raiz, dir, f), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
        for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)) {
          const lit = String(m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, 'X');
          if (lit.length < 8 || !(mencionaConsulta(lit) || sinPromesas(lit) !== lit.trim())) continue;
          // las instrucciones al modelo y los textos al equipo hablan DEL cliente; los textos al cliente, nunca
          if (/cliente|nota interna/i.test(lit) || INTERNOS.some((x) => lit.includes(x))) continue;
          sueltas.push(`${dir}/${f}: ${lit.slice(0, 120)}`);
        }
      }
    }
    expect(sueltas).toEqual([]);
  });
});

describe('(6) el pedido «confirmado» sin código sigue saliendo a administración (PEDIDO CONFIRMADO SIN CARGAR)', () => {
  const avisosDe = (db: any) => insertsDe(db, 'avisos_pedidos').filter((e: Escritura) => e.fila?.tipo === 'pedido_sin_cargar');

  // (10/10/2026, revisión de la tanda 1: el «dale confirmalo» cuenta como sí solo si contesta un
  // «¿Lo confirmo?»; antes estas pruebas pasaban con la charla vacía)
  const RESUMEN = '• Fernet Branca 750 cc — 1 × $20.500 c/u = $20.500\nTotal: $20.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
  const CON_RESUMEN = h(['user', '1 fernet para retirar, es todo'], ['assistant', RESUMEN]);

  it('el reemplazo fijo de «confirmado» sin código: texto honesto sin anunciar el aviso, y el aviso sale igual (prometioAvisoDePedido)', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CON_RESUMEN) } });
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    s.claude = { messages: { create: claudeCon(texto('Le confirmo el pedido para retiro en Sant Thomas: 1 Fernet. Lo esperamos.')) } };
    s.regenerar = jest.fn().mockResolvedValue(null);
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566677', mensaje: 'dale confirmalo' });
    expect(r.respuesta).toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(r.respuesta).not.toMatch(/aviso al sector|doy aviso|te confirm/i);
    expect(avisosDe(db)).toHaveLength(1);
    expect(avisosDe(db)[0].fila.detalle).toMatchObject({ telefono: '5491155566677' });
  });

  it('la reescritura del modelo con la frase de ahora también sale a administración', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CON_RESUMEN) } });
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    s.claude = { messages: { create: claudeCon(texto('Listo, pedido confirmado: 1 Fernet para retirar.')) } };
    s.regenerar = jest.fn().mockResolvedValue(TEXTO.PEDIDO_SIN_CARGAR);
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566678', mensaje: 'dale confirmalo' });
    expect(r.respuesta).toMatch(/Tuve un problema para cargar el pedido; ya quedó con todos los datos para el local\./);
    expect(avisosDe(db)).toHaveLength(1);
  });

  it('la frase VIEJA del historial («doy aviso al sector… para que lo dejen confirmado») tras un crear_pedido fallido: no sale al cliente, va la de ahora, y el aviso sale igual', async () => {
    const resumen = '• Fernet Branca 750 cc — 1 × $20.500 c/u = $20.500\nTotal: $20.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', '1 fernet para retirar, es todo'], ['assistant', resumen])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    s.claude = { messages: { create: claudeCon(
      conHerramientas(herramienta('p1', 'crear_pedido', {})),
      texto('Tomo su pedido y doy aviso al sector correspondiente para que lo dejen confirmado.'),
    ) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566679', mensaje: 'sí' });
    expect(r.respuesta).toBe(TEXTO.PEDIDO_SIN_CARGAR);
    // es lo del pedido: no se abre una consulta por la frase
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(avisosDe(db)).toHaveLength(1);
  });

  it('crear_pedido atascado (dos fallas): el aviso sale en el acto y al modelo se le da la frase sin anuncio', async () => {
    const db = baseFalsa({});
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    const fallos = new Map<string, number>([['crear_pedido', 1]]);
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 't', name: 'crear_pedido', input: {} }, '5491155566680', 'pedidos', { textoCliente: 'sí', ultimoBot: '¿Lo confirmo?', fallos, fija: {} });
    expect(r.is_error).toBe(true);
    expect(String(r.content)).toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(String(r.content)).not.toMatch(/doy aviso al sector correspondiente para que lo dejen confirmado/);
    expect(avisosDe(db)).toHaveLength(1);
  });

  // ---- REVISIÓN DE LA TANDA 1 (10/10/2026): lo que no es un pedido confirmado no avisa ni miente ----
  const charlaCon = async (historial: any[], mensaje: string, ...respuestas: any[]) => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(historial) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-f2' }, error: null } },
    });
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    s.claude = { messages: { create: claudeCon(...respuestas) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566691', mensaje });
    return { r, db, s };
  };
  const consultasDe = (db: any) => insertsDe(db, 'bot_consultas_internas');
  const COMPLETO = h(['user', '2 fernet'], ['assistant', 'Te anoto:\n• 2 × Fernet Branca 750 cc\n\n¿Está completo el pedido o querés sumar algo?']);
  const CONFIRMADO = h(['user', 'sí'], ['assistant', 'Pedido RET-AB12CD confirmado. Total: $41.000. Te esperamos en la sucursal Saint Thomas.']);

  it.each([
    ['Esperá, mañana te confirmo', 'Dale, sin problema. Cuando me digas, confirmo el pedido.', 'Dale, sin problema. Cuando me digas, confirmo el pedido.'],
    ['¿Me sumás una bolsa de hielo?', 'Sumo 1 × Hielo 2 kg. Con eso confirmo el pedido, ¿te parece?', 'Sumo 1 × Hielo 2 kg.'],
    ['Ahora hago la transferencia', 'Dale. Tu pedido queda confirmado.', 'Dale.'],
  ])('tras el «¿Lo confirmo?», «%s» no es un sí: el «¿Lo confirmo?» de antes no alcanza para avisar ni para «Tuve un problema»', async (mensaje, delModelo, sale) => {
    const { r, db } = await charlaCon(CON_RESUMEN, mensaje, texto(delModelo));
    expect(r.respuesta).toBe(sale);
    expect(avisosDe(db)).toHaveLength(0);
  });

  it('un «Sí, está completo» (a «¿Está completo…?») no es confirmar: se saca «tu pedido queda registrado», queda la pregunta y no hay aviso', async () => {
    const { r, db } = await charlaCon(COMPLETO, 'Sí, está completo', texto('Perfecto, tu pedido queda registrado. ¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?'));
    expect(r.respuesta).toBe('¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?');
    expect(avisosDe(db)).toHaveLength(0);
  });

  it.each([
    [COMPLETO, 'Sí, está completo', 'Perfecto, tu pedido queda confirmado.'],
    [h(['user', '2 fernet'], ['assistant', 'Te anoto 2 × Fernet Branca 750 cc. ¿Lo querés para retirar o con envío?']), 'Dale, lo retiro yo', 'Listo, queda registrado el pedido para retirar.'],
    [CONFIRMADO, '¿Ya quedó confirmado el pedido?', 'Sí, tu pedido quedó confirmado.'],
    [CONFIRMADO, 'Paso a las 18 a buscarlo', 'Sí, tu pedido está confirmado, te esperamos a las 18.'],
  ])('si la oración sacada era todo el mensaje («%s»), no queda colgado: se consulta en silencio, sin aviso de pedido', async (historial, mensaje, delModelo) => {
    const { r, db } = await charlaCon(historial as any[], mensaje as string, texto(delModelo as string));
    expect(r.respuesta).toBeNull();
    expect(avisosDe(db)).toHaveLength(0);
    expect(consultasDe(db)).toHaveLength(1);
    expect(consultasDe(db)[0].fila).toMatchObject({ area: 'administracion', consulta: mensaje });
    // la charla sigue esperando a administración
    const guardado = db.escrituras.find((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert');
    expect(guardado.fila).not.toHaveProperty('esperando_desde');
  });

  it('«No, esperá, sumale una coca» al «¿Lo confirmo?» no es un intento: sin aviso', async () => {
    const { r, db } = await charlaCon(CON_RESUMEN, 'No, esperá, sumale una coca', texto('Sumo 1 × Coca Cola 1,75 L. Tu pedido queda confirmado.'));
    expect(r.respuesta).toBe('Sumo 1 × Coca Cola 1,75 L.');
    expect(avisosDe(db)).toHaveLength(0);
  });

  it('la frase en un condicional o en una pregunta abierta no es mentira: el texto sale tal cual y no hay aviso', async () => {
    const a = await charlaCon(CON_RESUMEN, '¿Puedo pagar con link?', texto('Sí: con el pedido confirmado te mando el link de pago por acá.'));
    expect(a.r.respuesta).toBe('Sí: con el pedido confirmado te mando el link de pago por acá.');
    expect(avisosDe(a.db)).toHaveLength(0);
    const b = await charlaCon(CON_RESUMEN, 'sumale un hielo', texto('Sumo 1 × Hielo 2 kg.\n\n• 1 × Fernet Branca 750 cc\n• 1 × Hielo 2 kg\n\n¿Te confirmo el pedido así?'));
    expect(b.r.respuesta).toMatch(/¿Te confirmo el pedido así\?$/);
    expect(b.r.respuesta).not.toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(avisosDe(b.db)).toHaveLength(0);
  });

  it('«¿Viene en caja?» tras el «¿Lo confirmo?» y el modelo agrega «Tu pedido quedó confirmado.»: se saca esa oración, sin aviso', async () => {
    const { r, db } = await charlaCon(CON_RESUMEN, '¿Viene en caja?', texto('Sí, viene en caja. Tu pedido quedó confirmado.'));
    expect(r.respuesta).toBe('Sí, viene en caja.');
    expect(avisosDe(db)).toHaveLength(0);
  });

  it.each([
    ['Sí, confirmalo. ¿Viene en caja?', 'Sí, viene en caja. Tu pedido quedó confirmado.'],
    ['Sí, confirmalo', 'Listo, tu pedido quedó confirmado, ¿necesitás algo más?'],
  ])('el sí al «¿Lo confirmo?» («%s») sin código: sale «Tuve un problema…» y el aviso PEDIDO CONFIRMADO SIN CARGAR', async (mensaje, delModelo) => {
    const { r, db } = await charlaCon(CON_RESUMEN, mensaje, texto(delModelo));
    expect(r.respuesta).toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(r.respuesta).not.toMatch(/quedó confirmado/);
    expect(avisosDe(db)).toHaveLength(1);
  });

  it('crear_pedido fallido y una respuesta sin «confirmado» con renglones de más: no se toca ni avisa', async () => {
    const { r, db } = await charlaCon(CON_RESUMEN, 'sí, mandámelo', conHerramientas(herramienta('p1', 'crear_pedido', {})), texto('Me falta la dirección.\n\n\n¿A qué dirección te lo mando?'));
    expect(r.respuesta).not.toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(r.respuesta).toMatch(/^Me falta la dirección\.\s+¿A qué dirección te lo mando\?$/);
    expect(avisosDe(db)).toHaveLength(0);
  });

  it('«quedó registrado tu pedido» (el «quedó» antes del pedido) también se toma: no sale y no hay aviso sin un sí', async () => {
    const { r, db } = await charlaCon(CON_RESUMEN, 'Pasalo a nombre de Juan, lo retiro mañana', texto('Perfecto, quedó registrado tu pedido a nombre de Juan para retirar mañana.'));
    expect(r.respuesta ?? '').not.toMatch(/registrado/);
    expect(avisosDe(db)).toHaveLength(0);
    expect(consultasDe(db)).toHaveLength(1);
  });

  it.each([
    ['Listo, quedó cancelado.', null],
    ['Listo, Juan, tu pedido quedó cancelado. ¿Necesitás algo más?', '¿Necesitás algo más?'],
  ])('«Cancelalo» y el modelo dice «%s» sin cancelar_pedido: se saca y se consulta en silencio (una persona lo cancela)', async (delModelo, sale) => {
    const { r, db } = await charlaCon(CONFIRMADO, 'Cancelalo por favor, ya no lo necesito', texto(delModelo as string));
    expect(r.respuesta).toBe(sale);
    expect(consultasDe(db)).toHaveLength(1);
    expect(consultasDe(db)[0].fila).toMatchObject({ area: 'administracion', consulta: 'Cancelalo por favor, ya no lo necesito' });
    expect(avisosDe(db)).toHaveLength(0);
  });

  it('con cancelar_pedido en el turno, «quedó cancelado» es cierto: sale tal cual y no se consulta', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(CONFIRMADO) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-f2' }, error: null } },
    });
    const { s } = servicio(db);
    s.cancelarPedidoDelCliente = jest.fn(async () => ({ ok: true, codigo: 'RET-AB12CD', estado: 'cancelado' }));
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('k1', 'cancelar_pedido', { codigo: 'RET-AB12CD' })), texto('Listo, tu pedido RET-AB12CD quedó cancelado.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566692', mensaje: 'Cancelalo por favor' });
    expect(r.respuesta).toBe('Listo, tu pedido RET-AB12CD quedó cancelado.');
    expect(consultasDe(db)).toHaveLength(0);
  });
});

describe('otros caminos de la consulta silenciosa', () => {
  it('quiere transferir y no hay alias cargado: se le piden los datos a administración en silencio (antes «Le paso los datos por acá en un rato.»)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-alias' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'quiere_pagar', monto: 0, motivo: 'Pide el alias para transferir' })), texto('Le paso los datos por acá en un rato.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿A dónde te transfiero?' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ area: 'administracion', tema: 'los datos para transferir', enviado_a: ADMIN });
    expect(wsp).toHaveBeenCalledTimes(1);
    // por el circuito de las consultas: lo que conteste administración le llega al cliente
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
  });

  it('dos cosas distintas que no sabe en el mismo mensaje: se consultan las dos (antes la segunda se perdía)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(conHerramientas(
      herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Los vinos vienen en estuche individual?', tema: 'la caja para viajar', direccion: '' }),
      herramienta('c2', 'consultar_interno', { area: 'compras', consulta: '¿Entra el PerSe Inseparable?', tema: 'el PerSe Inseparable', direccion: '' }),
      herramienta('c3', 'consultar_interno', { area: 'administracion', consulta: '¿Vienen con caja?', tema: 'la caja para viajar', direccion: '' }),
    ), texto('')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Vienen en caja? ¿Y entra el PerSe?' });
    expect(insertsDe(db, 'bot_consultas_internas').map((e: Escritura) => e.fila.tema)).toEqual(['la caja para viajar', 'el PerSe Inseparable']);
    expect(r.respuesta).toBeNull();
  });

  it('una consulta de pago a administración sin nada más: «Recibido.»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      alertas_internas: { select: { data: null, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'reclamo_pago', monto: 0, motivo: 'Dice que le cobraron dos veces', de_quien: 'Pablo' })), texto('Lo reviso con administración y te confirmo por acá.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me cobraron dos veces' });
    // «Recibido.» (23/9), sin nada de lo que hace administración (sin la disculpa antepuesta en código desde el 10/10/2026)
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
  });
});

// ============================================================
// REVISIÓN DEL 6/10/2026 (consulta silenciosa). Lo que encontraron los revisores
// sobre el commit de la mañana, probado con la charla entera.
// ============================================================
const principales = (crear: jest.Mock) => crear.mock.calls.map((c: any[]) => c[0]).filter((p: any) => p.model !== 'claude-haiku-4-5');
const NUNCA_AL_CLIENTE = /no pude procesar|qué sigue|administración (?:ya )?(?:lo|la) tiene|en manos de|apenas lo verifiquen/i;
const HOLA = h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?']);

describe('revisión (6/10/2026): lo que se le pidió callar no se fuerza', () => {
  it('(K) consulta de pago y el modelo obedece y no escribe → «Recibido.», sin el cierre que pedía «qué sigue» ni el «no pude procesar»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      alertas_internas: { select: { data: null, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    const crear = claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'consulta', monto: 0, motivo: 'Pregunta si llegó la transferencia de ayer', de_quien: 'Pablo' })), { stop_reason: 'end_turn', content: [], usage });
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Les llegó la transferencia de ayer?' });
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
    // ninguna vuelta más pidiéndole texto al modelo
    expect(principales(crear)).toHaveLength(2);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('(J) a los 5 minutos de una alerta de pago, «pasame el alias» → el alias cargado (quiere_pagar ya no lo corta el aviso reciente)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: { ...CFG, alias_pago: 'outlet.de.bebidas', titular_pago: 'Chinvenguencha SRL' }, error: null } },
      alertas_internas: { select: { data: [{ id: 'a-pago', tipo: 'pago' }], error: null } },
    });
    const { s } = servicio(db);
    const crear = claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'quiere_pagar', monto: 0, motivo: 'Pide el alias para transferir lo que falta' })), texto(''));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Pasame el alias así te transfiero lo que falta' });
    expect(r.respuesta).toContain('Alias: outlet.de.bebidas');
    expect(r.respuesta).not.toMatch(NUNCA_AL_CLIENTE);
  });

  it('(A) con la caja consultada, «¿Y lo de las cajas?» y el modelo no escribe → nada al cliente, ni otra consulta, ni el «no pude procesar»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = claudeCon(texto(''));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo de las cajas?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    expect(principales(crear)).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });

  it('(A3) «¿Saben algo?» sin herramientas ni texto, con la caja abierta → es esa consulta: nada al cliente; y si pide una persona, se deriva igual', async () => {
    const armar = () => {
      const db = baseFalsa({
        bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3'], ['assistant', M12])) },
        lineas_whatsapp: { select: { data: CFG, error: null } },
        bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
      });
      const { s } = servicio(db);
      s.derivarAHumano = jest.fn(async () => ({ derivado: true }));
      s.claude = { messages: { create: claudeCon(texto('')) } };
      return { db, s };
    };
    const a = armar();
    const r1: any = await a.s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Saben algo?' });
    expect(r1.respuesta).toBeNull();
    expect(insertsDe(a.db, 'bot_consultas_internas')).toHaveLength(0);
    const b = armar();
    const r2: any = await b.s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo de la caja? Quiero hablar con alguien' });
    expect(b.s.derivarAHumano).toHaveBeenCalled();
    expect(r2.respuesta).toBe(TEXTO.DERIVACION_PEDIDA);
  });

  it('(A2) y si el modelo igual escribe «Lo de las cajas todavía está en manos de administración.», no sale', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Lo de las cajas todavía está en manos de administración.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo de las cajas?' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });
});

describe('revisión (6/10/2026): las formas que se escapaban', () => {
  const SACAR = [
    'La añada del Judas todavía no la tengo, mañana te digo.', 'Eso te lo confirma administración.', 'No sé si vienen en caja.',
    'No te puedo confirmar si vienen en estuche.', 'Todavía no lo tengo.', 'Te aviso.', 'Después te aviso.', 'Cuando me confirmen te aviso.', 'Le aviso.',
    'Te confirmo mañana lo de la caja.', 'Le confirmo mañana.', 'Te confirmo a la tarde.', 'Te lo confirmo en el día.', 'Te lo van a confirmar en el local.',
    'Te lo confirman en el local.', 'Mañana te digo.', 'Te comento en un rato.', 'Te contesto en un rato.', 'Cuando tenga la respuesta te escribo.',
    'Le pregunto a administración y te digo.', 'Dejame averiguarlo.', 'Ya lo pasé a administración.', 'Le paso tu consulta al equipo.', 'Lo están revisando.',
    'No sabría decirte.', 'Desconozco ese dato.', 'No dispongo de esa información.', 'No tengo datos de la caja.', 'Eso no lo tengo.', 'En breve te respondo.',
    'Ya quedó anotado para el equipo.', 'Ya está anotada tu consulta.', 'Lo vemos con el local.', 'Te confirmo lo de la caja.',
    'Lo de las cajas todavía está en manos de administración.', 'Administración ya lo tiene; apenas lo verifiquen te escriben.',
  ];
  it.each(SACAR.map((t) => [t]))('«%s» se reconoce (dispara la consulta silenciosa) y no sale', (t) => {
    expect(mencionaConsulta(t)).toBe(true);
    expect(sinMencionDeConsulta(t)).toBe('');
  });
  const QUEDAN = [
    'Sí, te lo confirmo: $317.100.', 'De Raquis Monasterio no tengo ahora.', 'Te paso por acá los precios:', 'Ya te confirmé el pedido RET-ABC123.',
    'Te aviso que los domingos no hay reparto.', 'Estoy viendo que pediste 2 Fernet.', 'Por ahora quedan anotados:', 'Te lo mandamos mañana entre las 14 y las 18.',
    'Hoy te paso los precios:', 'Hoy te cuento que tenemos promo.', 'No sé si preferís retirar o que te lo enviemos.', 'La edad la verificamos al retirar.',
    'Te confirmo lo de la caja: sí, vienen en estuche.', 'Sí, te confirmo que abrimos el domingo.', 'Cuando confirmes, te lo dejo listo.',
  ];
  it.each(QUEDAN.map((t) => [t]))('«%s» es un dato o una pregunta: se queda', (t) => {
    expect(mencionaConsulta(t)).toBe(false);
  });
  it('«Abrimos hasta las 21. Aún no tengo novedades de la caja.» → queda el horario', () => {
    expect(sinMencionDeConsulta('Abrimos hasta las 21. Aún no tengo novedades de la caja.')).toBe('Abrimos hasta las 21.');
  });
  it('en un turno con consulta, «Te aviso que los domingos no hay reparto.» es un dato y se queda; «Lo vemos con el local y te confirmamos.» se va entero', () => {
    expect(sinPromesas('Te aviso que los domingos no hay reparto.')).toBe('Te aviso que los domingos no hay reparto.');
    expect(sinPromesas('Lo vemos con el local y te confirmamos.')).toBe('');
  });
  it('diceQueNoSabe: lo que no sabe, no las promesas', () => {
    expect(diceQueNoSabe('No tengo ese dato.')).toBe(true);
    expect(diceQueNoSabe('No sé si vienen en caja.')).toBe(true);
    expect(diceQueNoSabe('Lo reviso con administración y te confirmo por acá.')).toBe(false);
  });

  it('sin consulta en el turno, «Abrimos hasta las 21. Aún no tengo novedades de la caja.» → el horario al cliente y la caja a administración', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Abrimos hasta las 21. Aún no tengo novedades de la caja.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hasta qué hora abren? ¿Vienen en caja?' });
    expect(r.respuesta).toBe('Abrimos hasta las 21.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect((wsp.mock.calls[0] as any[])[0].to).toBe(ADMIN);
  });

  it('nota_interna ya no autoriza «quedó anotada» y el aviso de stock no menciona un aviso del sistema que ya no existe', async () => {
    const db = baseFalsa({ bot_notas_equipo: { select: { data: [], error: null } }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db);
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 'n', name: 'nota_interna', input: { nota: 'Pregunta por la añada del Judas' } }, TEL, 'pedidos', {});
    const out = JSON.parse(String(r.content));
    expect(out.aviso).not.toMatch(/ya podés decir que quedó anotada/);
    expect(out.aviso).toMatch(/no le digas que quedó anotada/);
    expect(fs.readFileSync(path.join(__dirname, 'bot.service.ts'), 'utf8')).not.toContain('el aviso lo agrega el sistema');
  });
});

describe('revisión (6/10/2026): pagos, facturas e importes', () => {
  it('«¿Me pueden hacer factura A a nombre de mi empresa?» + «No tengo ese dato.» → se consulta (no va al circuito de pagos) y no sale «Recibido.»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-fact' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    s.claude = { messages: { create: claudeCon(texto('No tengo ese dato.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Me pueden hacer factura A a nombre de mi empresa?' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect((wsp.mock.calls as any[]).some((c) => /^Consulta de un cliente/.test(c[0].text))).toBe(true);
    expect((wsp.mock.calls as any[]).some((c) => /Consulta de pago/.test(c[0].text))).toBe(false);
  });

  it('«Necesito la factura A de la compra de ayer» → consulta a administración por la factura (su respuesta le llega al cliente), no el circuito de pagos', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-fact' }, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    s.claude = { messages: { create: claudeCon(texto('Te la paso por acá en un rato.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Necesito la factura A de la compra de ayer' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ area: 'administracion', tema: 'la factura' });
  });

  it('un pago en manos de administración no tapa lo que no sabía: «No tengo ese dato.» (la factura) se consulta aparte y al cliente «Recibido.»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      alertas_internas: { select: { data: null, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-fact' }, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'consulta', monto: 0, motivo: 'Pregunta si llegó la transferencia de ayer', de_quien: 'Pablo' })), texto('No tengo ese dato.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Les transferí ayer, ¿les llegó? ¿Y hacen factura A?' });
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('reclamo de plata con la derivación automática y un importe inventado → el monto no sale: «Recibido.»', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    s.claude = { messages: { create: claudeCon(texto('La diferencia que te corresponde es de $5.000, la transferimos hoy al mismo CBU.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me cobraron de más en la transferencia de ayer, quiero que me devuelvan la diferencia' });
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
    expect(r.respuesta).not.toContain('5.000');
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
  });
});

describe('revisión (6/10/2026): el turno con consulta y lo demás del mensaje', () => {
  it('primer mensaje, saludo y dato en el mismo renglón → el dato sale (antes «solo saludo» lo descartaba)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv([]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-est' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿El Judas Malbec viene con estuche?', tema: 'el estuche', direccion: '' })),
      // el saludo lo pone el modelo, como pide el prompt (desde el 10/10/2026 el código no lo pisa)
      texto('Buenas tardes. Sí, tenemos Judas Malbec para retirar hoy.'),
    ) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tienen Judas Malbec y viene con estuche?' });
    expect(r.respuesta).toBe('Buenas tardes. Sí, tenemos Judas Malbec para retirar hoy.');
    expect(esSoloSaludo('Buenas tardes, te damos la bienvenida a O.D.B.')).toBe(true);
    expect(esSoloSaludo('Hola Pablo, el Judas Malbec lo tenemos para retirar hoy en Saint Thomas.')).toBe(false);
    expect(esSoloSaludo('Hola, sí: tenemos Judas Malbec 750 cc disponible')).toBe(false);
  });

  it('la reescritura puede buscar el precio: «Me llevo 3 Fernet… ¿vienen en caja?» → el pedido con el precio de la herramienta, nada de la caja', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    s.buscarProductos = jest.fn(async () => ({ items: [{ sku: 'F750', nombre: 'Fernet Branca 750 cc', precio: 20500 }] }));
    const crear = claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Vienen en caja para viajar?', tema: 'la caja para viajar', direccion: '' })),
      texto('Lo de la caja te lo confirmo por acá.'),
      conHerramientas(herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      texto('Te anoto 3 × Fernet Branca 750 cc a $20.500 c/u para retirar hoy.'),
    );
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me llevo 3 Fernet para retirar hoy. ¿Vienen en caja para viajar?' });
    expect(r.respuesta).toContain('Te anoto 3 × Fernet Branca 750 cc a $20.500 c/u para retirar hoy.');
    expect(r.respuesta).not.toMatch(/caja|confirm/i);
    expect(s.buscarProductos).toHaveBeenCalled();
  });

  it('si la reescritura igual trae un total sin fuente, se saca esa oración y no el resto', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(
      conHerramientas(herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Vienen en caja para viajar?', tema: 'la caja para viajar', direccion: '' })),
      texto('Lo de la caja te lo confirmo por acá.'),
      texto('Te anoto 3 × Fernet Branca 750 cc para retirar hoy. El total es $61.500.'),
    ) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me llevo 3 Fernet para retirar hoy. ¿Vienen en caja para viajar?' });
    expect(r.respuesta).toContain('Te anoto 3 × Fernet Branca 750 cc para retirar hoy.');
    expect(r.respuesta).not.toContain('61.500');
  });

  it('«confirmado» sin código en un turno con consulta → la frase de ahora y el aviso PEDIDO CONFIRMADO SIN CARGAR', async () => {
    const resumen = '• Fernet Branca 750 cc — 1 × $20.500 c/u = $20.500\nTotal: $20.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', '1 fernet para retirar, es todo'], ['assistant', resumen])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    s.crearPedido = jest.fn().mockRejectedValue(new Error('la cotización venció'));
    s.claude = { messages: { create: claudeCon(
      conHerramientas(herramienta('p1', 'crear_pedido', {}), herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Viene en caja?', tema: 'la caja', direccion: '' })),
      texto('Listo, tu pedido quedó confirmado para retirar en la sucursal Saint Thomas.'),
    ) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566690', mensaje: 'Sí, confirmalo. ¿Viene en caja?' });
    expect(r.respuesta).toBe(TEXTO.PEDIDO_SIN_CARGAR);
    expect(insertsDe(db, 'avisos_pedidos').filter((e: Escritura) => e.fila?.tipo === 'pedido_sin_cargar')).toHaveLength(1);
  });

  it('dos cosas distintas y la segunda con un tema que no sirve («el estacionamiento del local») → se consultan las dos', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(conHerramientas(
      herramienta('c1', 'consultar_interno', { area: 'administracion', consulta: '¿Los vinos vienen en estuche individual?', tema: 'la caja para viajar', direccion: '' }),
      herramienta('c2', 'consultar_interno', { area: 'administracion', consulta: '¿Tienen estacionamiento para clientes?', tema: 'el estacionamiento del local', direccion: '' }),
    ), texto('')) } };
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Vienen en caja? ¿Y tienen estacionamiento?' });
    expect(insertsDe(db, 'bot_consultas_internas').map((e: Escritura) => e.fila.consulta)).toEqual(['¿Los vinos vienen en estuche individual?', '¿Tienen estacionamiento para clientes?']);
  });

  it('video con vista previa y consulta silenciosa → termina ahí: sin acuse de archivo, sin pausar la charla', async () => {
    const db = baseFalsa({});
    const { s, wsp } = servicio(db);
    s.respuestaDeAdministracion = jest.fn(async () => null);
    s.resolverContactoWaha = jest.fn(async () => null);
    s.bajarMediaWaha = jest.fn(async () => ({ base64: 'AAAA', mime: 'video/mp4', nombre: 'v.mp4' }));
    s.guardarAdjuntoPrivado = jest.fn(async () => 'https://x/v.mp4');
    s.respondeModoHumano = jest.fn(async () => false);
    s.charla = jest.fn(async () => ({ respuesta: null, silencio: true, motivo: 'consulta interna pendiente: al cliente no se le dice nada' }));
    const r: any = await s.procesarEntrante({ from: `${TEL}@lid`, id: 'V1', type: 'video', hasMedia: true, body: '', _data: { jpegThumbnail: 'x'.repeat(200) } }, '5491122812200');
    expect(s.charla).toHaveBeenCalledWith(expect.objectContaining({ vistaPreviaDeVideo: true }));
    expect(r.contestado).toBe(false);
    expect(r.motivo).toMatch(/^video: consulta interna pendiente/);
    expect(wsp).not.toHaveBeenCalled();
    expect(db.escrituras.some((e: Escritura) => e.tabla === 'bot_conversaciones' && e.fila?.bot_activo === false)).toBe(false);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(0);
  });
});

describe('revisión (6/10/2026): la respuesta del área', () => {
  it('con la charla pausada no se guarda a escondidas: nota en el hilo, la consulta se cierra y el área se entera de que no le llegó', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
      bot_pagos_en_confirmacion: { select: { data: [], error: null } },
      bot_conversaciones: { select: { data: { mensajes: h(['user', 'quiero hablar con una persona']), bot_activo: false }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const r: any = await s.respuestaDeAdministracion(ADMIN, { body: 'Sí, vienen en estuche individual de cartón.', replyTo: { id: 'true_5491125213601@c.us_W-CAJA' } });
    expect(r.contestado).toBe(false);
    expect((wsp.mock.calls as any[]).some((c) => c[0].to === `${TEL}@lid`)).toBe(false);
    expect((wsp.mock.calls as any[]).find((c) => c[0].to === ADMIN)?.[0].text).toMatch(/^No le llegó al cliente \(Pablo\): la charla la atiende una persona/);
    expect(insertsDe(db, 'bot_notas_equipo')[0].fila.nota).toContain('Sobre la caja para viajar: Sí, vienen en estuche individual de cartón.');
    const cierre = db.escrituras.find((e: Escritura) => e.tabla === 'bot_consultas_internas' && e.op === 'update' && e.fila.respondido_en);
    expect(cierre.fila.ultimo_error).toMatch(/No se le mandó al cliente/);
  });

  it('el cron no manda sola una respuesta retenida de hace días: va como nota y aviso al área', async () => {
    const vieja = abiertaCaja({ respuesta_admin: 'Sí, vienen en estuche.', gestion_version: 2, creado_en: new Date(Date.now() - 3 * 86400_000).toISOString(), aviso_recordatorio_en: new Date().toISOString() });
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [vieja], error: null } },
      bot_conversaciones: { select: conv(HOLA) },
    });
    db.rpc.mockImplementation(async (fn: string) => (fn === 'tomar_entrega_consulta_bot' ? { data: [{ id: 'q-caja' }], error: null } : { data: null, error: null }));
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect((wsp.mock.calls as any[]).some((c) => c[0].to === `${TEL}@lid`)).toBe(false);
    expect((wsp.mock.calls as any[]).find((c) => c[0].to === ADMIN)?.[0].text).toMatch(/^No le llegó al cliente/);
    expect(insertsDe(db, 'bot_notas_equipo')).toHaveLength(1);
  });

  it('si la persona del área saludó, «Sobre …:» va después del saludo y no se le suma la bienvenida', async () => {
    expect(respuestaDelAreaParaCliente('la caja para viajar', 'Hola Pablo! Te confirmo que sí, vienen con estuche.')).toBe('Hola Pablo! Sobre la caja para viajar: te confirmo que sí, vienen con estuche.');
    expect(respuestaDelAreaParaCliente('la caja para viajar', 'Buenas tardes, sí vienen con estuche.')).toBe('Buenas tardes. Sobre la caja para viajar: sí vienen con estuche.');
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
      bot_pagos_en_confirmacion: { select: { data: [], error: null } },
      bot_conversaciones: { select: conv(h(['user', 'Son para llevar a España, vienen en cajas individuales?'])) },
    });
    db.rpc.mockImplementation(async (fn: string) => (fn === 'tomar_entrega_consulta_bot' ? { data: [{ id: 'q-caja' }], error: null } : { data: null, error: null }));
    const { s, wsp } = servicio(db);
    await s.respuestaDeAdministracion(ADMIN, { body: 'Hola Pablo! Te confirmo que sí, vienen con estuche.', replyTo: { id: 'true_5491125213601@c.us_W-CAJA' } });
    const alCliente = (wsp.mock.calls as any[]).map((c) => c[0]).find((p) => p.to === `${TEL}@lid`);
    expect(alCliente.text).toBe('Hola Pablo! Sobre la caja para viajar: te confirmo que sí, vienen con estuche.');
  });
});

describe('revisión (6/10/2026): textos fijos y lo que necesita main', () => {
  it('el acuse del audio o del archivo no promete «te lo resuelvo ahora» (la charla queda pausada)', () => {
    expect(TEXTO.AUDIO_SIN_TRANSCRIBIR).toBe('Recibí tu audio.');
    expect(TEXTO.ARCHIVO_SIN_ABRIR).toBe('Recibí tu archivo.');
  });
  it('conAviso (la usa main para los datos de pago) mete el texto antes de las preguntas del final', () => {
    expect(conAviso('Pedido RET-1 confirmado.\n¿A nombre de quién lo retiran?', 'Alias: outlet.de.bebidas')).toBe('Pedido RET-1 confirmado.\n\nAlias: outlet.de.bebidas\n\n¿A nombre de quién lo retiran?');
    expect(conAviso('Pedido RET-1 confirmado.', 'Alias: x')).toBe('Pedido RET-1 confirmado.\n\nAlias: x');
  });
});

// ============================================================
// PAGOS Y DERIVACIÓN (10/10/2026, tanda 1 de «basta de capas viejas»: C2 y C3). Lo que
// hoy podía decirle al cliente «Recibimos tu pago» sin pago, o perder un comprobante.
// ============================================================
describe('C2: pide una persona o reclama plata', () => {
  const armar = (o: { modelo: any[]; cliente?: any } = { modelo: [] }) => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      alertas_internas: { select: { data: null, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    if (o.cliente) s.identificarCliente = jest.fn(async () => o.cliente);
    s.derivarAHumano = jest.fn(async () => ({ derivado: true }));
    const create = claudeCon(...o.modelo);
    s.claude = { messages: { create } };
    return { db, s, wsp, create };
  };

  it('«Hola, ¿con quién hablo?» no deriva ni apaga el bot: lo contesta el modelo', async () => {
    const { s, db } = armar({ modelo: [texto('Soy Emilia, la asistente de O.D.B. ¿Qué necesitás?')] });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola, ¿con quién hablo?' });
    expect(s.derivarAHumano).not.toHaveBeenCalled();
    expect(r.respuesta).toBe('Soy Emilia, la asistente de O.D.B. ¿Qué necesitás?');
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
  });

  it('«¿con quién puedo hablar?» sí deriva', async () => {
    const { s } = armar({ modelo: [texto('')] });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Con quién puedo hablar por un pedido grande?' });
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toBe(TEXTO.DERIVACION_PEDIDA);
  });

  it('un cliente conocido escribe «hago la transferencia»: no abre un pago en administración (su «ok» le llegaba como «Recibimos tu pago»)', async () => {
    const { s, db, wsp } = armar({ modelo: [texto('Dale, mandalo por acá.')], cliente: { existe: true, nombre: 'Pablo', clienteId: 'c-1' } });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'En 10 minutos llego a la compu y hago la transferencia' });
    expect(r.respuesta).toBe('Dale, mandalo por acá.');
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });

  it('pide una persona con un borrador: la frase fija, sin reescribir (una sola llamada al modelo)', async () => {
    const { s, create } = armar({ modelo: [texto('El Fernet Branca 750 cc sale $20.500.')] });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tenés fernet? Quiero hablar con alguien' });
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toBe(TEXTO.DERIVACION_PEDIDA);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('C3: el comprobante no se pierde', () => {
  const armar = (modelo: any[]) => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(HOLA) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      alertas_internas: { select: { data: null, error: null } },
      bot_pagos_en_confirmacion: { select: { data: [], error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(...modelo) } };
    return { db, s, wsp };
  };
  const PREGUNTA = '¿A nombre de quién figura la transferencia?';

  it('comprobante sin nombre (no se pudo registrar): no sale «Recibido.»; sale la pregunta del modelo', async () => {
    const { s, db } = armar([
      conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 50000, motivo: 'Dice que transfirió $50.000' })),
      texto(PREGUNTA),
    ]);
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ya te pasé el comprobante de $50.000' });
    expect(r.respuesta).toBe(PREGUNTA);
    expect(r.respuesta).not.toBe(TEXTO.RECIBIDO);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
  });

  it('el reintento con de_quien en el mismo turno SÍ se registra (la marca va después de registrarlo) y entonces «Recibido.»', async () => {
    const { s, db, wsp } = armar([
      conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 50000, motivo: 'Transfirió $50.000' })),
      conHerramientas(herramienta('d2', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 50000, motivo: 'Transfirió $50.000', de_quien: 'Pablo Gómez' })),
      texto(''),
    ]);
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ya te pasé el comprobante de $50.000, a nombre de Pablo Gómez' });
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
    expect(wsp.mock.calls.some(([p]: any[]) => p.to === ADMIN && /Pablo Gómez/.test(String(p.text)))).toBe(true);
  });

  it('comprobante con el monto ilegible: igual le llega a administración con el archivo, y al cliente «Recibido.»', async () => {
    const { s, db, wsp } = armar([
      conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 0, motivo: 'Mandó un comprobante; no se lee el monto' })),
      texto(''),
    ]);
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '', archivoBase64: 'aW1hZ2Vu', mimeType: 'image/jpeg', archivoUrl: 'https://x.supabase.co/publico/whatsapp/1/comprobante.jpg' });
    expect(r.respuesta).toBe(TEXTO.RECIBIDO);
    const alArea = wsp.mock.calls.map(([p]: any[]) => p).find((p: any) => p.to === ADMIN);
    expect(alArea).toBeTruthy();
    expect(alArea.imagenUrl).toBe('https://x.supabase.co/publico/whatsapp/1/comprobante.jpg');
    expect(alArea.text).toMatch(/Comprobante recibido/);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
  });
});
