import { BotService } from './bot.service';
import { AvisosPedidosService } from '../avisos/avisos-pedidos.service';
import { textoDelAviso, textoDeSinCargar } from '../avisos/aviso-pedido';
import { etiquetaDeFila, Lineas, sesionPrincipal, tipoDeLinea } from '../comun/lineas';

// VARIAS LÍNEAS DE WHATSAPP CON EL MISMO BOT (Leandro, 6/10/2026): «necesitamos
// automatizar una nueva línea de ODB, mismo todo pero otra línea» y «comparte
// todo, está en otro lado de la sucursal». Dos números de clientes, el mismo
// bot y la misma configuración; solo cambian el número y la sesión de WAHA.
// Lo que se prueba:
//   1. lo que entra por la sesión de la línea B se contesta por la sesión B y
//      queda en la charla (B, teléfono);
//   2. el mismo cliente en A y en B son dos charlas;
//   3. los avisos internos salen por la principal y dicen de qué línea viene la charla;
//   4. los crons (barrido, vigilante, consultas) recorren las dos líneas;
//   5. con una sola línea cargada no cambia nada.

process.env.ANTHROPIC_API_KEY ??= 'test';

// ---------------------------------------------------------------------------
// Una base en memoria: filtra, ordena, inserta, actualiza y hace upsert como la
// de verdad (lo que hace falta para seguir una charla entera de punta a punta).
// ---------------------------------------------------------------------------
type Fila = Record<string, any>;
function valorDe(f: Fila, col: string): any {
  if (col.includes('->>')) {
    const [a, b] = col.split('->>');
    return f[a]?.[b];
  }
  return f[col];
}
function baseEnMemoria(inicial: Record<string, Fila[]> = {}, rpc: Record<string, (args: any) => any> = {}) {
  const tablas: Record<string, Fila[]> = {};
  for (const [k, v] of Object.entries(inicial)) tablas[k] = v.map((f) => ({ ...f }));
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  let secuencia = 0;
  const db: any = {
    tablas,
    escrituras,
    rpc: jest.fn(async (fn: string, args: any) => (rpc[fn] ? rpc[fn](args) : { data: null, error: null })),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://x/firmado' }, error: null }),
        getPublicUrl: (r: string) => ({ data: { publicUrl: `https://publico/${r}` } }),
      }),
    },
    from(tabla: string) {
      const filas = (tablas[tabla] ??= []);
      let op = 'select';
      let valor: any = null;
      let conflicto: string[] = [];
      let limite = Infinity;
      let desde = 0;
      let orden: { col: string; asc: boolean } | null = null;
      let cuenta = false;
      const filtros: ((f: Fila) => boolean)[] = [];
      let hecho: any = null;
      const cumple = (f: Fila) => filtros.every((fn) => fn(f));
      const ejecutar = () => {
        if (hecho) return hecho;
        if (op === 'insert') {
          const nuevas = (Array.isArray(valor) ? valor : [valor]).map((v: Fila) => ({ id: v.id ?? `${tabla}-${++secuencia}`, creado_en: new Date().toISOString(), ...v }));
          filas.push(...nuevas);
          escrituras.push({ tabla, op, fila: valor });
          return (hecho = { data: nuevas, error: null });
        }
        if (op === 'upsert') {
          const v: Fila = valor;
          const previa = conflicto.length ? filas.find((f) => conflicto.every((c) => String(f[c]) === String(v[c]))) : null;
          if (previa) Object.assign(previa, v);
          else filas.push({ ...v });
          escrituras.push({ tabla, op, fila: v });
          return (hecho = { data: [previa ?? v], error: null });
        }
        if (op === 'update') {
          const tocadas = filas.filter(cumple);
          for (const f of tocadas) Object.assign(f, valor);
          escrituras.push({ tabla, op, fila: valor });
          return (hecho = { data: tocadas, error: null });
        }
        if (op === 'delete') {
          const borrar = filas.filter(cumple);
          tablas[tabla] = filas.filter((f) => !borrar.includes(f));
          return (hecho = { data: borrar, error: null });
        }
        let r = filas.filter(cumple);
        if (orden) {
          const { col, asc } = orden;
          r = [...r].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        }
        r = r.slice(desde, limite === Infinity ? undefined : desde + limite);
        return (hecho = cuenta ? { data: null, count: r.length, error: null } : { data: r, error: null });
      };
      const b: any = {
        select: (_c?: string, o?: any) => { if (o?.count) cuenta = true; return b; },
        insert: (v: any) => { op = 'insert'; valor = v; return b; },
        upsert: (v: any, o?: any) => { op = 'upsert'; valor = v; conflicto = String(o?.onConflict ?? '').split(',').filter(Boolean); return b; },
        update: (v: any) => { op = 'update'; valor = v; return b; },
        delete: () => { op = 'delete'; return b; },
        eq: (c: string, v: any) => { filtros.push((f) => valorDe(f, c) !== undefined && String(valorDe(f, c)) === String(v)); return b; },
        filter: (c: string, o: string, v: any) => { if (o === 'eq') filtros.push((f) => String(valorDe(f, c)) === String(v)); return b; },
        in: (c: string, vs: any[]) => { filtros.push((f) => vs.map(String).includes(String(valorDe(f, c)))); return b; },
        is: (c: string, v: any) => { filtros.push((f) => (valorDe(f, c) ?? null) === v); return b; },
        not: (c: string, o: string, v: any) => { if (o === 'is') filtros.push((f) => (valorDe(f, c) ?? null) !== v); return b; },
        gte: (c: string, v: any) => { filtros.push((f) => String(valorDe(f, c) ?? '') >= String(v)); return b; },
        lte: (c: string, v: any) => { filtros.push((f) => String(valorDe(f, c) ?? '') <= String(v)); return b; },
        like: (c: string, v: string) => { const re = new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); filtros.push((f) => re.test(String(valorDe(f, c) ?? ''))); return b; },
        ilike: (c: string, v: string) => { const re = new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i'); filtros.push((f) => re.test(String(valorDe(f, c) ?? ''))); return b; },
        contains: (c: string, vs: any[]) => { filtros.push((f) => Array.isArray(f[c]) && vs.every((x) => f[c].includes(x))); return b; },
        or: () => b,
        order: (c: string, o?: any) => { orden = { col: c, asc: o?.ascending !== false }; return b; },
        limit: (n: number) => { limite = n; return b; },
        range: (a: number, z: number) => { desde = a; limite = z - a + 1; return b; },
        maybeSingle: async () => { const r = ejecutar(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; },
        single: async () => { const r = ejecutar(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; },
        then: (ok: any, err: any) => Promise.resolve().then(ejecutar).then(ok, err),
      };
      return b;
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Las dos líneas: la general (la de siempre, sesión de WAHA_SESSION) y la local
// (otro sector de Saint Thomas), que comparte TODA la configuración.
// ---------------------------------------------------------------------------
const ADMIN = '5491125213601';
const GENERAL = {
  id: 'l1', linea: 'pedidos', tipo: 'pedidos', nombre: 'Línea general', numero_legible: '11 2281-2200', numero_e164: '5491122812200',
  waha_sesion: null, activa: true, bot_activo: true, comparte_config_de: null,
  notas: 'ODB WINE FEST 30/10 20hs, entrada $65.000 con copón.', derivar_pagos_a: ADMIN, avisar_proveedores_a: 'jaqui',
  whatsapp_reparto: null, whatsapp_compras: null, alias_pago: 'odb.saint.thomas', titular_pago: 'ODB SRL', banco_pago: 'Galicia', cbu_pago: null,
};
const LOCAL = {
  id: 'l2', linea: 'local', tipo: 'pedidos', nombre: 'Línea local', numero_legible: '11 5555-1234', numero_e164: '5491155551234',
  waha_sesion: 'odb-local', activa: true, bot_activo: true, comparte_config_de: 'pedidos',
  // la línea que comparte no tiene configuración propia (la migración lo exige)
  notas: null, derivar_pagos_a: null, avisar_proveedores_a: null, whatsapp_reparto: null, whatsapp_compras: null,
  alias_pago: null, titular_pago: null, banco_pago: null, cbu_pago: null,
};
const CLIENTE = '5491166667777';
const ahoraSeg = () => Math.floor(Date.now() / 1000);

const usage = { input_tokens: 1, output_tokens: 1 };
const texto = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage });
// el verificador de preguntas (Haiku) dice "todo atendido"; el modelo principal contesta lo que se le diga
const claudeQueDice = (respuesta: string) => jest.fn(async (p: any) => (p.model === 'claude-haiku-4-5'
  ? { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sin_responder":[]}' }], usage }
  : texto(respuesta)));

function servicio(db: any, respuesta = 'Sí, la entrada incluye el copón.') {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.claude = { messages: { create: claudeQueDice(respuesta) } };
  return s;
}

// WAHA simulado: guarda cada POST (con su sesión) y contesta lo que se configure
type Llamada = { url: string; metodo: string; cuerpo: any };
function wahaFalso(respuestas: Record<string, any> = {}) {
  const llamadas: Llamada[] = [];
  const fetchFalso = jest.fn(async (url: any, init?: any) => {
    const u = String(url);
    const cuerpo = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    llamadas.push({ url: u, metodo: init?.method ?? 'GET', cuerpo });
    const clave = Object.keys(respuestas).find((k) => u.includes(k));
    if (clave) {
      const r = typeof respuestas[clave] === 'function' ? respuestas[clave](u, cuerpo) : respuestas[clave];
      return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) } as any;
    }
    if (/\/api\/send(Text|Image|File|Voice)$/.test(u)) {
      return { ok: true, status: 201, json: async () => ({ id: `true_${cuerpo?.chatId}_${llamadas.length}` }) } as any;
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as any;
  });
  jest.spyOn(global, 'fetch' as any).mockImplementation(fetchFalso as any);
  const envios = () => llamadas.filter((l) => /\/api\/send(Text|Image|File|Voice)$/.test(l.url));
  return { llamadas, envios };
}

const ENV = ['WAHA_URL', 'WAHA_API_KEY', 'WAHA_SESSION', 'WAHA_NUMERO_LINEA', 'RESPONDE_URL', 'ODB_BOT_PAUSA_ESCRITURA_MS'];
let envAntes: Record<string, string | undefined> = {};
beforeEach(() => {
  envAntes = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.WAHA_URL = 'https://waha.test';
  process.env.WAHA_API_KEY = 'clave-de-prueba';
  process.env.WAHA_SESSION = 'odb';
  delete process.env.WAHA_NUMERO_LINEA;
  delete process.env.RESPONDE_URL;
  delete process.env.ODB_BOT_PAUSA_ESCRITURA_MS;
});
afterEach(() => {
  for (const k of ENV) { if (envAntes[k] === undefined) delete process.env[k]; else process.env[k] = envAntes[k]; }
  jest.restoreAllMocks();
});

const mensajeDe = (sesion: string | null, de: string, cuerpo: string, id: string, me?: string) => ({
  event: 'message',
  ...(sesion ? { session: sesion } : {}),
  ...(me ? { me: { id: `${me}@c.us` } } : {}),
  payload: { id, from: `${de}@c.us`, body: cuerpo, timestamp: ahoraSeg() },
});

// ===========================================================================
describe('Lineas: qué línea es, qué hace y qué configuración usa', () => {
  it('la sesión de WAHA del evento decide la línea; después el número propio; después la principal', async () => {
    const l = new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    expect(await l.deEntrada({ sesion: 'odb-local' })).toEqual({ linea: 'local', por: 'sesión' });
    expect((await l.deEntrada({ sesion: 'odb' })).linea).toBe('pedidos');
    // el webhook de la sesión nueva copiado de la vieja trae ?linea= de la principal: manda la sesión
    expect((await l.deEntrada({ sesion: 'odb-local', numero: '5491122812200' })).linea).toBe('local');
    expect((await l.deEntrada({ me: '5491155551234@c.us' })).linea).toBe('local');
    expect((await l.deEntrada({ numero: '5491155551234' })).linea).toBe('local');
    expect((await l.deEntrada({})).linea).toBe('pedidos');
    // una sesión que no es de ninguna línea no se atiende (nunca se contesta por otro número)
    expect((await l.deEntrada({ sesion: 'otra-cosa' })).linea).toBeNull();
  });

  it('el tipo sale de la fila, no del nombre; sin fila, de los dos nombres de siempre', async () => {
    const l = new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    expect(await l.tipo('local')).toBe('pedidos');
    expect(await l.tipo('pedidos')).toBe('pedidos');
    expect(await l.tipo('proveedores')).toBe('proveedores');
    expect(tipoDeLinea('proveedores', { tipo: null })).toBe('proveedores');
    expect(await l.existe('local')).toBe(true);
    expect(await l.existe('proveedores')).toBe(true);
    expect(await l.existe('inventada')).toBe(false);
    expect(await l.existe('Pedidos ')).toBe(false);
  });

  it('la sesión de cada línea: la suya, y la principal sin sesión propia usa WAHA_SESSION', async () => {
    const l = new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    expect(await l.sesion('local')).toBe('odb-local');
    expect(await l.sesion('pedidos')).toBe('odb');
    expect(await l.sesion('proveedores')).toBe('odb');
    expect(await l.sesion(undefined)).toBe('odb');
    expect(await l.principal()).toBe('pedidos');
  });

  it('«comparte todo» sigue la cadena: una tercera línea que copia de la local usa lo de la general', async () => {
    const TERCERA = { ...LOCAL, id: 'l3', linea: 'deposito', nombre: 'Depósito', numero_e164: '5491144443333', waha_sesion: 'odb-deposito', comparte_config_de: 'local' };
    const cfg = await new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL, TERCERA] })).config('deposito');
    expect(cfg).toMatchObject({ linea: 'deposito', alias_pago: 'odb.saint.thomas', derivar_pagos_a: ADMIN });
  });

  it('«comparte todo»: la línea local usa alias, CBU, administración y notas de la general, con SU interruptor', async () => {
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, { ...LOCAL, bot_activo: false }] });
    const cfg = await new Lineas(db).config('local');
    expect(cfg).toMatchObject({
      linea: 'local', numero_e164: '5491155551234', bot_activo: false,
      alias_pago: 'odb.saint.thomas', titular_pago: 'ODB SRL', derivar_pagos_a: ADMIN, avisar_proveedores_a: 'jaqui',
      notas: expect.stringContaining('WINE FEST'),
    });
  });

  it('el rótulo de la línea: vacío con una sola línea de clientes; con dos, nombre y número', async () => {
    expect(await new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL] })).etiqueta('pedidos')).toBe('');
    const dos = new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    expect(await dos.etiqueta('local')).toBe('Línea local (11 5555-1234)');
    expect(await dos.etiqueta('pedidos')).toBe('Línea general (11 2281-2200)');
    expect(etiquetaDeFila('local', {})).toBe('Línea local');
    // una línea apagada (activa = false) no cuenta: vuelve a haber una sola
    expect(await new Lineas(baseEnMemoria({ lineas_whatsapp: [GENERAL, { ...LOCAL, activa: false }] })).etiqueta('pedidos')).toBe('');
  });
});

