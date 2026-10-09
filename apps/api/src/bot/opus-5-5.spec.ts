// EL BOT EN OPUS 5.5 (Leandro, 6/10/2026: «quiero que bajemos el gasto de ODB»).
// Sin llamar a la API: se simula el SDK con respuestas con la forma de Opus 5.5
// (bloques de razonamiento vacíos con firma, el texto entre herramientas dentro
// del razonamiento, rechazos con stop_reason 'refusal', cortes por el tope) y se
// revisa lo que cambia en 5.5:
//  · todas las llamadas del turno van con el mismo modelo, razonamiento,
//    esfuerzo, system y lista de herramientas, y la charla solo se agrega al
//    final (los bloques de razonamiento quedan atados a la conversación: sacar
//    o achicar las herramientas a mitad del turno es un 400 en cuentas nuevas);
//  · nada de tool_choice forzado (any/tool es un 400 en 5.5): solo none;
//  · un rechazo o un corte no se toman como texto.
// Con ODB_VOLCAR_TURNO=<archivo.jsonl> las llamadas de cada turno se guardan
// para pasarlas por prefix_diff.py (la verificación offline de la guía).
import { appendFileSync } from 'fs';
import { BotService } from './bot.service';
import { HERRAMIENTAS_PEDIDOS, SYSTEM_PEDIDOS } from './agente-bot';

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return col in fila && String(fila[col]) === String(val);
    if (k === 'neq') return String(fila[col]) !== String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return col in fila && String(fila[col]) >= String(val);
    if (k === 'lte') return col in fila && String(fila[col]) <= String(val);
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

const TEL = '5491155501234';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, bot_activo: true };
const conv = (mensajes: any[]) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] }, error: null });
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 11000, cache_creation_input_tokens: 300 };
// las formas de Opus 5.5
const pensar = (firma: string) => ({ type: 'thinking', thinking: '', signature: firma });
const herramienta = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const conHerramientas = (...content: any[]) => ({ stop_reason: 'tool_use', content, usage });
const final = (firma: string, t: string) => ({ stop_reason: 'end_turn', content: [pensar(firma), { type: 'text', text: t }], usage });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'insert');

function servicio(db: any, ...principal: any[]) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W-1' }));
  s.respondeRegistrar = jest.fn(async () => null);
  s.buscarProductos = jest.fn(async () => ({ items: [{ sku: 'F1', nombre: 'Fernet Branca 750 cc', precio: 20500, disponible: true }] }));
  s.estadoAtencion = jest.fn(async () => ({ abierto: true, cierra: '21:00' }));
  // cada llamada se guarda como la vio la API (copia: la charla sigue creciendo)
  const llamadas: any[] = [];
  const create = jest.fn(async (p: any) => {
    llamadas.push(JSON.parse(JSON.stringify(p)));
    if (process.env.ODB_VOLCAR_TURNO && p.model !== 'claude-haiku-4-5') appendFileSync(process.env.ODB_VOLCAR_TURNO, JSON.stringify(p) + '\n');
    if (p.model === 'claude-haiku-4-5') return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sin_responder":[]}' }], usage };
    const siguiente = principal.shift();
    return typeof siguiente === 'function' ? siguiente(p) : siguiente ?? final('fin', 'Listo.');
  });
  s.claude = { messages: { create } };
  return { s, llamadas, create };
}

// lo que la API no compara: las marcas de caché y texto suelto contra un único bloque de texto
const sinMarcas = (x: any): any => (Array.isArray(x) ? x.map(sinMarcas) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'cache_control').map(([k, v]) => [k, sinMarcas(v)])) : x);
const normal = (m: any) => sinMarcas({ role: m.role, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content });

