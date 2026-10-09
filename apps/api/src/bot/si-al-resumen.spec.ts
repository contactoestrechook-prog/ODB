// El «sí» al «¿Lo confirmo?» confirma si nada cambió (Leandro, 9/10/2026, noche),
// con su charla de las 22:43: escribió «Hola» y el bot le retomó el pedido de la
// tarde, sin confirmar y con el precio de entonces, otra vez con «¿Lo confirmo?».
// Y un «sí» a eso tampoco confirmaba: la base le da 30 minutos a la cotización.
import { BotService } from './bot.service';

process.env.ANTHROPIC_API_KEY ??= 'test';

function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return !(col in fila) || String(fila[col]) === String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return !(col in fila) || String(fila[col]) >= String(val);
    if (k === 'in') return !(col in fila) || (val as any[]).map(String).includes(String(fila[col]));
    return true;
  });
}

// base falsa: las tablas con `filas` filtran, ordenan y devuelven una fila en maybeSingle
function baseFalsa(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    // como la base: el modo 'si' rechaza la cotización vencida (vence_en) y el 'dato', la de más de 10 min
    rpc: jest.fn(async (nombre: string, a: any) => {
      if (nombre !== 'confirmar_cotizacion_bot') return { data: null, error: null };
      const q = (config.bot_cotizaciones?.filas ?? []).find((f: any) => f.id === a.p_id);
      if (!q) return { data: null, error: { message: 'Cotizacion no encontrada para este chat' } };
      if (a.p_modo === 'dato' && Date.now() - new Date(q.creada_en).getTime() >= 10 * 60_000) return { data: null, error: { message: 'El dato no confirma el pedido' } };
      if (!a.p_modo && new Date(q.vence_en).getTime() < Date.now()) return { data: null, error: { message: 'La cotizacion vencio: volver a cotizar' } };
      return { data: 'pedido-1', error: null };
    }),
    from(tabla: string) {
      let op = 'select';
      const filtros: any[] = [];
      let orden: [string, boolean] | null = null;
      const lista = () => {
        const c = config[tabla];
        if (!c?.filas) return null;
        const fs = (c.filas as any[]).filter((f) => cumple(f, filtros));
        if (orden) { const [col, asc] = orden; fs.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1)); }
        return fs;
      };
      const uno = () => {
        if (op !== 'select') return { data: null, error: null };
        const fs = lista();
        return fs ? { data: fs[0] ?? null, error: null } : (config[tabla]?.select ?? { data: null, error: null });
      };
      const todos = () => {
        if (op === 'update' && config[tabla]?.filas) {
          const fila = escrituras.filter((e) => e.tabla === tabla && e.op === 'update').slice(-1)[0]?.fila ?? {};
          const fs = (config[tabla].filas as any[]).filter((f) => cumple(f, filtros));
          for (const f of fs) Object.assign(f, fila);
          return { data: fs.map((f) => ({ id: f.id })), error: null };
        }
        if (op !== 'select') return { data: null, error: null };
        const fs = lista();
        return fs ? { data: fs, error: null } : (config[tabla]?.select ?? { data: null, error: null });
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(todos()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => uno();
          if (k === 'order') return (col: string, o?: { ascending?: boolean }) => { orden = [col, o?.ascending !== false]; return b; };
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op: String(k), fila }); return b; };
          return (...args: any[]) => { filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '104570256634038';
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const renglones = [
  { sku: 'C1', nombre: 'Coca Cola Zero x1.75L', cantidad: 6, renglon: '6 × $4.700 c/u = $28.200' },
  { sku: 'CH', nombre: 'Chandon Extra Brut', cantidad: 2, renglon: '2 × $22.700 c/u = $45.400' },
  { sku: 'PP', nombre: 'Patitas de Pollo Granja del Sol x 400 gr', cantidad: 1, renglon: '1 × $10.800 c/u = $10.800' },
  { sku: 'AZ', nombre: 'Azucar Ledesma Comun x 1 kg', cantidad: 1, renglon: '1 × $2.300 c/u = $2.300' },
  { sku: 'KO', nombre: 'KO agua x 1L', cantidad: 4, renglon: '4 × $2.000 c/u = $8.000' },
  { sku: 'AB', nombre: 'Absolut', cantidad: 1, renglon: '1 × $33.500 c/u = $33.500' },
];
const RESUMEN = `${renglones.map((r) => `• ${r.nombre} — ${r.renglon}`).join('\n')}\nTotal: $128.200\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?`;
// la cotización de las 17:03: venció a las 17:33 (la base le da 30 minutos)
const VIEJA = { id: 'cot-vieja', telefono: TEL, linea: 'pedidos', creada_en: hace(340), vence_en: hace(310), confirmada_en: null, pedido_id: null, total: 128200, tipo: 'pickup', nombre: 'Leandro', direccion: null, notas: null, entrega_fecha: null, entrega_franja: null, resumen: RESUMEN, items: renglones };
// el mensaje 24 de la charla, tal cual
const M24 = 'Tu pedido a nombre de Leandro para retirar en la sucursal Saint Thomas está listo: son $128.200, o $120.310 en efectivo o transferencia. ¿Lo confirmo?';
const HIST = [
  { role: 'user', content: 'A nombre de leandro' },
  { role: 'assistant', content: RESUMEN },
  { role: 'assistant', content: '📷 Foto enviada: Lean viste este Mail de PedidosYa' },
  { role: 'user', content: '🎙️ Lo vi, lo vi.' },
  { role: 'assistant', content: 'sii x yo las dudas' },
  { role: 'user', content: '📷 Foto del cliente' },
  { role: 'assistant', content: 'ok' },
  { role: 'user', content: 'Hola' },
  { role: 'assistant', content: M24 },
];

function armar(o: { cotizaciones?: any[]; totalNuevo?: number; hist?: any[]; actualizado?: string; renglonesNuevos?: any[]; tablas?: Record<string, any> } = {}) {
  // copias: la toma atómica marca la fila (recotizada_en) y no tiene que pasar a la prueba siguiente
  const filas = (o.cotizaciones ?? [VIEJA]).map((f) => ({ ...f }));
  const db = baseFalsa({
    bot_cotizaciones: { filas },
    bot_conversaciones: { select: { data: { mensajes: o.hist ?? HIST, bot_activo: true, actualizado_en: o.actualizado ?? hace(1), importes_verificados: [] }, error: null } },
    lineas_whatsapp: { select: { data: { derivar_pagos_a: null, avisar_proveedores_a: null, bot_activo: true }, error: null } },
    ...(o.tablas ?? {}),
  });
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-E9D52964B0BA', total: 128200, estado: 'recibido' })) };
  const s: any = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W-1' }));
  s.respondeRegistrar = jest.fn(async () => null);
  // recotizar: los mismos productos; el total, el de hoy
  const preparar = jest.spyOn(s, 'prepararPedido').mockImplementation(async () => {
    const total = o.totalNuevo ?? 128200;
    const resumen = RESUMEN.replace('$128.200', `$${total.toLocaleString('es-AR')}`);
    filas.push({ ...VIEJA, id: 'cot-nueva', creada_en: new Date().toISOString(), vence_en: new Date(Date.now() + 30 * 60_000).toISOString(), total, resumen });
    return { cotizacionId: 'cot-nueva', total, resumen, renglones: o.renglonesNuevos ?? renglones };
  });
  const create = jest.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'NO DEBERÍA LLAMARSE AL MODELO' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  s.claude = { messages: { create } };
  return { s, db, preparar, create };
}
const confirmaciones = (db: any) => db.rpc.mock.calls.filter((c: any[]) => c[0] === 'confirmar_cotizacion_bot').map((c: any[]) => c[1]);

describe('crearPedido: el «sí» al «¿Lo confirmo?» confirma si nada cambió', () => {
  it('22:43 «Sí» al mensaje 24, con la cotización vencida: se recotiza igual y queda confirmado', async () => {
    const { s, db, preparar } = armar();
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 }, { recienPreguntado: true });
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(preparar.mock.calls[0][2]).toMatchObject({ tipo: 'pickup', nombre: 'Leandro', items: renglones.map((x) => ({ sku: x.sku, cantidad: x.cantidad })) });
    expect(confirmaciones(db)).toEqual([{ p_id: 'cot-nueva', p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'Sí' }]);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\. Total: \$128\.200\./);
    expect(r.respuesta).not.toMatch(/¿Lo confirmo\?/);
  });

  it('«A nombre de leandro» al «¿Lo confirmo?» es un sí: se confirma por el modo dato (la base vuelve a controlar el nombre)', async () => {
    const { s, db } = armar();
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'A nombre de leandro', resumenPresentado: M24 }, { recienPreguntado: true });
    expect(confirmaciones(db)).toEqual([{ p_id: 'cot-nueva', p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'A nombre de leandro', p_modo: 'dato' }]);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\./);
  });

  it('si al recotizar cambió el precio, va el resumen nuevo (una vez) y no se crea nada', async () => {
    const { s, db } = armar({ totalNuevo: 130500 });
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 }, { recienPreguntado: true });
    expect(r.recotizado).toBe(true);
    expect(r.respuesta).toMatch(/Total: \$130\.500/);
    expect(r.respuesta).toMatch(/¿Lo confirmo\?$/);
    expect(confirmaciones(db)).toHaveLength(0);
  });

  it('otro nombre, un cambio o una duda no confirman ni recotizan', async () => {
    for (const t of ['A nombre de Ana', 'Leandro, sumale una coca', 'Leandro te aviso', 'Mañana te confirmo', 'Leandro 👍']) {
      const { s, db, preparar } = armar();
      await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: t, resumenPresentado: M24 })).rejects.toThrow(/falta confirmación inequívoca/);
      expect(preparar).not.toHaveBeenCalled();
      expect(confirmaciones(db)).toHaveLength(0);
    }
  });

  it('el «sí» a algo que no es el «¿Lo confirmo?» con ese total no recotiza', async () => {
    const { s, preparar } = armar();
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: '¿Lo retirás o te lo enviamos?' })).rejects.toThrow(/resumen verificable/);
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: 'Total: $99.000. ¿Lo confirmo?' })).rejects.toThrow(/resumen verificable/);
    expect(preparar).not.toHaveBeenCalled();
  });

  it('cotización fresca: se confirma la misma, sin recotizar', async () => {
    const fresca = { ...VIEJA, id: 'cot-fresca', creada_en: hace(5), vence_en: new Date(Date.now() + 25 * 60_000).toISOString() };
    const { s, db, preparar } = armar({ cotizaciones: [fresca] });
    await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'dale', resumenPresentado: RESUMEN });
    expect(preparar).not.toHaveBeenCalled();
    expect(confirmaciones(db)).toEqual([{ p_id: 'cot-fresca', p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'dale' }]);
  });

  it('una hora después (la base ya la daba por vencida a los 30 minutos): se recotiza y se confirma', async () => {
    const deHoy = { ...VIEJA, id: 'cot-hora', creada_en: hace(60), vence_en: hace(30) };
    const { s, db, preparar } = armar({ cotizaciones: [deHoy] });
    await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'sí', resumenPresentado: RESUMEN });
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(confirmaciones(db)[0]).toMatchObject({ p_id: 'cot-nueva' });
  });

  it('un pedido ya confirmado no se recotiza ni se vuelve a crear', async () => {
    const hecha = { ...VIEJA, confirmada_en: hace(300), pedido_id: 'ped-1' };
    const { s, db, preparar } = armar({ cotizaciones: [hecha] });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 })).rejects.toThrow();
    expect(preparar).not.toHaveBeenCalled();
    expect(confirmaciones(db)).toHaveLength(0);
  });
});