// ===========================================================================
describe('1 y 2. Cada mensaje se contesta por la línea por la que entró, en su propia charla', () => {
  it('lo que entra por la sesión B se contesta por la sesión B y queda en la charla (B, teléfono)', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] });
    const s = servicio(db);
    // el webhook de la sesión nueva trae ?linea= de la principal (copiado): igual manda la sesión
    const r: any = await s.webhookWaha(mensajeDe('odb-local', CLIENTE, '¿La entrada del wine fest incluye el copón?', 'false_A1', '5491155551234'), '5491122812200');
    expect(r.contestado).toBe(true);
    const envios = waha.envios();
    expect(envios).toHaveLength(1);
    expect(envios[0].cuerpo).toMatchObject({ session: 'odb-local', chatId: `${CLIENTE}@c.us` });
    expect(envios[0].cuerpo.text).toContain('copón');
    // la charla es la de la línea local; la general no se tocó
    const charlas = db.tablas.bot_conversaciones;
    expect(charlas).toHaveLength(1);
    expect(charlas[0]).toMatchObject({ linea: 'local', telefono: CLIENTE });
    // la idempotencia también es de la línea, y el entrante quedó anotado con su línea
    expect(db.tablas.bot_mensajes[0]).toMatchObject({ linea: 'local', mensaje_id: 'false_A1' });
    expect(db.tablas.bot_entrantes[0]).toMatchObject({ waha_id: 'false_A1', linea: 'local' });
    // la línea local usa las notas vigentes de la general (comparte todo)
    const llamada = s.claude.messages.create.mock.calls.find((c: any[]) => c[0].model !== 'claude-haiku-4-5');
    expect(JSON.stringify(llamada[0].system)).toContain('WINE FEST 30/10');
  });

  it('el mismo cliente en la línea A y en la B son dos charlas, cada una con su mensaje y su sesión', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] });
    const s = servicio(db);
    await s.webhookWaha(mensajeDe('odb', CLIENTE, '¿La entrada del wine fest incluye el copón?', 'false_G1'));
    await s.webhookWaha(mensajeDe('odb-local', CLIENTE, '¿Y la entrada para el sábado incluye el copón?', 'false_L1'));
    const charlas = db.tablas.bot_conversaciones;
    expect(charlas.map((c: any) => `${c.linea}/${c.telefono}`).sort()).toEqual([`local/${CLIENTE}`, `pedidos/${CLIENTE}`]);
    const general = charlas.find((c: any) => c.linea === 'pedidos');
    const local = charlas.find((c: any) => c.linea === 'local');
    expect(general.mensajes.map((m: any) => m.content).join(' ')).not.toContain('sábado');
    expect(local.mensajes.map((m: any) => m.content).join(' ')).toContain('sábado');
    expect(local.mensajes.map((m: any) => m.content).join(' ')).not.toContain('wine fest');
    expect(waha.envios().map((e) => e.cuerpo.session)).toEqual(['odb', 'odb-local']);
    // en la principal el entrante queda como siempre, sin línea (NULL = la principal)
    expect(db.tablas.bot_entrantes.find((e: any) => e.waha_id === 'false_G1')).not.toHaveProperty('linea');
  });

  it('una sesión que no es de ninguna línea no se atiende: ni charla ni respuesta, y queda UNA alerta', async () => {
    const waha = wahaFalso();
    // el teléfono nuevo vinculado antes de cargar su fila: solo está la línea de siempre
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL] });
    const s = servicio(db);
    const r: any = await s.webhookWaha(mensajeDe('odb-local', CLIENTE, 'hola', 'false_X1'));
    await s.webhookWaha(mensajeDe('odb-local', CLIENTE, '¿hay alguien?', 'false_X2'));
    expect(r.ignorado).toMatch(/desconocida/);
    expect(waha.envios()).toHaveLength(0);
    expect(db.tablas.bot_conversaciones ?? []).toHaveLength(0);
    expect(db.tablas.alertas_internas).toHaveLength(1);
    expect(db.tablas.alertas_internas[0]).toMatchObject({ tipo: 'whatsapp_caido', referencia: { sesion: 'odb-local', desconocida: true } });
  });

  it('una persona que escribe desde el teléfono de la línea B pausa la charla de B, no la de A', async () => {
    wahaFalso();
    const db = baseEnMemoria({
      lineas_whatsapp: [GENERAL, LOCAL],
      bot_conversaciones: [
        { linea: 'pedidos', telefono: CLIENTE, mensajes: [], bot_activo: true },
        { linea: 'local', telefono: CLIENTE, mensajes: [], bot_activo: true },
      ],
    });
    const s = servicio(db);
    s.mensajePropio = jest.fn(s.mensajePropio.bind(s));
    // el eco tarda 2,5 s en confirmarse: se saltea la espera
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any);
    const r: any = await s.webhookWaha({ event: 'message.any', session: 'odb-local', payload: { fromMe: true, id: 'true_X', to: `${CLIENTE}@c.us`, body: 'Hola, soy del sector de vinos', timestamp: ahoraSeg() } });
    expect(r.pausada).toBe(true);
    const [general, local] = ['pedidos', 'local'].map((l) => db.tablas.bot_conversaciones.find((c: any) => c.linea === l));
    expect(local.bot_activo).toBe(false);
    expect(general.bot_activo).toBe(true);
  });

  it('las reglas de pedidos valen en la línea nueva porque es de TIPO pedidos (no crear el pedido con un archivo)', async () => {
    const s = servicio(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 't', name: 'crear_pedido', input: {} }, CLIENTE, 'local', { textoCliente: 'sí', archivo: { base64: 'x', mime: 'image/jpeg' } });
    expect(String(r.content)).toMatch(/NO se creó el pedido: este mensaje trae un archivo/);
  });
});

