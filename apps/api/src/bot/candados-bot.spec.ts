// Los candados de bot.service.ts, de punta a punta en charla() (9/10/2026). El
// 9/10 las funciones existían pero no estaban conectadas: estas pruebas pasan por
// el bot entero para que eso no vuelva a pasar.
import { appendFileSync } from 'fs';
import { BotService } from './bot.service';
import * as TEXTO from './textos-fijos';

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


const COT = {
  renglones: [
    { sku: 'C1', nombre: 'Coca Cola Zero 1,75 L', cantidad: 8, renglon: '8 × $4.700 c/u = $37.600', subtotal: 37600 },
    { sku: 'CH', nombre: 'Chandon Extra Brut 750 cc', cantidad: 2, renglon: '2 × $22.700 c/u = $45.400', subtotal: 45400, subtotalEfectivo: 40860 },
    { sku: 'AB', nombre: 'Absolut vodka clásico 750 cc', cantidad: 1, renglon: '1 × $33.500 c/u = $33.500', subtotal: 33500, subtotalEfectivo: 30150 },
  ],
  total: 116500,
  totalEfectivo: 104510,
};
const ANTES = 'Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. ¿Lo retirás en la sucursal Saint Thomas o te lo enviamos?';
const HIST = [
  { role: 'user', content: '8 coca zero, 2 chandon y la sal. Está completo' },
  { role: 'assistant', content: '• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600\n• Chandon Extra Brut 750 cc — 2 × $22.700 c/u = $45.400\nTotal: $83.000\n¿Lo retirás o te lo enviamos?' },
  { role: 'user', content: 'Te hago un cambio me podrás sacar la sal y agregar un absolut por favor?' },
  { role: 'assistant', content: ANTES },
];

describe('candados conectados al bot', () => {
  it('14:51 «me pasás la cuenta final?»: aunque el modelo conteste la línea del cambio con el total, sale la lista completa y sin la oración repetida', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(HIST) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), herramienta('t1', 'cotizar_pedido', { items: [{ sku: 'C1', cantidad: 8 }, { sku: 'CH', cantidad: 2 }, { sku: 'AB', cantidad: 1 }] })),
      final('b', 'Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. Total: $116.500, o $104.510 en efectivo o transferencia. ¿A nombre de quién lo preparo?'),
    );
    s.cotizarPedido = jest.fn(async () => COT);
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me pasas la cuenta final ? Retiro en sucursal' });
    expect(r.respuesta).toContain('• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600');
    expect(r.respuesta).toContain('• Absolut vodka clásico 750 cc — 1 × $33.500 c/u = $33.500');
    expect(r.respuesta).toMatch(/Total: \$116\.500/);
    expect(r.respuesta).toMatch(/¿A nombre de quién lo preparo\?/);
    expect(r.respuesta).not.toContain('Saco la sal y sumo');
    // sin reescrituras (10/10/2026: el control de oraciones repetidas que le pedía «decí solo lo
    // nuevo» se sacó): la vuelta con la herramienta y la respuesta, nada más
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(2);
    expect(r.respuesta.split('\n').filter((l: string) => l.startsWith('• '))).toHaveLength(3);
  });
});

describe('un texto largo no se reescribe y la lista queda en renglones (21:15 del 9/10)', () => {
  // (10/10/2026: se sacó «respuestas acotadas», la capa que aplastaba las listas y seguía viva con un parche)
  it('con mucho texto, sale como lo escribió el modelo: la lista primero, en renglones, y una sola llamada', async () => {
    const LISTA = '• 4 × Gatorade Frutas Tropicales 500 cc (el rojo)\n• 4 × Agua Glaciar sin gas 2 L\n• 2 × Sprite Zero 1,75 L';
    const PARRAFO = "De Franui hay cuatro gustos. El de leche es el clásico. El Pink Frambuesa es frutal. El Pink Chocolate Amargo es intenso. El Free es sin azúcar. De helado hay pintas Freddo, tabletas Freddo, paletas Lucciano's y Frigor. ¿Qué gustos y cuántos querés de cada uno?";
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s, llamadas } = servicio(db, final('a', `${LISTA}\n\n${PARRAFO}`));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Quiero 4 Gatorade rojos, 4 aguas minerales, 2 Sprite Zero, Franui y helado: ¿qué gustos tenés?' });
    expect(r.respuesta.startsWith(LISTA.split('\n')[0])).toBe(true);
    for (const l of LISTA.split('\n')) expect(r.respuesta).toContain(l);
    // y los renglones siguen siendo renglones (antes «E, ronda 9» los pegaba en un párrafo)
    expect(r.respuesta.split('\n').filter((l: string) => l.startsWith('• '))).toHaveLength(3);
    expect(r.respuesta).toContain(PARRAFO);
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(1);
  });
});