describe('charla de Leandro (22:43): sin el modelo', () => {
  it('«Sí» al mensaje 24: el pedido queda confirmado', async () => {
    const { s, db, create } = armar();
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí' });
    expect(create).not.toHaveBeenCalled();
    expect(confirmaciones(db)).toHaveLength(1);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\./);
  });

  it('«A nombre de Leandro» al mensaje 24: el pedido queda confirmado', async () => {
    const { s, db, create } = armar();
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'A nombre de Leandro' });
    expect(create).not.toHaveBeenCalled();
    expect(confirmaciones(db)[0]).toMatchObject({ p_modo: 'dato' });
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\./);
  });

  it('«Hola» después de horas: el saludo y nada más, sin retomar el pedido de la tarde', async () => {
    const { s, db, create, preparar } = armar({ hist: HIST.slice(0, 7), actualizado: hace(300) });
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola' });
    expect(create).not.toHaveBeenCalled();
    expect(preparar).not.toHaveBeenCalled();
    expect(confirmaciones(db)).toHaveLength(0);
    expect(r.respuesta).toMatch(/^(Buen día|Buenas tardes|Buenas noches)\. ¿Qué necesitás\?$/);
  });

  it('«Hola» con la charla viva sigue igual: silencio', async () => {
    const { s, create } = armar({ hist: HIST.slice(0, 7), actualizado: hace(2) });
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola' });
    expect(create).not.toHaveBeenCalled();
    expect(r.respuesta ?? null).toBeNull();
  });
});