// ===========================================================================
describe('3. Los avisos internos salen por la principal y dicen de qué línea es la charla', () => {
  it('la consulta a administración sale por la sesión principal y dice «WhatsApp: Línea local (…)»', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] });
    const s = servicio(db);
    const r = await s.consultarInterno('local', CLIENTE, 'administracion', '¿Tienen caja para viajar con 4 botellas?', '', undefined, 'la caja para viajar');
    expect(r.consultado).toBe(true);
    const aviso = waha.envios()[0];
    expect(aviso.cuerpo).toMatchObject({ session: 'odb', chatId: `${ADMIN}@c.us` });
    expect(aviso.cuerpo.text).toContain('WhatsApp: Línea local (11 5555-1234)');
    // la consulta y la campanita llevan la línea
    expect(db.tablas.bot_consultas_internas[0]).toMatchObject({ linea: 'local', telefono_cliente: CLIENTE, enviado_a: ADMIN });
    expect(db.tablas.alertas_internas[0].referencia).toMatchObject({ linea: 'local', lineaNombre: 'Línea local (11 5555-1234)' });
  });

  it('el pago: la línea local da el alias de la general, y el aviso de comprobante dice la línea', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] });
    const s = servicio(db);
    const alias: any = await s.derivarPago('local', CLIENTE, 'pide el alias', { tipo: 'quiere_pagar' });
    expect(alias.datosDePago).toContain('odb.saint.thomas');
    await s.derivarPago('local', CLIENTE, 'mandó el comprobante', { tipo: 'comprobante_enviado', monto: 50000, deQuien: 'Pablo' });
    const aviso = waha.envios()[0];
    expect(aviso.cuerpo.session).toBe('odb');
    expect(aviso.cuerpo.text).toContain('la charla está en la Línea local (11 5555-1234)');
    expect(db.tablas.bot_pagos_en_confirmacion[0]).toMatchObject({ linea: 'local', telefono_cliente: CLIENTE });
  });

  it('la respuesta del área vuelve al cliente por SU línea, aunque administración conteste en el chat de la principal', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({
      lineas_whatsapp: [GENERAL, LOCAL],
      bot_conversaciones: [{ linea: 'local', telefono: CLIENTE, mensajes: [{ role: 'assistant', content: 'Buenas tardes, te damos la bienvenida a O.D.B.' }], bot_activo: true }],
      bot_consultas_internas: [{
        id: 'c1', linea: 'local', telefono_cliente: CLIENTE, nombre: 'Pablo', area: 'administracion', consulta: '¿Tienen caja para viajar?',
        tema: 'la caja para viajar', waha_msg_id: `true_${ADMIN}@c.us_W1`, enviado_a: ADMIN, respondido_en: null, gestion_version: 2,
        creado_en: new Date(Date.now() - 5 * 60_000).toISOString(),
      }],
    }, { tomar_entrega_consulta_bot: () => ({ data: [{ id: 'c1', envio_iniciado_en: null }], error: null }) });
    const s = servicio(db);
    const r: any = await s.webhookWaha({ event: 'message', session: 'odb', payload: { id: 'false_R1', from: `${ADMIN}@c.us`, body: 'Sí, tenemos caja de cartón para 4 botellas.', replyTo: 'W1', timestamp: ahoraSeg() } });
    expect(r.contestado).toBe(true);
    const alCliente = waha.envios().find((e) => e.cuerpo.chatId === `${CLIENTE}@c.us`)!;
    expect(alCliente.cuerpo.session).toBe('odb-local');
    expect(alCliente.cuerpo.text).toMatch(/caja/);
    expect(db.tablas.bot_conversaciones.find((c: any) => c.linea === 'local').mensajes.at(-1).content).toMatch(/caja/);
  });

  it('el aviso de PEDIDO NUEVO del bot dice a qué línea escribió el cliente', async () => {
    const pedido = {
      id: '500e1312-aaaa-bbbb-cccc-000000000001', qr_retiro: 'PICKUP-AB12', canal: 'pickup', estado: 'recibido', total: 50000,
      creado_en: new Date().toISOString(), notas: null, destino_direccion: null, entrega_fecha: null, entrega_franja: null, pagado_en: null,
      cliente_id: null, origen: null, contacto_nombre: null, contacto_telefono: null, tomado_por: null,
      pedidos_items: [{ cantidad: 1, precio_unitario: 50000, productos: { nombre: 'Fernet Branca 750' } }],
    };
    const db = baseEnMemoria({
      lineas_whatsapp: [GENERAL, LOCAL],
      pedidos: [pedido],
      bot_cotizaciones: [{ id: 'q1', pedido_id: pedido.id, telefono: CLIENTE, confirmacion: 'sí', linea: 'local' }],
    });
    const avisos = new AvisosPedidosService(db);
    const p: any = await avisos.pedidoParaAviso(pedido.id);
    expect(p.lineaWhatsapp).toBe('Línea local (11 5555-1234)');
    expect(textoDelAviso(p, { conRenglones: false })).toContain('WhatsApp: Línea local (11 5555-1234)');
    expect(await avisos.telefonoAdministracion()).toBe(ADMIN);
    expect(textoDeSinCargar({ telefono: CLIENTE, telefonoReal: null, nota: 'x', resumen: null, lineaWhatsapp: 'Línea local (11 5555-1234)' })).toContain('WhatsApp: Línea local (11 5555-1234)');
  });
});