/** Las invariantes de Opus 5.5 sobre las llamadas del modelo principal de un turno. */
function revisarTurno(llamadas: any[]) {
  const opus = llamadas.filter((p) => p.model !== 'claude-haiku-4-5' && !p.output_config?.format);
  expect(opus.length).toBeGreaterThan(0);
  for (const p of opus) {
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.output_config).toEqual({ effort: 'medium' });
    expect(p.max_tokens).toBeGreaterThanOrEqual(16000);
    // nada de tool_choice forzado: en 5.5 any/tool son un 400
    expect(p.tool_choice === undefined || p.tool_choice?.type === 'none').toBe(true);
    // la lista de herramientas y el system, idénticos en todo el turno
    expect(p.tools).toEqual(opus[0].tools);
    expect(sinMarcas(p.system)).toEqual(sinMarcas(opus[0].system));
  }
  // la charla solo se agrega: cada llamada empieza con TODO lo que mandó la anterior
  for (let i = 1; i < opus.length; i++) {
    const antes = opus[i - 1].messages.map(normal);
    const ahora = opus[i].messages.map(normal);
    expect(ahora.length).toBeGreaterThan(antes.length);
    expect(ahora.slice(0, antes.length)).toEqual(antes);
  }
  return opus;
}

const firmasEn = (p: any) => p.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === 'thinking').map((b: any) => b.signature);