// ============================================================
// Revisión del 9/10 (noche): lo que NO tiene que crear un pedido, y los «sí» que
// el bot no entendía. Uno por hallazgo.
// ============================================================
const FRESCA = { ...VIEJA, id: 'cot-fresca', creada_en: hace(5), vence_en: new Date(Date.now() + 25 * 60_000).toISOString() };
const HIST_FRESCA = [{ role: 'user', content: 'Leandro, para retirar' }, { role: 'assistant', content: RESUMEN }];

describe('revisión del 9/10: lo que no es aceptar', () => {
  it('un «sí» dos días después no recotiza ni confirma: decide el modelo', async () => {
    const vieja = { ...VIEJA, creada_en: hace(2 * 24 * 60), vence_en: hace(2 * 24 * 60 - 30) };
    for (const t of ['Sí', 'Dale', 'Perfecto, gracias por todo']) {
      const { s, db, preparar, create } = armar({ cotizaciones: [vieja], hist: HIST_FRESCA, actualizado: hace(2 * 24 * 60) });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, preparar.mock.calls.length]).toEqual([t, 0]);
      expect(confirmaciones(db).filter((c: any) => c.p_id === 'cot-nueva')).toHaveLength(0);
      if (t !== 'Perfecto, gracias por todo') expect(create).toHaveBeenCalled();
    }
  });

  it('«Hola, soy Leandro», «Soy Leandro», «Es Leandro» al «¿Lo confirmo?» no son aceptar', async () => {
    for (const t of ['Hola, soy Leandro', 'Soy Leandro', 'Es Leandro', 'Buenas, soy Leandro']) {
      const { s, preparar, db } = armar();
      await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: t, resumenPresentado: M24 }, { recienPreguntado: true })).rejects.toThrow(/falta confirmación inequívoca/);
      expect(preparar).not.toHaveBeenCalled();
      expect(confirmaciones(db)).toHaveLength(0);
    }
  });

  it('crear_pedido después de armar otro resumen en el mismo turno: «Ana» no confirma lo que el cliente no vio', async () => {
    const { s } = armar({ cotizaciones: [FRESCA] });
    const crear = jest.spyOn(s, 'crearPedido');
    const ctx = { ultimoBot: RESUMEN, textoCliente: 'Ana', historial: HIST_FRESCA, fallos: new Map([['__preparado__', 1]]), fija: {} as any, salidas: [] };
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 't', name: 'crear_pedido', input: {} }, TEL, 'pedidos', ctx);
    expect(crear).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/NO se creó el pedido/);
  });

  it('«Sí, sumale una coca», «Si y 2 hielos», «Sí, también un fernet» no confirman sin lo que agregó', async () => {
    for (const t of ['Sí, sumale una coca', 'Si y 2 hielos', 'Sí, también un fernet']) {
      const { s, preparar, db } = armar();
      await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: t, resumenPresentado: M24 }, { recienPreguntado: true })).rejects.toThrow(/falta confirmación inequívoca/);
      expect(preparar).not.toHaveBeenCalled();
      expect(confirmaciones(db)).toHaveLength(0);
    }
  });

  it('al recotizar, el mismo total pero otro precio en efectivo: va el resumen nuevo, no se confirma', async () => {
    const { s, db } = armar({ renglonesNuevos: renglones.map((r, i) => (i === 1 ? { ...r, subtotal: 45400, subtotalEfectivo: 43000 } : r)) });
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 }, { recienPreguntado: true });
    expect(r.recotizado).toBe(true);
    expect(confirmaciones(db)).toHaveLength(0);
  });

  it('con la fecha de entrega ya pasada no se recotiza (la base la rechaza y el modelo pide otra fecha)', async () => {
    const conFecha = { ...VIEJA, creada_en: hace(60), vence_en: hace(30), entrega_fecha: '2020-01-01' };
    const { s, preparar } = armar({ cotizaciones: [conFecha] });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: RESUMEN }, { recienPreguntado: true })).rejects.toThrow(/vencio/);
    expect(preparar).not.toHaveBeenCalled();
  });

  it('dos mensajes a la vez: una sola recotización, un solo pedido', async () => {
    const { s, db, preparar } = armar();
    const rs = await Promise.allSettled([
      s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 }, { recienPreguntado: true }),
      s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'A nombre de Leandro', resumenPresentado: M24 }, { recienPreguntado: true }),
    ]);
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(confirmaciones(db).filter((c: any) => c.p_id === 'cot-nueva')).toHaveLength(1);
  });

  it('después del resumen le llegó una difusión: el «sí» no confirma sin el modelo', async () => {
    const { s, db } = armar({ cotizaciones: [FRESCA], tablas: { bot_envios: { filas: [{ waha_id: 'D1', telefono: TEL, origen: 'difusion', creado_en: new Date().toISOString() }] } } });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: RESUMEN })).rejects.toThrow(/difusión/);
    expect(confirmaciones(db)).toHaveLength(0);
  });
});