// ===========================================================================
describe('4. Los crons recorren las dos líneas', () => {
  it('el vigilante mira la sesión de cada línea y avisa la caída de la que está caída, con su nombre', async () => {
    const waha = wahaFalso({ '/api/sessions/odb-local': { status: 'FAILED' }, '/api/sessions/odb': { status: 'WORKING' } });
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] });
    const s = servicio(db);
    await s.vigilarSesionWhatsapp();
    await s.vigilarSesionWhatsapp();
    const leidas = waha.llamadas.filter((l) => /\/api\/sessions\/[^/]+$/.test(l.url)).map((l) => l.url.split('/').pop());
    expect(new Set(leidas)).toEqual(new Set(['odb', 'odb-local']));
    const reinicios = waha.llamadas.filter((l) => l.url.endsWith('/restart')).map((l) => l.url);
    expect(reinicios).toEqual(['https://waha.test/api/sessions/odb-local/restart']);
    const alertas = db.tablas.alertas_internas;
    expect(alertas).toHaveLength(1);
    expect(alertas[0].referencia).toMatchObject({ sesion: 'odb-local', linea: 'local' });
    expect(alertas[0].titulo).toContain('Línea local');
    // el panel ve el estado de cada sesión
    const lineas = await s.listarLineas();
    expect(lineas.find((l: any) => l.linea === 'local').whatsapp.estado).toBe('FAILED');
    expect(lineas.find((l: any) => l.linea === 'pedidos').whatsapp.estado).toBe('WORKING');
  });

  it('el barrido de entrantes perdidos recorre cada sesión y procesa lo de la línea B como de B', async () => {
    const chat = `${CLIENTE}@c.us`;
    const waha = wahaFalso({
      '/api/odb/chats?': [],
      '/api/odb-local/chats?': [{ id: chat, conversationTimestamp: ahoraSeg() }],
      [`/api/odb-local/chats/${encodeURIComponent(chat)}/messages`]: [{ id: 'false_P1', from: chat, body: 'hola, ¿siguen abiertos?', timestamp: ahoraSeg() - 120 }],
    });
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL], bot_entrantes: [{ waha_id: 'viejo', recibido_en: new Date(Date.now() - 3600_000).toISOString(), terminado_en: new Date().toISOString(), intentos: 1 }] });
    const s = servicio(db);
    const webhook = jest.spyOn(s, 'webhookWaha').mockResolvedValue({ contestado: true });
    await s.recuperarEntrantesPerdidos();
    const barridas = waha.llamadas.filter((l) => l.url.includes('/chats?')).map((l) => l.url.split('/api/')[1].split('/')[0]);
    expect(barridas).toEqual(['odb', 'odb-local']);
    expect(webhook).toHaveBeenCalledTimes(1);
    expect(webhook.mock.calls[0].slice(1)).toEqual(['5491155551234', 'barrido', 'local']);
  });

  it('el seguimiento de consultas usa el interruptor de la línea de cada una: la general apagada no frena a la local', async () => {
    const waha = wahaFalso();
    const consulta = (id: string, linea: string) => ({
      id, linea, telefono_cliente: CLIENTE, nombre: 'Pablo', area: 'administracion', consulta: '¿Hay caja?', tema: 'la caja',
      respuesta_admin: 'Sí, hay caja.', envio_iniciado_en: null, intentos: 0, proximo_intento_en: new Date(Date.now() - 60_000).toISOString(),
      ultimo_error: 'reintento', enviado_a: ADMIN, respondido_en: null, gestion_version: 2, aviso_recordatorio_en: new Date().toISOString(),
      creado_en: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    const db = baseEnMemoria({
      lineas_whatsapp: [{ ...GENERAL, bot_activo: false }, LOCAL],
      bot_conversaciones: [
        { linea: 'pedidos', telefono: CLIENTE, mensajes: [{ role: 'assistant', content: 'Hola' }], bot_activo: true },
        { linea: 'local', telefono: CLIENTE, mensajes: [{ role: 'assistant', content: 'Hola' }], bot_activo: true },
      ],
      bot_consultas_internas: [consulta('cg', 'pedidos'), consulta('cl', 'local')],
    }, { tomar_entrega_consulta_bot: (a: any) => ({ data: [{ id: a.p_id, envio_iniciado_en: null }], error: null }) });
    const s = servicio(db);
    await s.seguirConsultasPendientes();
    const envios = waha.envios();
    expect(envios).toHaveLength(1);
    expect(envios[0].cuerpo).toMatchObject({ session: 'odb-local', chatId: `${CLIENTE}@c.us` });
    expect(db.tablas.bot_consultas_internas.find((c: any) => c.id === 'cl').respondido_en).toBeTruthy();
    expect(db.tablas.bot_consultas_internas.find((c: any) => c.id === 'cg').respondido_en).toBeNull();
  });

  it('lo programado y las difusiones salen por la línea en que se cargaron', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({
      lineas_whatsapp: [GENERAL, LOCAL],
      mensajes_programados: [
        { id: 'm1', linea: 'local', telefono: CLIENTE, texto: 'Te recuerdo el retiro de hoy', enviar_en: new Date(Date.now() - 60_000).toISOString(), enviado_en: null, cancelado_en: null },
        { id: 'm2', linea: 'pedidos', telefono: '5491177778888', texto: 'Te recuerdo el retiro de mañana', enviar_en: new Date(Date.now() - 60_000).toISOString(), enviado_en: null, cancelado_en: null },
      ],
    });
    const s = servicio(db);
    await s.despacharProgramados();
    const porDestino = Object.fromEntries(waha.envios().map((e) => [e.cuerpo.chatId, e.cuerpo.session]));
    expect(porDestino).toEqual({ [`${CLIENTE}@c.us`]: 'odb-local', '5491177778888@c.us': 'odb' });
  });
});