describe('el bot en Opus 5.5: una sola forma para todo el turno', () => {
  it('búsqueda + respuesta con promesa de plazo + regeneración: misma forma, la charla solo crece y el razonamiento vuelve tal cual', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      final('b', 'Fernet Branca 750 cc: $20.500. Te lo preparo en un momento.'),
      final('c', 'Fernet Branca 750 cc: $20.500.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tienen fernet?' });
    expect(r.respuesta).toMatch(/Fernet Branca 750 cc: \$20\.500\.$/);
    const opus = revisarTurno(llamadas);
    expect(opus).toHaveLength(3);
    // la regeneración va CON las herramientas, sin tool_choice (para leer la charla
    // de la caché), y la consigna le dice que no las use
    expect(opus[2].tool_choice).toBeUndefined();
    const consigna = opus[2].messages.at(-1).content;
    expect(JSON.stringify(consigna)).toMatch(/en esta vuelta no uses herramientas/);
    // el razonamiento de la vuelta con herramientas vuelve tal cual en las siguientes
    expect(firmasEn(opus[1])).toEqual(['a']);
    expect(firmasEn(opus[2])).toEqual(['a']);
  });

  it('la corrección que puede usar herramientas (total prometido): mismas herramientas, se ejecuta y la regeneración escribe', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      final('a', 'Te paso el total en un momento.'),
      conHerramientas(pensar('b'), herramienta('e1', 'estado_local', {})),
      final('c', 'Abrimos hasta las 21.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'hola, abren hoy' });
    expect(r.respuesta).toMatch(/Abrimos hasta las 21\.$/);
    expect(s.estadoAtencion).toHaveBeenCalledTimes(1);
    const opus = revisarTurno(llamadas);
    expect(opus).toHaveLength(3);
    // el aviso de «sin herramientas» va DESPUÉS de los resultados, en el mismo mensaje
    const ultimo = opus[2].messages.at(-1);
    expect(ultimo.content[0].type).toBe('tool_result');
    expect(ultimo.content.at(-1)).toMatchObject({ type: 'text' });
    expect(ultimo.content.at(-1).text).toMatch(/en esta vuelta no uses herramientas/);
  });

  it('una herramienta que falla tres veces: la vuelta siguiente lleva las MISMAS herramientas y tool_choice none', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), herramienta('e1', 'estado_local', {})),
      conHerramientas(pensar('b'), herramienta('e2', 'estado_local', {})),
      conHerramientas(pensar('c'), herramienta('e3', 'estado_local', {})),
      final('d', 'Hoy abrimos de 9 a 21.'),
    );
    s.estadoAtencion = jest.fn(async () => { throw new Error('sin conexión'); });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'abren hoy' });
    expect(r.respuesta).toMatch(/Hoy abrimos de 9 a 21\.$/);
    const opus = revisarTurno(llamadas);
    expect(opus).toHaveLength(4);
    expect(opus.slice(0, 3).every((p) => p.tool_choice === undefined)).toBe(true);
    expect(opus[3].tool_choice).toEqual({ type: 'none' });
    expect(opus[3].tools.map((t: any) => t.name)).toEqual(HERRAMIENTAS_PEDIDOS.map((t) => t.name));
    expect(firmasEn(opus[3])).toEqual(['a', 'b', 'c']);
  });

  it('si en una regeneración igual pide una herramienta, no se ejecuta: «no disponible» y la vuelta siguiente sigue leyendo la caché (sin tool_choice)', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      final('a', 'Te lo preparo en un momento.'),
      conHerramientas(pensar('b'), herramienta('x1', 'estado_local', {})),
      final('c', 'Abrimos hasta las 21.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'abren hoy' });
    expect(r.respuesta).toMatch(/Abrimos hasta las 21\.$/);
    expect(s.estadoAtencion).not.toHaveBeenCalled();
    const opus = revisarTurno(llamadas);
    expect(opus).toHaveLength(3);
    expect(opus[1].tool_choice).toBeUndefined();
    // revisión del 6/10/2026: tool_choice none invalida la caché de la charla
    // (reescribía todo el turno a 1,25×); la segunda vuelta va como la primera
    expect(opus[2].tool_choice).toBeUndefined();
    const resultado = opus[2].messages.at(-1).content[0];
    expect(resultado).toMatchObject({ type: 'tool_result', tool_use_id: 'x1', is_error: true });
    expect(String(resultado.content)).toMatch(/No disponible en esta vuelta/);
  });

  it('si insiste con herramientas en la regeneración, la TERCERA vuelta va con tool_choice none (no las puede usar)', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      final('a', 'Te lo preparo en un momento.'),
      conHerramientas(pensar('b'), herramienta('x1', 'estado_local', {})),
      conHerramientas(pensar('c'), herramienta('x2', 'estado_local', {})),
      final('d', 'Abrimos hasta las 21.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'abren hoy' });
    expect(r.respuesta).toMatch(/Abrimos hasta las 21\.$/);
    expect(s.estadoAtencion).not.toHaveBeenCalled();
    const opus = revisarTurno(llamadas);
    expect(opus).toHaveLength(4);
    expect(opus.slice(0, 3).every((p) => p.tool_choice === undefined)).toBe(true);
    expect(opus[3].tool_choice).toEqual({ type: 'none' });
    expect(firmasEn(opus[3])).toEqual(['b', 'c']);
  });

  it('cortada por el tope con solo razonamiento: no sale a medias ni «no pude procesar»; se vuelve a pedir con la misma forma', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      { stop_reason: 'max_tokens', content: [pensar('a')], usage },
      final('b', 'Sí, abrimos hasta las 21.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'abren hoy' });
    expect(r.respuesta).toMatch(/Sí, abrimos hasta las 21\.$/);
    expect(r.respuesta).not.toMatch(/no pude procesar/i);
    expect(revisarTurno(llamadas)).toHaveLength(2);
  });

  it('cortada a mitad de una frase: esa frase no le llega al cliente', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db,
      { stop_reason: 'max_tokens', content: [pensar('a'), { type: 'text', text: 'Sí, abrimos hasta las' }], usage },
      final('b', 'Sí, abrimos hasta las 21.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'abren hoy' });
    expect(r.respuesta).toMatch(/Sí, abrimos hasta las 21\.$/);
  });

  it('un rechazo de seguridad: no se regenera (se rechazaría igual), se consulta en silencio y al cliente no le sale nada', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv([]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } },
    });
    const { s, llamadas } = servicio(db, { stop_reason: 'refusal', content: [], stop_details: { category: 'bio', explanation: null }, usage });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Qué levadura uso para fermentar en casa?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ area: 'administracion' });
  });

  it('la línea de proveedores no tiene herramientas: no va la lista ni tool_choice', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db, final('a', 'Recibido, gracias. Queda registrada y el equipo la revisa.'));
    await s.charla({ linea: 'proveedores', telefono: TEL, mensaje: 'Te paso la lista de precios nueva' });
    const p = llamadas.find((x) => x.model === 'claude-opus-5-5');
    expect(p.tools).toBeUndefined();
    expect(p.tool_choice).toBeUndefined();
  });
});

