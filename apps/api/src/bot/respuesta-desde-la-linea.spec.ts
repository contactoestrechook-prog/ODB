import { BotService } from './bot.service';

// La respuesta del área escrita desde el teléfono de la LÍNEA (24/10/2026). El
// 21/10 se vio que las consultas se contestaban ahí, en el chat de la línea con
// administración («Siii quedan» a la consulta de las entradas del Wine Fest), y
// que eso al bot le llegaba como un mensaje propio y se perdía. Las reglas puras
// están en respuesta-del-area.spec.ts; acá, el servicio entero.

const ADMIN = '5491125213601';
const LID_ADMIN = '69390347276368';
const AHORA = Date.now();
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

// una base falsa que filtra las filas de una tabla por eq / in / ilike / like (lo que usan estas consultas)
function baseFalsa(tablas: Record<string, any[]> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: [{ id: 'P1' }], error: null })),
    from(tabla: string) {
      let op = 'select';
      const filtros: ((f: any) => boolean)[] = [];
      const comoRegex = (patron: string, i: boolean) => new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, i ? 'i' : '');
      const b: any = {};
      for (const k of ['select', 'order', 'limit', 'range', 'is', 'gte', 'lte', 'not', 'or', 'filter']) b[k] = () => b;
      b.eq = (c: string, v: any) => { filtros.push((f) => String(f[c]) === String(v)); return b; };
      b.in = (c: string, vs: any[]) => { filtros.push((f) => vs.map(String).includes(String(f[c]))); return b; };
      b.ilike = (c: string, p: string) => { filtros.push((f) => comoRegex(p, true).test(String(f[c] ?? ''))); return b; };
      b.like = (c: string, p: string) => { filtros.push((f) => comoRegex(p, false).test(String(f[c] ?? ''))); return b; };
      b.update = (f: any) => { op = 'update'; escrituras.push({ tabla, op, fila: f }); return b; };
      b.insert = (f: any) => { op = 'insert'; escrituras.push({ tabla, op, fila: f }); return b; };
      b.upsert = (f: any) => { op = 'upsert'; escrituras.push({ tabla, op, fila: f }); return b; };
      const filas = () => (tablas[tabla] ?? []).filter((f) => filtros.every((ok) => ok(f)));
      b.maybeSingle = b.single = async () => ({ data: op === 'select' ? filas()[0] ?? null : null, error: null });
      b.then = (ok: any, err: any) => Promise.resolve({ data: op === 'select' ? filas() : null, error: null, count: 0 }).then(ok, err);
      return b;
    },
  };
  return db;
}

const CFG = { linea: 'pedidos', bot_activo: true, derivar_pagos_a: ADMIN, whatsapp_reparto: null, whatsapp_compras: null };

function armar(o: { consultas?: any[]; pagos?: any[]; tablas?: Record<string, any[]>; principal?: boolean } = {}) {
  const db = baseFalsa({
    bot_contactos: [{ telefono: LID_ADMIN, telefono_real: ADMIN }],
    bot_conversaciones: [],
    ...(o.tablas ?? {}),
  });
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.lineas = {
    principal: async () => 'pedidos',
    config: async () => CFG,
    esPrincipal: async (l: string) => (o.principal === false ? false : l === 'pedidos'),
    fila: async () => ({ numero_e164: '5491122812200' }),
    deEntrada: async () => ({ linea: 'pedidos' }),
  };
  s.pendientesPaginados = jest.fn(async (tabla: string) => (tabla === 'bot_pagos_en_confirmacion' ? o.pagos ?? [] : o.consultas ?? []));
  s.llevarRespuestaDeConsulta = jest.fn(async () => ({ contestado: true, motivo: 'respuesta del equipo enviada al cliente' }));
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'X' }));
  s.deLaLinea = jest.fn(async () => '');
  s.respondeRegistrar = jest.fn(async () => null);
  s.respondePausar = jest.fn(async () => null);
  s.limpiarEspera = jest.fn(async () => null);
  s.resolverContactoWaha = jest.fn(async () => null);
  s.remitenteDeLaCasa = jest.fn(async () => null);
  return { s, db };
}