// ===========================================================================
describe('el panel elige la línea, y una que no existe es un error', () => {
  it('lineaDelPanel: sin línea, la principal; una inventada, error (antes se volvía «pedidos» en silencio)', async () => {
    const s = servicio(baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL] }));
    expect(await s.lineaDelPanel(undefined)).toBe('pedidos');
    expect(await s.lineaDelPanel('local')).toBe('local');
    expect(await s.lineaDelPanel('proveedores')).toBe('proveedores');
    await expect(s.lineaDelPanel('inventada')).rejects.toThrow(/no existe/);
  });

  it('desde RESPONDE (un solo tenant) se contesta por la línea de la charla más reciente del contacto', async () => {
    const s = servicio(baseEnMemoria({
      lineas_whatsapp: [GENERAL, LOCAL],
      bot_conversaciones: [
        { linea: 'pedidos', telefono: CLIENTE, actualizado_en: '2026-10-06T10:00:00Z' },
        { linea: 'local', telefono: CLIENTE, actualizado_en: '2026-10-06T12:00:00Z' },
      ],
    }));
    expect(await s.lineaParaResponder(CLIENTE)).toBe('local');
    expect(await s.lineaParaResponder(`${CLIENTE}@c.us`)).toBe('local');
    expect(await s.lineaParaResponder(CLIENTE, 'pedidos')).toBe('pedidos');
    expect(await s.lineaParaResponder('5491100000000')).toBe('pedidos');
  });

  it('la respuesta escrita en el panel sale por la línea de la charla', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [GENERAL, LOCAL], bot_conversaciones: [{ linea: 'local', telefono: CLIENTE, mensajes: [] }] });
    const s = servicio(db);
    await s.responderComoHumano('local', CLIENTE, 'Hola Pablo, te lo dejo separado');
    expect(waha.envios()[0].cuerpo).toMatchObject({ session: 'odb-local', chatId: `${CLIENTE}@c.us` });
  });
});