describe('revisión del 9/10: los «sí» que el bot no entendía', () => {
  it('«Sii», «Sisi», «¡Sí!», «Hola, sí», «Bueno, sí, confirmalo», «Confirmado», «Sí, para retirar»: confirman', async () => {
    for (const t of ['Sii', 'Sisi', '¡Sí!', 'Hola, sí', 'Bueno, sí, confirmalo', 'Confirmado', 'Sí, para retirar', 'Si porfa']) {
      const { s, db } = armar({ cotizaciones: [FRESCA] });
      await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: t, resumenPresentado: RESUMEN });
      const c = confirmaciones(db);
      expect([t, c.length]).toEqual([t, 1]);
      expect(c[0].p_confirmacion).toMatch(/^(si|sí|dale|ok|confirmo|confirmalo|bueno)/i);
    }
  });

  it('«Sí, para retirar» con un envío no se toma como sí (cambia la modalidad)', async () => {
    const { s } = armar({ cotizaciones: [{ ...FRESCA, tipo: 'domicilio', direccion: 'Mitre 1234', nombre: 'Leandro' }] });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí, para retirar', resumenPresentado: RESUMEN })).rejects.toThrow(/falta confirmación inequívoca/);
  });

  it('«Perfecto», «👍», «Dale gracias», «Joya» al «¿Lo confirmo?»: confirman sin el modelo (antes el bot se callaba)', async () => {
    for (const t of ['Perfecto', '👍', 'Dale gracias', 'Joya']) {
      const { s, db, create } = armar({ cotizaciones: [FRESCA], hist: HIST_FRESCA });
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, create.mock.calls.length, confirmaciones(db).length]).toEqual([t, 0, 1]);
      expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado/);
    }
  });

  it('con una respuesta del bot en el medio («Hasta las 21 h.»), «Dale, confirmalo» confirma', async () => {
    const hist = [...HIST_FRESCA, { role: 'user', content: '¿Hasta qué hora puedo pasar?' }, { role: 'assistant', content: 'Hasta las 21 h.' }];
    const { s, db, create } = armar({ cotizaciones: [FRESCA], hist });
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Dale, confirmalo' });
    expect(create).not.toHaveBeenCalled();
    expect(confirmaciones(db)).toHaveLength(1);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado/);
  });

  it('pasado el saludo de charla nueva, solo «confirmalo» vuelve al resumen; un «Sí» suelto va al modelo', async () => {
    const hist = [...HIST_FRESCA, { role: 'user', content: 'Hola' }, { role: 'assistant', content: 'Buenas noches. ¿Qué necesitás?' }];
    {
      const { s, db, create } = armar({ cotizaciones: [FRESCA], hist });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí, confirmalo' });
      expect(create).not.toHaveBeenCalled();
      expect(confirmaciones(db)).toHaveLength(1);
    }
    {
      const { s, db, create } = armar({ cotizaciones: [FRESCA], hist });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí' });
      expect(create).toHaveBeenCalled();
      expect(confirmaciones(db)).toHaveLength(0);
    }
  });
});

