import * as fs from 'fs';
import * as path from 'path';
import { BotService } from './bot.service';
import { mencionaConsulta, sinMencionDeConsulta, sinPromesas } from './prolijo';
import { datosDePagoParaResumen, respuestaPedidoPorComprobante, sinPedirConfirmo } from './pago-confirma';
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

  it('(3b) si el modelo solo escribió lo de la caja, una reescritura sin herramientas y con razonamiento contesta lo demás', async () => {
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
    const reescritura = crear.mock.calls.map((c: any[]) => c[0]).filter((p: any) => p.model !== 'claude-haiku-4-5')[2];
    expect(reescritura.tools).toBeUndefined();
    expect(reescritura.thinking).toEqual({ type: 'adaptive' });
    const ultimo = reescritura.messages.at(-1).content;
    const nota = typeof ultimo === 'string' ? ultimo : ultimo.map((x: any) => x.text ?? '').join(' ');
    expect(nota).toMatch(/Al cliente NO le menciones nada de eso/);
    expect(nota).toMatch(/Si no hay nada más que contestar, no escribas nada/);
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
    expect(alCliente.text).toMatch(/^(?:Buen día|Buenas tardes|Buenas noches), te damos la bienvenida a O\.D\.B\. Sobre la caja para viajar: sí, vienen en estuche individual de cartón\.$/);
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
    sinPedirConfirmo('Decime «confirmo» y lo dejo listo.', 'te transfiero', []),
    sinPedirConfirmo('Decime «confirmo» y lo dejo listo.', 'ok', ['• Fernet — 2 × $20.500 c/u = $41.000\nTotal: $41.000\n¿Lo confirmo?']),
    'Sí, ya lo tengo.',
    'Alias: outlet.de.bebidas · CBU: 0720000000000000000000 · Titular: Chinvenguencha SRL (Santander). Cuando transfieras, mandame el comprobante por acá.',
    'Pedido PICKUP-1 confirmado. Total: $41.000.\nSe abona al retirar, en efectivo o tarjeta.',
    'Disculpe, no pude procesar su mensaje. ¿Me lo repite, por favor?',
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

  it('el reemplazo fijo de «confirmado» sin código: texto honesto sin anunciar el aviso, y el aviso sale igual (prometioAvisoDePedido)', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) } });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Le confirmo el pedido para retiro en Sant Thomas: 1 Fernet. Lo esperamos.')) } };
    s.regenerar = jest.fn().mockResolvedValue(null);
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155566677', mensaje: 'dale confirmalo' });
    expect(r.respuesta).toContain(TEXTO.PEDIDO_SIN_CARGAR);
    expect(r.respuesta).not.toMatch(/aviso al sector|doy aviso|te confirm/i);
    expect(avisosDe(db)).toHaveLength(1);
    expect(avisosDe(db)[0].fila.detalle).toMatchObject({ telefono: '5491155566677' });
  });

  it('la reescritura del modelo con la frase de ahora también sale a administración', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) } });
    const { s } = servicio(db);
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
    // la disculpa del reclamo (ronda 10) y «Recibido.» (23/9), sin nada de lo que hace administración
    expect(r.respuesta).toBe('Lamento el inconveniente. Recibido.');
  });
});