// ============================================================
// LO QUE QUEDA DE LAS CAPAS VIEJAS (10/10/2026, «basta de capas viejas»). El modelo
// escribe y casi nada pisa su respuesta.
// ============================================================
const LISTA_5 = '• 2 × Fernet Branca 750 cc\n• 3 × Coca Cola Zero 1,75 L\n• 1 × Hielo 2 kg\n• 2 × Sprite Zero 1,75 L\n• 1 × Absolut vodka clásico 750 cc';
const CINCO = [
  { role: 'user', content: '2 fernet, 3 coca zero, 1 hielo, 2 sprite zero y 1 absolut' },
  { role: 'assistant', content: `Te anoto:\n${LISTA_5}\n\n¿Está completo el pedido o querés sumar algo?` },
];
const CONSULTAS = { select: { data: [], error: null }, insert: { data: { id: 'q-1' }, error: null } };

describe('lo que queda de las capas viejas (10/10/2026)', () => {
  it('LA MÁS IMPORTANTE: la lista actualizada (de 5 a 6 renglones) sale entera, en renglones, con una sola llamada al modelo y sin derivar', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CINCO) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const actualizada = `Sumo 2 × Gatorade Frutas Tropicales 500 cc.\n\n${LISTA_5}\n• 2 × Gatorade Frutas Tropicales 500 cc`;
    const { s, llamadas } = servicio(db, final('a', actualizada));
    s.derivarAHumano = jest.fn(async () => ({ derivada: true }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'sumale 2 gatorade rojos' });
    // antes «nunca el mismo mensaje dos veces» la achicaba o le pasaba la charla a una persona en plena venta
    expect(r.respuesta).toBe(actualizada);
    const renglones = r.respuesta.split('\n').filter((l: string) => l.startsWith('• '));
    expect(renglones).toHaveLength(6);
    expect(renglones.at(-1)).toBe('• 2 × Gatorade Frutas Tropicales 500 cc');
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(1);
    expect(s.derivarAHumano).not.toHaveBeenCalled();
    expect(r.respuesta).not.toContain(TEXTO.PASA_A_UNA_PERSONA);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('respuesta vacía (también en la vuelta de cierre): no sale «Disculpe, no pude procesar su mensaje»; se consulta en silencio', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CINCO) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const { s, llamadas } = servicio(db, vacia('a'), vacia('b'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿El Absolut es el de 750 o el de litro?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    // el reintento sin herramientas se queda; no hay una tercera vuelta
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(2);
    const consultas = insertsDe(db, 'bot_consultas_internas');
    expect(consultas).toHaveLength(1);
    expect(consultas[0].fila).toMatchObject({ area: 'administracion' });
    const guardado = db.escrituras.find((e: Escritura) => e.tabla === 'bot_conversaciones' && e.op === 'upsert');
    expect(JSON.stringify(guardado.fila.mensajes)).not.toMatch(/no pude procesar/i);
  });

  it('respuesta idéntica al mensaje anterior (sin tildes, mayúsculas ni puntuación): no sale, no se reescribe y se consulta en silencio', async () => {
    const anterior = 'El Fernet Branca 750 cc sale $20.500.';
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: '¿cuánto sale el fernet?' }, { role: 'assistant', content: anterior }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s, llamadas } = servicio(db, final('a', 'el fernet branca 750 cc sale $20.500'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿y el de litro?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(1);
    const consultas = insertsDe(db, 'bot_consultas_internas');
    expect(consultas).toHaveLength(1);
    expect(consultas[0].fila).toMatchObject({ area: 'administracion', consulta: '¿y el de litro?' });
  });

  // (10/10/2026, revisión de la tanda 1: era «silencio, sin consulta». Pero el «ok» contesta
  // «¿Está completo el pedido…?»: quiere decir «está completo, pasame el total», y el cliente
  // quedaba esperando sin que nadie lo supiera)
  it('a un «ok» que contesta una pregunta del bot el modelo no escribe nada: no sale nada y se consulta en silencio', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CINCO) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const { s } = servicio(db, vacia('a'), vacia('b'));
    s.derivarAHumano = jest.fn(async () => ({ derivada: true }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'ok' });
    expect(r.respuesta).toBeNull();
    const consultas = insertsDe(db, 'bot_consultas_internas');
    expect(consultas).toHaveLength(1);
    expect(consultas[0].fila).toMatchObject({ area: 'administracion' });
    expect(s.derivarAHumano).not.toHaveBeenCalled();
  });

  it('«sí» a «¿Te lo anoto?» con la respuesta vacía dos veces, y «dale» a «¿retirar o envío?» con el mensaje repetido: se consultan en silencio', async () => {
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const a = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: '¿cuánto sale el fernet?' }, { role: 'assistant', content: 'Fernet Branca 750 cc a $20.500. ¿Te lo anoto?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sa = servicio(a, vacia('a'), vacia('b')).s;
    expect((await sa.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'sí' })).respuesta).toBeNull();
    expect(insertsDe(a, 'bot_consultas_internas')).toHaveLength(1);
    const anterior = 'Te anoto:\n• 2 × Fernet Branca 750 cc\n\n¿Lo querés para retirar o con envío?';
    const b = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: '2 fernet' }, { role: 'assistant', content: anterior }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sb = servicio(b, final('a', anterior)).s;
    expect((await sb.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'dale' })).respuesta).toBeNull();
    expect(insertsDe(b, 'bot_consultas_internas')).toHaveLength(1);
  });

  it.each(['sí', 'recibido'])('«%s» sin una pregunta del bot y el modelo no escribe nada: silencio, sin consulta (un acuse no es una pregunta)', async (mensaje) => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: 'te transferí' }, { role: 'assistant', content: 'Recibido.' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const { s } = servicio(db, vacia('a'), vacia('b'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  // (10/10/2026, revisión de la tanda 1) el prompt manda «Dale, mandalo por acá.» textual: repetido
  // a quien avisa que va a pagar, no es algo que el bot no sepa
  it.each(['Ok, en un rato te lo mando', 'Dale, ya te lo mando', 'Ok, ahora te lo paso'])('«%s» y el modelo repite «Dale, mandalo por acá.»: no sale y no se abre una consulta falsa en pleno cobro', async (mensaje) => {
    const RESUMEN = '• Fernet Branca 750 cc — 1 × $20.500 c/u = $20.500\nTotal: $20.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: RESUMEN }, { role: 'user', content: 'Te transfiero' }, { role: 'assistant', content: 'Dale, mandalo por acá.' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s } = servicio(db, final('a', 'Dale, mandalo por acá.'));
    s.crearPedido = jest.fn().mockRejectedValue(new Error('no'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('lo repetido traía algo (la lista, una pregunta): «sumale 2 coca zero» y «Juan Pérez» se siguen consultando', async () => {
    const a = baseFalsa({ bot_conversaciones: { select: conv(CINCO) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sa = servicio(a, final('a', CINCO[1].content)).s;
    expect((await sa.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'sumale 2 coca zero' })).respuesta).toBeNull();
    expect(insertsDe(a, 'bot_consultas_internas')).toHaveLength(1);
    const b = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: 'quiero 2 fernet para retirar' }, { role: 'assistant', content: '¿A nombre de quién lo dejo?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sb = servicio(b, final('a', '¿A nombre de quién lo dejo?')).s;
    expect((await sb.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Juan Pérez' })).respuesta).toBeNull();
    expect(insertsDe(b, 'bot_consultas_internas')).toHaveLength(1);
  });

  // (10/10/2026, revisión de la tanda 1) antes salía «Disculpá, no pude procesar…»; con la tanda 1
  // quedaba en silencio y con el bot pausado
  it('derivar_a_humano y el modelo no escribe nada: sale la frase fija de la derivación, sin consulta', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const { s } = servicio(db, conHerramientas(pensar('a'), herramienta('d1', 'derivar_a_humano', { motivo: 'Presupuesto para un casamiento de 200 personas' })), vacia('b'), vacia('c'), vacia('d'));
    s.derivarAHumano = jest.fn(async () => ({ derivada: true }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Necesito presupuesto para un casamiento de 200 personas, que me llame alguien' });
    expect(r.respuesta).toBe(TEXTO.PASA_A_UNA_PERSONA);
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  it('la derivación interna de la red de respaldo (no se pudo registrar la consulta) sigue sin anunciarse', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(CINCO) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const vacia = (firma: string) => ({ stop_reason: 'end_turn', content: [pensar(firma)], usage });
    const { s } = servicio(db, vacia('a'), vacia('b'));
    s.consultarInterno = jest.fn().mockRejectedValue(new Error('base caída'));
    s.derivarAHumano = jest.fn(async () => ({ derivada: true }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿El Absolut es el de 750 o el de litro?' });
    expect(s.derivarAHumano).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toBeNull();
  });
});

// (10/10/2026, revisión de la tanda 1) la disputa de precio pedía «el total nuevo en dos líneas» y
// «en una línea»: chocaba con el paso 1b del prompt (nunca un total sin su lista)
describe('disputa de precio: las notas no piden achicar', () => {
  const LISTA_AGUA = '• Agua Glaciar 500 cc — 18 × $1.950 c/u = $35.100\nTotal: $35.100\n¿Lo retirás o te lo enviamos?';
  it('primera vez: pide volver a cotizar y la lista completa con «Total:», sin «dos líneas»', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: '18 aguas' }, { role: 'assistant', content: LISTA_AGUA }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s, llamadas } = servicio(db, final('a', 'Está correcto, corresponde al pack de 6.'), final('b', LISTA_AGUA));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Está mal la cuenta, son 18 botellas' });
    const nota = JSON.stringify(llamadas.filter((p) => p.model === 'claude-opus-5-5')[1].messages.at(-1).content);
    expect(nota).toMatch(/la lista completa con precios y «Total:»/);
    expect(nota).not.toMatch(/dos l[ií]neas|una l[ií]nea/);
  });

  it('segunda vez: «Contestá solo lo demás que haya preguntado», sin «en una línea»', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'user', content: '18 aguas' }, { role: 'assistant', content: LISTA_AGUA }, { role: 'user', content: 'Está mal la cuenta' }, { role: 'assistant', content: 'Está correcto, es el precio por unidad.' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s, llamadas } = servicio(db, final('a', 'Está correcto, corresponde al pack de 6.'), final('b', ''));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Está mal la cuenta, son 18 botellas' });
    const nota = JSON.stringify(llamadas.filter((p) => p.model === 'claude-opus-5-5')[1].messages.at(-1).content);
    expect(nota).toMatch(/Contestá solo lo demás que haya preguntado/);
    expect(nota).not.toMatch(/una l[ií]nea/);
  });
});

// (10/10/2026, revisión de la tanda 1) «otro teléfono» cortaba por oraciones a través de los
// renglones: la oración con el número arrastraba la lista entera de arriba
describe('otro teléfono: se va solo el renglón o la oración que lo trae', () => {
  it('la lista con «Recibe Ana (11 5555-1234)…» abajo: la lista queda en renglones, con su pregunta', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const lista = 'Te anoto:\n• 2 × Fernet Branca 750 cc\n• 6 × Coca Cola 1,75 L\n• 1 × Hielo 2 kg';
    const { s } = servicio(db, final('a', `${lista}\nRecibe Ana (11 5555-1234) en Mitre 1234.\n¿Está completo el pedido o querés sumar algo?`));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Mandame 2 fernet, 6 coca 1,75 y 1 hielo. Recibe Ana, 11 5555-1234, Mitre 1234' });
    expect(r.respuesta).toBe(`${lista}\n¿Está completo el pedido o querés sumar algo?`);
  });

  it('un renglón «• Consultas: 11 2521-3601» se va solo; una oración suelta con un número ajeno se saca y se consulta en silencio', async () => {
    const a = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sa = servicio(a, final('a', 'Abrimos de 10 a 21:\n• Saint Thomas\n• Consultas: 11 2521-3601\n¿Querés retirar hoy?')).s;
    expect((await sa.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hasta qué hora abren?' })).respuesta).toBe('Abrimos de 10 a 21:\n• Saint Thomas\n¿Querés retirar hoy?');
    const b = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const sb = servicio(b, final('a', 'Para eso escribí al 11 2521-3601. ¿Algo más?')).s;
    expect((await sb.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hacen eventos?' })).respuesta).toBe('¿Algo más?');
    expect(insertsDe(b, 'bot_consultas_internas')).toHaveLength(1);
  });
});

describe('C9: el mínimo del envío es un dato de la casa (10/10/2026)', () => {
  it('«El envío es sin cargo en pedidos desde $70.000» sale tal cual y no abre una consulta falsa', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s } = servicio(db, final('a', 'Sí, el envío es sin cargo en pedidos desde $70.000.'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Siempre es sin cargo el envío?' });
    expect(r.respuesta).toBe('Sí, el envío es sin cargo en pedidos desde $70.000.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
  });

  // (10/10/2026, revisión de la tanda 1) el $70.000 valía en toda la respuesta: un precio inventado
  // de justo ese número salía tal cual. Vale solo en la oración del envío o del mínimo
  it('un precio inventado de $70.000 no pasa: se corrige con el de la herramienta', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const { s, llamadas } = servicio(db,
      conHerramientas(pensar('a'), herramienta('b1', 'buscar_productos', { q: 'fernet litro' })),
      final('b', 'El Fernet Branca 1 L sale $70.000.'),
      final('c', 'El Fernet Branca 1 L sale $26.900.'),
    );
    s.buscarProductos = jest.fn(async () => ({ items: [{ sku: 'F1L', nombre: 'Fernet Branca 1 L', precio: 26900, disponible: true }] }));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Cuánto sale el fernet de litro?' });
    expect(r.respuesta).toBe('El Fernet Branca 1 L sale $26.900.');
    expect(llamadas.filter((p) => p.model === 'claude-opus-5-5')).toHaveLength(3);
  });

  it('un «Total: $70.000» inventado no sale; el envío desde $70.000 en la misma respuesta sí', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv([{ role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }]) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
    const escrito = 'Fernet Branca 750 cc a $20.500.\nTotal: $70.000\nEl envío es sin cargo en pedidos desde $70.000.';
    const { s } = servicio(db,
      conHerramientas(pensar('a'), herramienta('b1', 'buscar_productos', { q: 'fernet' })),
      final('b', escrito),
      final('c', escrito),
    );
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Cuánto sale el fernet?' });
    expect(r.respuesta).not.toMatch(/Total: \$70\.000/);
    expect(r.respuesta).toContain('Fernet Branca 750 cc a $20.500.');
    expect(r.respuesta).toContain('El envío es sin cargo en pedidos desde $70.000.');
  });
});


describe('un solo saludo por charla (Leandro, 10/10/2026: «tres veces me dijo buenas, buen día»)', () => {
  it('si el bot ya habló, el saludo del arranque se va; en el primer mensaje queda', async () => {
    const yaHablo = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Buen día. ¿Qué necesitás?' }];
    for (const [modelo, esperado] of [
      ['Buenas. De estos productos no tengo ahora la cantidad que pediste.', 'De estos productos no tengo ahora la cantidad que pediste.'],
      ['Buen día, Leandro.\n¿Está completo el pedido o querés sumar algo?', '¿Está completo el pedido o querés sumar algo?'],
      ['Hola Leandro! Sumo 2 aguas.', 'Sumo 2 aguas.'],
    ] as const) {
      const db = baseFalsa({ bot_conversaciones: { select: conv(yaHablo) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
      const { s } = servicio(db, final('a', modelo));
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'quiero 2 aguas' });
      expect(r.respuesta).toBe(esperado);
    }
    const db = baseFalsa({ bot_conversaciones: { select: conv([]) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db, final('a', 'Buen día. ¿Qué necesitás?'));
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'hola' });
    expect(r.respuesta).toMatch(/^Buen/);
  });
});

describe('un agradecimiento es un cierre (10/10/2026: «Muy amablees» → «no pude procesar su mensaje»)', () => {
  it('«Muy amablees», «Excelente, muchas gracias», «Sos un genio» después del pedido confirmado: silencio, sin modelo y sin consulta', async () => {
    const hist = [{ role: 'user', content: 'Confirmado' }, { role: 'assistant', content: 'Pedido DOM-EFB1F49E3E30 confirmado. Total: $105.600.\nEnvío sin cargo a Av Mariano Castex 1148. Se abona al recibir, en efectivo: $95.040.' }];
    for (const t of ['Muy amablees', 'Excelente, muchas gracias', 'Sos un genio', 'Muy amable!']) {
      const db = baseFalsa({ bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: CONSULTAS });
      const { s, create } = servicio(db, final('a', ''));
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, r.respuesta ?? null]).toEqual([t, null]);
      expect(create).not.toHaveBeenCalled();
      expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    }
  });
});