// ===========================================================================
describe('5. Con UNA sola línea cargada no cambia nada', () => {
  // la base de hoy, ANTES de la migración: la fila no tiene tipo, ni sesión, ni nombre
  const HOY = {
    id: 'l1', linea: 'pedidos', numero_legible: '11 2281-2200', numero_e164: '5491122812200', activa: true, bot_activo: true,
    notas: null, derivar_pagos_a: ADMIN, avisar_proveedores_a: 'jaqui', whatsapp_reparto: null, whatsapp_compras: null,
    alias_pago: 'odb.saint.thomas', titular_pago: 'ODB SRL', banco_pago: null, cbu_pago: null,
  };

  it('todo es la línea de pedidos y la sesión de WAHA_SESSION, como antes', async () => {
    const l = new Lineas(baseEnMemoria({ lineas_whatsapp: [HOY] }));
    expect(await l.principal()).toBe('pedidos');
    expect(await l.tipo('pedidos')).toBe('pedidos');
    expect(await l.sesion('pedidos')).toBe('odb');
    expect(sesionPrincipal()).toBe('odb');
    // sin sesión en el evento (el barrido, n8n), la de siempre
    expect((await l.deEntrada({ numero: '5491122812200' })).linea).toBe('pedidos');
    expect((await l.deEntrada({})).linea).toBe('pedidos');
    // una sesión que no es WAHA_SESSION no se contesta por la principal (sería otro número)
    expect((await l.deEntrada({ sesion: 'odb-nueva-sin-cargar' })).linea).toBeNull();
    expect(await l.etiqueta('pedidos')).toBe('');
    delete process.env.WAHA_SESSION;
    expect(sesionPrincipal()).toBe('default');
  });

  it('el mensaje entra y sale por la sesión de siempre, a la charla de pedidos, y el alta no lleva línea', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [HOY] });
    const s = servicio(db);
    const r: any = await s.webhookWaha(mensajeDe('odb', CLIENTE, '¿La entrada del wine fest incluye el copón?', 'false_U1'), '5491122812200');
    expect(r.contestado).toBe(true);
    expect(waha.envios()[0].cuerpo).toMatchObject({ session: 'odb', chatId: `${CLIENTE}@c.us` });
    expect(db.tablas.bot_conversaciones[0]).toMatchObject({ linea: 'pedidos', telefono: CLIENTE });
    expect(db.tablas.bot_entrantes[0]).not.toHaveProperty('linea');
  });

  it('el aviso a administración es el de siempre: sin renglón de línea', async () => {
    const waha = wahaFalso();
    const db = baseEnMemoria({ lineas_whatsapp: [HOY] });
    const s = servicio(db);
    await s.consultarInterno('pedidos', CLIENTE, 'administracion', '¿Tienen caja para viajar?', '', undefined, 'la caja');
    const t: string = waha.envios()[0].cuerpo.text;
    expect(t.split('\n').slice(0, 3)).toEqual(['Consulta de un cliente (administracion)', `De: sin identificar · +${CLIENTE}`, '¿Tienen caja para viajar?']);
    expect(t).not.toContain('WhatsApp:');
    expect(db.tablas.alertas_internas[0].referencia).not.toHaveProperty('lineaNombre');
    await s.derivarPago('pedidos', CLIENTE, 'mandó el comprobante', { tipo: 'comprobante_enviado', monto: 50000, deQuien: 'Pablo' });
    expect(waha.envios()[1].cuerpo.text).toContain('(la charla está en la línea de pedidos)');
  });

  it('el vigilante y el barrido miran una sola sesión, la de siempre', async () => {
    const waha = wahaFalso({ '/api/sessions/odb': { status: 'WORKING' }, '/api/odb/chats?': [] });
    const db = baseEnMemoria({ lineas_whatsapp: [HOY], bot_entrantes: [{ waha_id: 'viejo', recibido_en: new Date(Date.now() - 3600_000).toISOString() }] });
    const s = servicio(db);
    await s.vigilarSesionWhatsapp();
    await s.recuperarEntrantesPerdidos();
    expect(waha.llamadas.map((l) => l.url)).toEqual(['https://waha.test/api/sessions/odb', 'https://waha.test/api/odb/chats?limit=30&sortBy=conversationTimestamp&sortOrder=desc']);
  });
});