describe('revisión del 9/10: el saludo tardío', () => {
  it('«Hola, buenas noches», «Buenos días», «Holaa 👋» y la ráfaga «Hola / Buenas noches»: el saludo y nada más', async () => {
    for (const t of ['Hola, buenas noches', 'Buenos días', 'Holaa 👋', 'Hola\nBuenas noches', 'buenas']) {
      const { s, create, preparar } = armar({ hist: HIST.slice(0, 7), actualizado: hace(300) });
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, create.mock.calls.length, preparar.mock.calls.length]).toEqual([t, 0, 0]);
      expect(r.respuesta).toMatch(/^(Buen día|Buenas tardes|Buenas noches)\. ¿Qué necesitás\?$/);
    }
  });

  it('si lo último fue del cliente (espera una respuesta), el saludo va al modelo', async () => {
    const { s, create } = armar({ hist: [...HIST.slice(0, 7), { role: 'user', content: '¿Tienen hielo de 5 kg?' }], actualizado: hace(300) });
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola' });
    expect(create).toHaveBeenCalled();
  });

  it('un proveedor que saluda no recibe el «¿Qué necesitás?» de cliente', async () => {
    const { s, create } = armar({ hist: HIST.slice(0, 7), actualizado: hace(300), tablas: { bot_contactos: { select: { data: { tipo: 'proveedor', nombre: 'Distri Sur' }, error: null } } } });
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Buen día' });
    expect(create).toHaveBeenCalled();
  });
});

