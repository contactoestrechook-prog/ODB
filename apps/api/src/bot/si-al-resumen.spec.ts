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
    return true;
  });
}

// base falsa: las tablas con `filas` filtran, ordenan y devuelven una fila en maybeSingle
function baseFalsa(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async (nombre: string) => (nombre === 'confirmar_cotizacion_bot' ? { data: 'pedido-1', error: null } : { data: null, error: null })),
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

function armar(o: { cotizaciones?: any[]; totalNuevo?: number; hist?: any[]; actualizado?: string } = {}) {
  const filas = [...(o.cotizaciones ?? [VIEJA])];
  const db = baseFalsa({
    bot_cotizaciones: { filas },
    bot_conversaciones: { select: { data: { mensajes: o.hist ?? HIST, bot_activo: true, actualizado_en: o.actualizado ?? hace(1), importes_verificados: [] }, error: null } },
    lineas_whatsapp: { select: { data: { derivar_pagos_a: null, avisar_proveedores_a: null, bot_activo: true }, error: null } },
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
    return { cotizacionId: 'cot-nueva', total, resumen, renglones };
  });
  const create = jest.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'NO DEBERÍA LLAMARSE AL MODELO' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  s.claude = { messages: { create } };
  return { s, db, preparar, create };
}
const confirmaciones = (db: any) => db.rpc.mock.calls.filter((c: any[]) => c[0] === 'confirmar_cotizacion_bot').map((c: any[]) => c[1]);

describe('crearPedido: el «sí» al «¿Lo confirmo?» confirma si nada cambió', () => {
  it('22:43 «Sí» al mensaje 24, con la cotización vencida: se recotiza igual y queda confirmado', async () => {
    const { s, db, preparar } = armar();
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 });
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(preparar.mock.calls[0][2]).toMatchObject({ tipo: 'pickup', nombre: 'Leandro', items: renglones.map((x) => ({ sku: x.sku, cantidad: x.cantidad })) });
    expect(confirmaciones(db)).toEqual([{ p_id: 'cot-nueva', p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'Sí' }]);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\. Total: \$128\.200\./);
    expect(r.respuesta).not.toMatch(/¿Lo confirmo\?/);
  });

  it('«A nombre de leandro» al «¿Lo confirmo?» es un sí: se confirma por el modo dato (la base vuelve a controlar el nombre)', async () => {
    const { s, db } = armar();
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'A nombre de leandro', resumenPresentado: M24 });
    expect(confirmaciones(db)).toEqual([{ p_id: 'cot-nueva', p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'A nombre de leandro', p_modo: 'dato' }]);
    expect(r.respuesta).toMatch(/^Pedido PICKUP-E9D52964B0BA confirmado a nombre de Leandro\./);
  });

  it('si al recotizar cambió el precio, va el resumen nuevo (una vez) y no se crea nada', async () => {
    const { s, db } = armar({ totalNuevo: 130500 });
    const r = await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'Sí', resumenPresentado: M24 });
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