// lo que llega cuando alguien escribe desde el teléfono de la línea en el chat con administración (sin id: no hay eco que buscar)
const desdeLaLinea = (body: string, extra: Record<string, any> = {}) => ({ fromMe: true, to: `${LID_ADMIN}@lid`, body, timestamp: Math.floor(Date.now() / 1000), ...extra });
const consulta = (id: string, min: number, extra: Record<string, any> = {}) => ({ id, linea: 'pedidos', telefono_cliente: '138444093268051', nombre: 'Cliente', enviado_a: ADMIN, waha_msg_id: `3EB0${id}`, creado_en: hace(min), ...extra });

describe('escrito desde el teléfono de la línea en el chat de administración', () => {
  it('citando la consulta: se le lleva al cliente y en ese chat queda «Listo: se lo pasé…»', async () => {
    const c = consulta('ENTRADAS', 90);
    const { s } = armar({ consultas: [c, consulta('OTRA', 5)] });
    const r = await s.mensajePropio(desdeLaLinea('Siii quedan', { replyTo: { id: `true_${LID_ADMIN}@lid_3EB0ENTRADAS` } }), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).toHaveBeenCalledWith(c, 'Siii quedan', ADMIN, true);
    expect(s.enviarPorWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ to: ADMIN, text: 'Listo: se lo pasé a Cliente.' }));
    // y sigue como siempre: queda anotado en ese chat
    expect(r.pausada).toBe(true);
  });

  it('sin citar, con UNA consulta de los últimos 30 min (21/10, «Siii quedan»): también le llega', async () => {
    const c = consulta('ENTRADAS', 1);
    const { s } = armar({ consultas: [c, consulta('VIEJA', 3 * 24 * 60)] });
    await s.mensajePropio(desdeLaLinea('Siii quedan'), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).toHaveBeenCalledWith(c, 'Siii quedan', ADMIN, true);
  });

  it('sin citar, un teléfono o un contacto que se pasa por ese chat NO le llega a ningún cliente', async () => {
    const { s } = armar({ consultas: [consulta('ENTRADAS', 1)] });
    await s.mensajePropio(desdeLaLinea('Suegra Jordi +54 9 11 6750-9996'), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
  });

  it('sin citar, un reenvío NO le llega a ningún cliente', async () => {
    const { s } = armar({ consultas: [consulta('ENTRADAS', 1)] });
    await s.mensajePropio(desdeLaLinea('1 smirnoff mango 1 smirnoff normal 3 vinos santa julia tinto', { _data: { isForwarded: true } }), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });

  it('sin citar, con dos consultas recientes: en ese chat pide citar', async () => {
    const { s } = armar({ consultas: [consulta('A', 2), consulta('B', 10)] });
    await s.mensajePropio(desdeLaLinea('Si hay'), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
    expect(s.enviarPorWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ to: ADMIN, text: 'Para que le llegue al cliente, respondé CITANDO la consulta: hay más de una abierta.' }));
  });

  it('sin citar, la consulta de hace una hora ya no cuenta: no se manda nada', async () => {
    const { s } = armar({ consultas: [consulta('A', 60)] });
    await s.mensajePropio(desdeLaLinea('Si hay'), '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
  });

  it('un pago sin citar no se confirma desde la línea, aunque sea el único', async () => {
    const { s, db } = armar({ pagos: [{ id: 'P1', linea: 'pedidos', telefono_cliente: '5491133344455', monto: 50000, waha_msg_id: '3EB0PAGO', creado_en: hace(2) }] });
    await s.mensajePropio(desdeLaLinea('Llegó'), '5491122812200', 'pedidos');
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
    expect(db.escrituras.some((e: any) => e.tabla === 'bot_pagos_en_confirmacion')).toBe(false);
  });

  it('citando el pago: se confirma como si lo contestara administración', async () => {
    const pago = { id: 'P1', linea: 'pedidos', telefono_cliente: '5491133344455', nombre: 'Andrea', monto: 50000, waha_msg_id: '3EB0PAGO', creado_en: hace(20) };
    const { s, db } = armar({ pagos: [pago] });
    await s.mensajePropio(desdeLaLinea('Llegó', { replyTo: { id: '3EB0PAGO' } }), '5491122812200', 'pedidos');
    expect(s.enviarPorWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ to: '5491133344455', referencia: 'pago-confirmado/P1' }));
    expect(db.escrituras.some((e: any) => e.tabla === 'bot_pagos_en_confirmacion' && e.fila.confirmado_en)).toBe(true);
  });

  it('en el chat de un cliente no cambia nada: solo se pausa la charla, como siempre', async () => {
    const { s } = armar({ consultas: [consulta('A', 1)] });
    const r = await s.mensajePropio({ fromMe: true, to: '5491133344455@c.us', body: 'Si hay', timestamp: Math.floor(Date.now() / 1000) }, '5491122812200', 'pedidos');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
    expect(r.pausada).toBe(true);
  });

  it('desde el teléfono de la otra línea (no la principal) no se toma: por ahí no salen las consultas', async () => {
    const { s } = armar({ consultas: [consulta('A', 1)], principal: false });
    await s.mensajePropio(desdeLaLinea('Siii quedan'), '5491126289957', 'local');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });

  it('lo que mandó el propio bot a ese chat (está en bot_envios) nunca se toma como respuesta', async () => {
    const { s } = armar({ consultas: [consulta('A', 1)], tablas: { bot_envios: [{ waha_id: '3EB0ECO', origen: 'aviso-interno' }] } });
    const r = await s.mensajePropio(desdeLaLinea('Para que le llegue al cliente, respondé CITANDO la consulta', { id: '3EB0ECO' }), '5491122812200', 'pedidos');
    expect(r.ignorado).toBe('lo mandamos nosotros');
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });
});