// ============================================================
// Segunda revisión del 9/10: la lista cerrada del sí y el «¿Lo confirmo?» de antes
// ============================================================
const conHist = (...medio: { role: string; content: string }[]) => [...HIST_FRESCA, ...medio];
const u = (content: string) => ({ role: 'user', content });
const b = (content: string) => ({ role: 'assistant', content });

describe('segunda revisión: un sí a otra cosa no confirma el resumen de antes', () => {
  it('después de otra respuesta, «Sí, mandame una bolsa», «Sí, dale», «Sii» van al modelo', async () => {
    const casos: [any[], string][] = [
      [conHist(u('¿Tienen hielo de 5 kg?'), b('Sobre el hielo de 5 kg: sí, tenemos.')), 'Sí, mandame una bolsa'],
      [conHist(u('¿Me lo pueden mandar a casa?'), b('Sí, el envío es sin cargo.')), 'Sí, dale'],
      [conHist(u('¿Lo puedo retirar el sábado?'), b('Sí, el sábado abrimos de 9 a 13 h.')), 'Sii'],
      [conHist(u('¿Tienen hielo de 5 kg?'), b('Sobre el hielo de 5 kg: sí, tenemos.')), 'Dale, confirmalo'],
      [conHist(u('Mejor la de litro'), b('Anotado.')), 'Confirmalo'],
    ];
    for (const [hist, t] of casos) {
      const { s, db, create } = armar({ cotizaciones: [FRESCA], hist });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
      expect(create).toHaveBeenCalled();
    }
  });

  it('«Mmm bueno…», «Eh bueno», «Bueno, gracias», «Bueno», «Ah, perfecto» al «¿Lo confirmo?» no confirman', async () => {
    for (const t of ['Mmm bueno...', 'Eh bueno', 'Bueno, gracias', 'Bueno', 'Ah, perfecto']) {
      const { s, db } = armar({ cotizaciones: [FRESCA], hist: HIST_FRESCA });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
    }
  });

  it('un sí con algo más (postergar, agregar, preguntar) no confirma: «Bueno, dale, mañana te confirmo», «Sí, con hielo», «Sí, x2»…', async () => {
    for (const t of ['Bueno, dale, mañana te confirmo', 'Sí, más una coca', 'Sí, con hielo', 'Sí, x2', 'Si, cuánto sale el hielo?', 'Okis, lo veo con mi señora', 'Sí, la coca light']) {
      const { s, db } = armar({ cotizaciones: [FRESCA], hist: HIST_FRESCA });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
    }
  });

  it('un sí que cambia la modalidad no confirma la modalidad vieja', async () => {
    const dom = { ...FRESCA, tipo: 'domicilio', direccion: 'Mitre 1234', nombre: 'Leandro' };
    for (const [cot, t] of [[FRESCA, 'Sí, mandámelo a Mitre 1234'], [FRESCA, 'Dale, envialo a casa'], [dom, 'Sí, lo paso a buscar yo'], [dom, 'Dale, lo retiro en el local'], [dom, 'Sí, para retirar']] as const) {
      const { s, db } = armar({ cotizaciones: [cot], hist: HIST_FRESCA });
      await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
    }
    // con un envío y sin el dato habilitado, la regla igual conoce el tipo
    const { s } = armar({ cotizaciones: [dom] });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí, para retirar', resumenPresentado: RESUMEN }, { aceptaDato: false })).rejects.toThrow(/falta confirmación inequívoca/);
  });

  it('«Confirmame si abren hasta las 20» después del saludo de charla nueva no confirma', async () => {
    const { s, db } = armar({ cotizaciones: [{ ...FRESCA, creada_en: hace(60), vence_en: hace(30) }], hist: conHist(u('Hola'), b('Buenas tardes. ¿Qué necesitás?')) });
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Confirmame si abren hasta las 20' });
    expect(confirmaciones(db)).toHaveLength(0);
  });

  it('un «Sip» o «Hola, sí» después de «Recibido. Tu pedido … quedó confirmado» no vuelve a confirmar', async () => {
    const hecha = { ...FRESCA, pedido_id: 'ped-1', confirmada_en: hace(2) };
    for (const t of ['Sip', 'Hola, sí', 'Sii, gracias']) {
      const { s, db } = armar({ cotizaciones: [hecha], hist: conHist(u('📷 Foto del cliente'), b('Recibido. Tu pedido PICKUP-E9D52964B0BA quedó confirmado para retirar en la sucursal Saint Thomas.')) });
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
      expect(r.respuesta ?? null).toBeNull();
    }
    const { s } = armar({ cotizaciones: [hecha] });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: RESUMEN })).rejects.toThrow(/ya está confirmado/);
  });

  it('un «Gracias» callado no hace «recién preguntado» a un resumen de hace dos días', async () => {
    const vieja = { ...VIEJA, creada_en: hace(2 * 24 * 60), vence_en: hace(2 * 24 * 60 - 30) };
    const { s, db, preparar } = armar({ cotizaciones: [vieja], hist: [...HIST_FRESCA, u('Gracias!')], actualizado: hace(2) });
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí' });
    expect(preparar).not.toHaveBeenCalled();
    expect(confirmaciones(db).filter((c: any) => c.p_id === 'cot-nueva')).toHaveLength(0);
  });

  it('crear_pedido después de armar otro resumen en el mismo turno: tampoco con un «Sí»', async () => {
    const { s } = armar({ cotizaciones: [FRESCA] });
    const crear = jest.spyOn(s, 'crearPedido');
    const ctx = { ultimoBot: RESUMEN, textoCliente: 'Sí', historial: HIST_FRESCA, fallos: new Map([['__preparado__', 1]]), fija: {} as any, salidas: [] };
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 't', name: 'crear_pedido', input: {} }, TEL, 'pedidos', ctx);
    expect(crear).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/todavía no lo vio/);
  });
});