describe('revisión del 6/10/2026 (hallazgos sobre el cambio a Opus 5.5)', () => {
  const texto = (t: string) => ({ type: 'text', text: t });
  const vaciosDelAsistente = (llamadas: any[]) => llamadas.flatMap((p) => p.messages ?? []).filter((m: any) => m.role === 'assistant' && typeof m.content === 'string' && !m.content.trim());

  it('un texto corto antes de la herramienta y un final corto que lo repite (lo pide el prompt): al cliente le llega UNA vez', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db,
      conHerramientas(pensar('a'), texto('Anotado a nombre de Pablo.'), herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      final('b', 'Anotado, Pablo. Retirás mañana.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'a nombre de Pablo, retiro mañana' });
    expect(r.respuesta).toMatch(/Anotado, Pablo\. Retirás mañana\.$/);
    expect(r.respuesta).not.toMatch(/Anotado a nombre de Pablo/);
  });

  it('lo de antes que el final corto NO dice se sigue rescatando (el audio de Pablo)', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db,
      conHerramientas(pensar('a'), texto('Te lo dejo a nombre de Pablo para retirar mañana.'), herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      final('b', 'El Fernet Branca 750 cc sale $20.500.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'a nombre de Pablo, retiro mañana, cuánto sale el fernet' });
    expect(r.respuesta).toMatch(/a nombre de Pablo para retirar mañana\.\s+El Fernet Branca 750 cc sale \$20\.500\./);
  });

  it('cortada por el tope después de un anuncio («Dale, ya te busco…»): no sale el anuncio, el cierre vuelve a pedir la respuesta', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), texto('Dale, ya te busco las opciones.'), herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      { stop_reason: 'max_tokens', content: [pensar('b')], usage },
      final('c', 'Fernet Branca 750 cc: $20.500.'),
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'tenés fernet?' });
    expect(r.respuesta).toMatch(/Fernet Branca 750 cc: \$20\.500\.$/);
    expect(r.respuesta).not.toMatch(/ya te busco/);
    expect(revisarTurno(llamadas)).toHaveLength(3);
  });

  it('rechazo de seguridad + «quiero hablar con una persona»: se deriva, sale «Te paso con una persona», sin mensaje vacío a la API ni consulta de más', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv([]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } },
    });
    const { s, llamadas } = servicio(db, { stop_reason: 'refusal', content: [], stop_details: { category: 'bio', explanation: null }, usage });
    s.derivarAHumano = jest.fn(async () => ({ derivada: true }));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'quiero hablar con una persona, ¿qué levadura uso para fermentar en casa?' });
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toMatch(/Te paso con una persona de la casa\./);
    // una sola llamada (la rechazada): nada de regenerar con un borrador vacío (400)
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(1);
    expect(vaciosDelAsistente(llamadas)).toHaveLength(0);
    // ya está en manos de una persona: no se consulta además a administración
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('segunda disputa de precio: el aviso de «sin herramientas» no contradice el «no escribas nada» de la consigna, y el silencio se respeta', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv([{ role: 'user', content: 'Son 18 botellas, está mal la cuenta' }, { role: 'assistant', content: 'El total está correcto: corresponde al pack de 6.' }]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-precio' }, error: null } },
    });
    const { s, llamadas } = servicio(db,
      final('a', 'El total es correcto, corresponde al pack.'),
      // en la regeneración igual pide una herramienta: no se ejecuta
      conHerramientas(pensar('b'), herramienta('x1', 'buscar_productos', { q: 'coca' })),
      // y obedece la consigna: no escribe nada
      { stop_reason: 'end_turn', content: [pensar('c')], usage },
      // (la reescritura de la consulta silenciosa, por las «18 botellas»: tampoco)
      { stop_reason: 'end_turn', content: [pensar('d')], usage },
    );
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'te digo que está mal la cuenta, son 18 botellas c/u' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(r.respuesta).toBeNull();
    const opus = revisarTurno(llamadas);
    const consigna = JSON.stringify(opus[1].messages.at(-1).content);
    expect(consigna).toMatch(/si no preguntó otra cosa, no escribas nada/);
    expect(consigna).toMatch(/si te dice que no escribas nada, no escribas nada/);
    expect(consigna).not.toMatch(/escribí directamente el mensaje/);
    const resultado = opus[2].messages.at(-1).content[0];
    expect(String(resultado.content)).toMatch(/si te dice que no escribas nada, no escribas nada/);
    expect(String(resultado.content)).not.toMatch(/escribí ahora el mensaje/);
    expect(s.buscarProductos).not.toHaveBeenCalled();
  });

  it('anti-repetición tras un «sí» con la cotización vencida: crear_pedido corre de verdad (con su guarda) y un «quedó confirmado» sin código no sale', async () => {
    // oraciones cortas: si alguna se repitiera textual, la toma antes otra guarda (G5-bis)
    const resumen = 'Coca Zero 1,75 L: 3 por $14.100. Retiro en la sucursal Saint Thomas. A nombre de Pedro. ¿Lo confirmo?';
    const db = baseFalsa({
      bot_conversaciones: { select: conv([{ role: 'user', content: '3 coca zero 1.75 para retirar, Pedro' }, { role: 'assistant', content: resumen }]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
    });
    const { s, llamadas } = servicio(db,
      // casi el mismo resumen (si fuera idéntico lo toma antes otra guarda)
      final('a', resumen.replace('Retiro en la sucursal', 'Retirás en la sucursal')),
      conHerramientas(pensar('b'), herramienta('c1', 'crear_pedido', { confirmacion: 'si' })),
      final('c', 'Listo, tu pedido quedó confirmado. Te esperamos en Saint Thomas.'),
    );
    // el «sí» directo del servidor no alcanza (la cotización venció)
    s.crearPedido = jest.fn(async () => { throw new Error('la cotización venció'); });
    const ejecutadas: string[] = [];
    s.ejecutarHerramienta = jest.fn(async (b: any) => {
      ejecutadas.push(b.name);
      return { type: 'tool_result', tool_use_id: b.id, content: '{"error":"NO se creó el pedido: la cotización venció, volvé a cotizar"}', is_error: true };
    });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'si' });
    // crear_pedido llegó a la herramienta real (antes se frenaba con «no disponible»)
    expect(ejecutadas).toContain('crear_pedido');
    expect(r.respuesta).not.toMatch(/qued[oó] confirmado/i);
    expect(r.respuesta).toMatch(/Tuve un problema para cargar el pedido/);
    revisarTurno(llamadas);
  });
});

