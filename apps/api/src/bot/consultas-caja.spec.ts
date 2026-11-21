import { BotService } from './bot.service';
import { ENVIADO_A_CAJA, ordenDeLaCaja, problemaDeLaRespuesta, resultadoParaLaCaja, rutaDeAdjunto } from './consultas-caja';

// LA PREGUNTA DE UN CLIENTE SUENA EN LA CAJA (21/11/2026). El caso: El Casco Viejo (línea
// local) pidió 300 g de roquefort; el bot le preguntó a administración por WhatsApp, nadie
// contestó, a los 30 minutos al cliente le llegó «Te paso con una persona del local» y el
// bot se apagó un segundo antes de que la clienta mandara la dirección. El pedido no entró.
// Leandro: «que no suene más en administración, que no avise más administración, que no se
// apague el bot y que siempre suene a caja, con sonido, con mucho sonido».

process.env.ANTHROPIC_API_KEY ??= 'test';

type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };
type Ctx = { filtros: any[]; fila?: any };

// base falsa: cada tabla contesta con una función (op, ctx); se anotan las escrituras
function baseFalsa(config: Record<string, (op: string, ctx: Ctx) => any> = {}) {
  const escrituras: Escritura[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    storage: { from: () => ({ createSignedUrl: jest.fn(async (ruta: string) => ({ data: { signedUrl: `https://firmado/${ruta}` }, error: null })) }) },
    from(tabla: string) {
      let op = 'select';
      const ctx: Ctx = { filtros: [] };
      const res = () => config[tabla]?.(op, ctx) ?? { data: null, error: null };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (k === 'select') return () => b;
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
const updatesDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'update');
const filtro = (ctx: Ctx, k: string, col: string) => ctx.filtros.find(([kk, c]) => kk === k && c === col);

const TEL = '7894183448629';
const ROQUEFORT = {
  id: 'ddf4636b', linea: 'local', telefono_cliente: TEL, nombre: null, area: 'administracion', tema: 'el roquefort',
  consulta: 'Cliente pide Roquefort 300 g aprox. El SKU L13828 Roquefort serrano Fermier figura como unidad de venta con precio $39.800: ¿ese precio es por kilo? ¿se puede fraccionar 300 g?',
  enviado_a: ENVIADO_A_CAJA, gestion_version: 2, respondido_en: null, respuesta_admin: null, creado_en: new Date(Date.now() - 31 * 60_000).toISOString(),
  archivo_url: null, insistio_en: null,
};

function servicio(db: any, cfg: any = { bot_activo: true }) {
  const pedidos = { sucursalPickup: jest.fn(async () => ({ id: 'suc-st-thomas' })) };
  const s: any = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  s.lineas = { config: jest.fn(async () => cfg), principal: jest.fn(async () => 'pedidos'), activas: jest.fn(async () => []), etiqueta: jest.fn(async () => 'Línea local (11 2628-9957)') };
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W' }));
  s.derivarAHumano = jest.fn(async () => null);
  s.bloqueadosEnResponde = jest.fn(async () => null);
  s.nombreDeContacto = jest.fn(async () => 'El Casco Viejo Chacra Caning');
  return s;
}

describe('las piezas sin base', () => {
  it('lo que la caja escribe tiene que poder llegarle al cliente tal cual', () => {
    expect(problemaDeLaRespuesta('')).toMatch(/Escribí la respuesta/);
    expect(problemaDeLaRespuesta('   ')).toMatch(/Escribí la respuesta/);
    expect(problemaDeLaRespuesta('x'.repeat(1001))).toMatch(/muy larga/);
    expect(problemaDeLaRespuesta('Decile al bot que sí')).toMatch(/sin notas internas/);
    expect(problemaDeLaRespuesta('Sí, el roquefort se fracciona: 300 g son $11.940.')).toBeNull();
  });

  it('la ruta del archivo sale del enlace firmado (que dura una hora), con el @ del lid', () => {
    expect(rutaDeAdjunto('https://utemm.supabase.co/storage/v1/object/sign/bot-adjuntos/whatsapp/7894183448629%40lid/1795112901746.jpeg?token=abc'))
      .toBe('whatsapp/7894183448629@lid/1795112901746.jpeg');
    expect(rutaDeAdjunto('https://x/foto.jpg')).toBeNull();
    expect(rutaDeAdjunto(null)).toBeNull();
  });

  it('cada resultado se le dice a la caja en palabras', () => {
    expect(resultadoParaLaCaja({ contestado: true }, 'Yanina')).toEqual({ ok: true, texto: 'Le llegó a Yanina.' });
    expect(resultadoParaLaCaja({ contestado: false, porque: 'la charla la atiende una persona (el bot está pausado)', motivo: 'respuesta guardada como nota; …' }, 'Yanina').texto)
      .toBe('No le llegó: la charla la atiende una persona (el bot está pausado). Quedó anotada en su charla: pasásela vos desde RESPONDE.');
    expect(resultadoParaLaCaja({ contestado: false, motivo: 'consulta ya entregada o en proceso' }, 'Y').texto).toBe('Ya la contestó otra persona.');
    expect(resultadoParaLaCaja({ contestado: false, motivo: 'envío pendiente' }, 'Y').texto).toMatch(/se reintenta sola/);
    expect(resultadoParaLaCaja({ contestado: false, motivo: 'envío incierto; requiere revisión' }, 'Y').texto).toMatch(/Mirá su charla antes/);
  });

  it('primero la del cliente que insiste; después la que más espera', () => {
    const a = { id: 'a', creado_en: '2026-11-21T14:00:00Z', insistio_en: null };
    const b = { id: 'b', creado_en: '2026-11-21T14:10:00Z', insistio_en: '2026-11-21T14:20:00Z' };
    const c = { id: 'c', creado_en: '2026-11-21T13:50:00Z', insistio_en: null };
    expect(ordenDeLaCaja([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('la consulta ya no apaga el bot ni le escribe a administración', () => {
  it('una consulta de hace 31 minutos sin contestar: el vigía no pasa a una persona, no avisa por WhatsApp ni la marca vencida', async () => {
    const db = baseFalsa({
      bot_consultas_internas: (op) => (op === 'select' ? { data: [{ ...ROQUEFORT, aviso_recordatorio_en: new Date().toISOString() }], error: null } : { data: [{ id: ROQUEFORT.id }], error: null }),
    });
    const s = servicio(db);
    await s.seguirConsultasPendientes();
    expect(s.derivarAHumano).not.toHaveBeenCalled();
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => 'vencida_en' in u.fila)).toBe(false);
    expect(db.escrituras.some((e: Escritura) => e.tabla === 'bot_conversaciones')).toBe(false);
  });
});

describe('la ventana de la caja', () => {
  it('lista solo las de la caja, sin contestar y de las últimas horas, con su charla, su archivo y la sucursal de los pedidos', async () => {
    let filtros: any[] = [];
    const db = baseFalsa({
      bot_consultas_internas: (op, ctx) => { filtros = ctx.filtros; return { data: [{ ...ROQUEFORT, archivo_url: 'https://u.supabase.co/storage/v1/object/sign/bot-adjuntos/whatsapp/7894183448629%40lid/1.jpeg?token=t' }], error: null }; },
      bot_conversaciones: () => ({ data: { bot_activo: true, mensajes: [{ role: 'user', content: 'Roquefort 300 grs aprox' }, { role: 'assistant', content: 'Anoté esto: …' }] }, error: null }),
    });
    const s = servicio(db);
    const r = await s.consultasParaLaCaja();
    expect(filtro({ filtros }, 'eq', 'enviado_a')?.[2]).toBe('caja');
    expect(filtro({ filtros }, 'is', 'respondido_en')?.[2]).toBeNull();
    expect(filtro({ filtros }, 'is', 'respuesta_admin')?.[2]).toBeNull();
    expect(filtro({ filtros }, 'gte', 'creado_en')).toBeTruthy();
    expect(r.sucursalId).toBe('suc-st-thomas');
    expect(r.consultas).toHaveLength(1);
    expect(r.consultas[0]).toMatchObject({
      id: ROQUEFORT.id, nombre: 'El Casco Viejo Chacra Caning', tema: 'el roquefort', botActivo: true,
      lineaTexto: 'WhatsApp: Línea local (11 2628-9957)',
      adjunto: 'https://firmado/whatsapp/7894183448629@lid/1.jpeg',
      charla: [{ de: 'cliente', texto: 'Roquefort 300 grs aprox' }, { de: 'bot', texto: 'Anoté esto: …' }],
    });
  });

  it('la de una persona bloqueada en RESPONDE no suena', async () => {
    const db = baseFalsa({ bot_consultas_internas: () => ({ data: [ROQUEFORT], error: null }) });
    const s = servicio(db);
    s.bloqueadosEnResponde = jest.fn(async () => new Set([TEL]));
    s.telefonoBloqueado = jest.fn(async () => true);
    expect((await s.consultasParaLaCaja()).consultas).toEqual([]);
  });

  it('contestar: la toma el primero y lo que escribió le llega al cliente por su línea, como respuesta final', async () => {
    let tomaFiltros: any[] = [];
    const db = baseFalsa({
      bot_consultas_internas: (op, ctx) => {
        if (op === 'select') return { data: ROQUEFORT, error: null };
        if (op === 'update' && 'respuesta_admin' in (ctx.fila ?? {})) { tomaFiltros = ctx.filtros; return { data: [{ id: ROQUEFORT.id }], error: null }; }
        return { data: null, error: null };
      },
    });
    const s = servicio(db);
    s.llevarRespuestaDeConsulta = jest.fn(async () => ({ contestado: true, motivo: 'respuesta del equipo enviada al cliente' }));
    const r = await s.responderConsultaDesdeLaCaja(ROQUEFORT.id, 'Sí, se fracciona: 300 g son $11.940.', 'usuario-caja');
    expect(r).toEqual({ ok: true, texto: 'Le llegó a El Casco Viejo Chacra Caning.' });
    expect(filtro({ filtros: tomaFiltros }, 'is', 'respuesta_admin')?.[2]).toBeNull();
    expect(filtro({ filtros: tomaFiltros }, 'is', 'respondido_en')?.[2]).toBeNull();
    const [c, texto, admin, botActivo] = s.llevarRespuestaDeConsulta.mock.calls[0];
    expect(c.id).toBe(ROQUEFORT.id);
    expect(texto).toBe('Sí, se fracciona: 300 g son $11.940.');
    expect(admin).toBe('');
    expect(botActivo).toBe(true);
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => u.fila.respondida_por === 'usuario-caja')).toBe(true);
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
  });

  it('si otra caja ya la contestó, no se manda otra respuesta', async () => {
    const db = baseFalsa({
      bot_consultas_internas: (op) => (op === 'select' ? { data: ROQUEFORT, error: null } : { data: [], error: null }),
    });
    const s = servicio(db);
    s.llevarRespuestaDeConsulta = jest.fn();
    expect(await s.responderConsultaDesdeLaCaja(ROQUEFORT.id, 'Sí.', 'u')).toEqual({ ok: false, texto: 'Ya la contestó otra persona.' });
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });

  it('una respuesta vacía o con notas internas no se manda ni toma la pregunta', async () => {
    const db = baseFalsa({ bot_consultas_internas: () => ({ data: ROQUEFORT, error: null }) });
    const s = servicio(db);
    await expect(s.responderConsultaDesdeLaCaja(ROQUEFORT.id, '  ', 'u')).rejects.toThrow(/Escribí la respuesta/);
    await expect(s.responderConsultaDesdeLaCaja(ROQUEFORT.id, 'nota interna: no hay', 'u')).rejects.toThrow(/sin notas internas/);
    expect(db.escrituras).toHaveLength(0);
  });

  it('con la charla en manos de una persona, la respuesta queda anotada y la caja lo sabe (sin WhatsApp a nadie de la casa)', async () => {
    const db = baseFalsa({
      bot_consultas_internas: (op) => (op === 'select' ? { data: ROQUEFORT, error: null } : { data: [{ id: ROQUEFORT.id }], error: null }),
      bot_conversaciones: () => ({ data: { bot_activo: false, mensajes: [] }, error: null }),
    });
    const s = servicio(db);
    const r = await s.responderConsultaDesdeLaCaja(ROQUEFORT.id, 'Sí, se fracciona.', 'u');
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/^No le llegó: la charla la atiende una persona.*Quedó anotada en su charla/);
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
    expect(db.escrituras.some((e: Escritura) => e.tabla === 'bot_notas_equipo' && /Sí, se fracciona/.test(e.fila.nota))).toBe(true);
  });

  it('«Ya no hace falta»: se cierra sin mandarle nada al cliente y sale de la campanita', async () => {
    const db = baseFalsa({ bot_consultas_internas: () => ({ data: [{ id: ROQUEFORT.id }], error: null }) });
    const s = servicio(db);
    const r = await s.cerrarConsultaDesdeLaCaja(ROQUEFORT.id, 'u');
    expect(r.ok).toBe(true);
    const cierre = updatesDe(db, 'bot_consultas_internas')[0];
    expect(cierre.fila.respondido_en).toBeTruthy();
    expect(filtro(cierre, 'is', 'respuesta_admin')?.[2]).toBeNull();
    expect(updatesDe(db, 'alertas_internas')[0].fila).toMatchObject({ leida_por: 'u' });
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
  });

  it('cerrar una que ya se contestó no hace nada', async () => {
    const db = baseFalsa({ bot_consultas_internas: () => ({ data: [], error: null }) });
    const s = servicio(db);
    expect(await s.cerrarConsultaDesdeLaCaja(ROQUEFORT.id, 'u')).toEqual({ ok: false, texto: 'Ya la contestó o la cerró otra persona.' });
    expect(updatesDe(db, 'alertas_internas')).toHaveLength(0);
  });
});