describe('segunda revisión: las difusiones', () => {
  it('si la consulta de difusiones falla, no se confirma', async () => {
    const { s, db } = armar({ cotizaciones: [FRESCA], tablas: { bot_envios: { select: { data: null, error: { message: 'timeout' } } } } });
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí!', resumenPresentado: RESUMEN })).rejects.toThrow(/difusión/);
    expect(confirmaciones(db)).toHaveLength(0);
  });

  it('una difusión ANTES de que el bot volviera a preguntar no traba el sí a esa pregunta', async () => {
    const { s, db } = armar({ cotizaciones: [FRESCA], tablas: { bot_envios: { filas: [{ waha_id: 'D1', telefono: TEL, origen: 'difusion', creado_en: hace(3) }] } } });
    await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 }, { presentadoEn: hace(1) });
    expect(confirmaciones(db)).toHaveLength(1);
  });
});

describe('segunda revisión: los sí que faltaban y el saludo con «¿qué tal?»', () => {
  it('«Genial, dale», «Joya, sí», «Dalee», «Listoo», «Está bien», «Ok, gracias», «👍🏻» confirman', async () => {
    for (const t of ['Genial, dale', 'Joya, dale', 'Joya, sí', 'Dalee', 'Listoo', 'Está bien', 'Ok, gracias', '👍🏻', 'Sí, en efectivo']) {
      const { s, db, create } = armar({ cotizaciones: [FRESCA], hist: HIST_FRESCA });
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, create.mock.calls.length, confirmaciones(db).length]).toEqual([t, 0, 1]);
      expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado/);
      // a la base le llega lo que escribió, con un sí que ella conoce adelante
      expect(confirmaciones(db)[0].p_confirmacion).toMatch(/^(?:dale · |s[ií]|ok|listo|perfecto|confirm)/i);
    }
  });

  it('«Hola, ¿qué tal?», «Hola, ¿cómo estás?», «Buenas, ¿cómo andan?» tarde: el saludo y nada más', async () => {
    for (const t of ['Hola, ¿qué tal?', 'Hola, ¿cómo estás?', 'Buenas, ¿cómo andan?']) {
      const { s, create } = armar({ hist: HIST.slice(0, 7), actualizado: hace(300) });
      const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: t });
      expect([t, create.mock.calls.length]).toEqual([t, 0]);
      expect(r.respuesta).toMatch(/^(Buen día|Buenas tardes|Buenas noches)\. ¿Qué necesitás\?$/);
    }
  });

  it('el saludo tardío no le contesta «¿Qué necesitás?» al que espera la confirmación de su pago', async () => {
    const { s, create } = armar({ hist: HIST.slice(0, 7), actualizado: hace(60), tablas: { bot_pagos_en_confirmacion: { filas: [{ id: 'p1', linea: 'pedidos', telefono_cliente: TEL, confirmado_en: null, creado_en: hace(50) }] } } });
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Hola' });
    expect(create).toHaveBeenCalled();
  });
});