describe('desde el teléfono de administración', () => {
  it('sin citar, las pendientes de semanas atrás ya no traban: con una sola reciente, le llega a esa', async () => {
    const viejas = Array.from({ length: 159 }, (_, i) => consulta(`V${i}`, (49 + i) * 60));
    const nueva = consulta('NOEL', 25);
    const { s } = armar({ consultas: [...viejas, nueva] });
    await s.respuestaDeAdministracion(`${LID_ADMIN}@lid`, { body: 'Si perfecto, podemos tomarla para el sabado' });
    expect(s.llevarRespuestaDeConsulta).toHaveBeenCalledWith(nueva, 'Si perfecto, podemos tomarla para el sabado', ADMIN, true);
    // y no se le confirma nada a quien contestó desde su teléfono (como antes)
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
  });

  it('citando el «Dato nuevo» de una consulta: le llega al cliente de esa consulta', async () => {
    const c = consulta('PICADA', 50);
    const { s } = armar({
      consultas: [c, consulta('OTRA', 3)],
      tablas: { bot_envios: [{ waha_id: 'true_5491125213601@c.us_3EB0DATO', origen: 'consulta-dato:PICADA' }] },
    });
    await s.respuestaDeAdministracion(ADMIN, { body: 'La XL pican 6', replyTo: { id: '3EB0DATO' } });
    expect(s.llevarRespuestaDeConsulta).toHaveBeenCalledWith(c, 'La XL pican 6', ADMIN, true);
  });

  it('citando un aviso de pedido sigue siendo un acuse (no se confunde con un «Dato nuevo»)', async () => {
    const { s } = armar({
      consultas: [consulta('A', 3)],
      tablas: { bot_envios: [{ waha_id: '3EB0AVISO', origen: 'aviso-pedido' }] },
    });
    const r = await s.respuestaDeAdministracion(ADMIN, { body: 'ok', replyTo: { id: '3EB0AVISO' } });
    expect(r).toEqual({ contestado: false, motivo: 'acuse de un aviso de pedido' });
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });
});