describe('la caché del bot (9/10/2026: el hilo se reusa por defecto)', () => {
  const guardadas: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ['ODB_BOT_CACHE_PREFIJO', 'ODB_BOT_CACHE_HILO']) { guardadas[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const [k, v] of Object.entries(guardadas)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } jest.useRealTimers(); });

  const hist = [{ role: 'user', content: 'Hola, ¿tienen fernet?' }, { role: 'assistant', content: 'Sí: Fernet Branca 750 cc a $20.500.' }];

  it('ODB_BOT_CACHE_HILO=0: como antes (5 minutos, la hora en el system, los avisos del mensaje en el system)', async () => {
    process.env.ODB_BOT_CACHE_HILO = '0';
    const db = baseFalsa({ bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db, final('a', 'Anotado.'));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'quiero 2 fernet' });
    const p = llamadas[0];
    expect(p.system[0]).toMatchObject({ text: SYSTEM_PEDIDOS, cache_control: { type: 'ephemeral' } });
    expect(p.system[0].cache_control.ttl).toBeUndefined();
    expect(p.system[1].text).toMatch(/^HOY ES .+, \d{1,2}:\d{2}/);
    expect(p.system.some((b: any) => /CANTIDADES QUE PIDIÓ EL CLIENTE/.test(b.text))).toBe(true);
    expect(p.messages[1].content).toBe(hist[1].content);
  });

  it('ODB_BOT_CACHE_PREFIJO=1h: el prompt fijo se guarda una hora (y la marca de la charla sigue de 5 minutos, después)', async () => {
    process.env.ODB_BOT_CACHE_PREFIJO = '1h';
    const db = baseFalsa({ bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db, final('a', 'Anotado.'));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'quiero 2 fernet' });
    expect(llamadas[0].system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(llamadas[0].messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('ODB_BOT_CACHE_HILO=1: el system no cambia de un mensaje a otro (sin minutos ni avisos del mensaje) y el historial lleva su marca', async () => {
    process.env.ODB_BOT_CACHE_HILO = '1';
    const db = baseFalsa({ bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db, final('a', 'Anotado.'), final('b', 'Anotado.'));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'quiero 2 fernet' });
    await s.charla({ linea: 'pedidos', telefono: '5491155509999', mensaje: '?' });
    const [uno, dos] = llamadas.filter((p) => p.model === 'claude-opus-5-5');
    expect(uno.system).toEqual(dos.system);
    expect(uno.system[1].text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(uno.system.some((b: any) => /CANTIDADES QUE PIDIÓ/.test(b.text))).toBe(false);
    // los avisos del mensaje van al final del mensaje del cliente
    expect(JSON.stringify(uno.messages.at(-1).content)).toMatch(/AVISOS DEL SISTEMA PARA ESTE MENSAJE: CANTIDADES QUE PIDIÓ EL CLIENTE/);
    expect(JSON.stringify(dos.messages.at(-1).content)).toMatch(/AVISOS DEL SISTEMA PARA ESTE MENSAJE: El cliente mandó solo un signo de pregunta/);
    // la marca al final del historial, sin tocar su texto
    expect(uno.messages[1].content).toEqual([{ type: 'text', text: hist[1].content, cache_control: { type: 'ephemeral' } }]);
    // y no se guarda en la base con la marca
    const guardado = db.escrituras.find((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert');
    expect(guardado.fila.mensajes[1]).toEqual(hist[1]);
  });

  it('ODB_BOT_CACHE_PREFIJO=mantener: a los ~4 minutos sin llamadas renueva el prompt fijo con max_tokens 0 y la misma forma; pasada la hora, no más', () => {
    process.env.ODB_BOT_CACHE_PREFIJO = 'mantener';
    jest.useFakeTimers();
    const db = baseFalsa();
    const { s, create } = servicio(db);
    create.mockImplementation(async () => ({ stop_reason: 'max_tokens', content: [], usage: { input_tokens: 5, cache_read_input_tokens: 11500, cache_creation_input_tokens: 0, output_tokens: 0 } }));
    const system = [{ type: 'text', text: SYSTEM_PEDIDOS, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'HOY ES …' }];
    const pedido = s.pedidoBot(system, HERRAMIENTAS_PEDIDOS, [{ role: 'user', content: 'hola' }]);
    jest.advanceTimersByTime(3 * 60_000);
    expect(create).not.toHaveBeenCalled();
    jest.advanceTimersByTime(90_000);
    expect(create).toHaveBeenCalledTimes(1);
    const ping = create.mock.calls[0][0];
    expect(ping).toMatchObject({ model: pedido.model, max_tokens: 0, thinking: pedido.thinking, output_config: { effort: pedido.output_config.effort } });
    expect(ping.system).toEqual([system[0]]);
    expect(ping.tools).toBe(pedido.tools);
    expect(ping.tool_choice).toBeUndefined();
    expect(ping.stream).toBeUndefined();
    // una llamada real corre el reloj: no hay ping mientras hay movimiento
    jest.advanceTimersByTime(60_000);
    s.pedidoBot(system, HERRAMIENTAS_PEDIDOS, [{ role: 'user', content: 'otra' }]);
    jest.advanceTimersByTime(3 * 60_000);
    expect(create).toHaveBeenCalledTimes(1);
    // pasada la hora desde la última llamada real, se deja de renovar
    jest.advanceTimersByTime(70 * 60_000);
    const hechos = create.mock.calls.length;
    jest.advanceTimersByTime(30 * 60_000);
    expect(create.mock.calls.length).toBe(hechos);
    expect(hechos).toBeLessThanOrEqual(16);
  });

  it('sin la variable no se programa nada', () => {
    jest.useFakeTimers();
    const { s, create } = servicio(baseFalsa());
    s.pedidoBot([{ type: 'text', text: SYSTEM_PEDIDOS, cache_control: { type: 'ephemeral' } }], HERRAMIENTAS_PEDIDOS, [{ role: 'user', content: 'hola' }]);
    jest.advanceTimersByTime(30 * 60_000);
    expect(create).not.toHaveBeenCalled();
  });
});

// (el tope de la búsqueda se prueba en tope-busqueda.spec.ts: es la versión que está en producción)