describe('segunda revisión: cuando el modelo pide crear el pedido (herramienta crear_pedido)', () => {
  const herramienta = async (texto: string, cot: any = FRESCA) => {
    const { s, db } = armar({ cotizaciones: [cot] });
    const ctx = { ultimoBot: RESUMEN, textoCliente: texto, historial: HIST_FRESCA, fallos: new Map(), fija: {} as any, salidas: [] };
    const r = await s.ejecutarHerramienta({ type: 'tool_use', id: 't', name: 'crear_pedido', input: {} }, TEL, 'pedidos', ctx);
    return { r, db, ctx };
  };
  it('«Sí, confirmo. ¿Hay estacionamiento?»: el modelo lo leyó, se crea (la pregunta la contesta aparte)', async () => {
    const { db, ctx } = await herramienta('Sí, confirmo. ¿Hay estacionamiento?');
    expect(confirmaciones(db)).toHaveLength(1);
    expect(ctx.fija.texto).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado/);
  });
  it('aunque el modelo lo pida, no se crea con «Sí, mañana te confirmo», «Sí, con hielo», «Dale, envialo a casa», «Sí, más una coca»', async () => {
    for (const t of ['Sí, mañana te confirmo', 'Sí, con hielo', 'Dale, envialo a casa', 'Sí, más una coca', 'Sí, x2']) {
      const { db, r } = await herramienta(t);
      expect([t, confirmaciones(db).length]).toEqual([t, 0]);
      expect(String(r.content)).toMatch(/NO se creó el pedido/);
    }
  });
});
