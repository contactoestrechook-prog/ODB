// EL PAGO Y EL CIERRE (5/10/2026): los casos salen de la charla real de Pablo
// (vinos para España). Los textos de los mensajes son los que vio el cliente.
import { BotService } from './bot.service';
import { MODELO_BOT } from './agente-bot';
import { confirmacionInequivoca } from './comercio';
import { puedeCotizar } from './completo';
import {
  cambiaElPedido, cambiaLaEntrega, comprobanteYaRegistrado, conDatosDePago, montoDelPedido, notasSinPagado, razonamientoPara,
  respuestaPedidoPorComprobante, sinPedirConfirmo, totalEfectivoDe,
} from './pago-confirma';

// Base falsa POR OPERACIÓN: lo que devuelve depende de la tabla, de si es
// select/insert/update/upsert y de cómo termina la consulta (maybeSingle, single
// o await directo). La de bot.spec.ts devuelve lo mismo en select e insert y no
// tiene .filter, que usa derivar_pago.
type Consulta = { op: string; terminal: string; filtros: any[][] };
function dbPorOperacion(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const filtros: any[][] = [];
      const res = (terminal: string) => {
        const c = config[tabla];
        const q: Consulta = { op, terminal, filtros };
        const r = typeof c === 'function' ? c(q) : typeof c?.[op] === 'function' ? c[op](q) : c?.[op];
        return r ?? { data: null, error: null };
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res('then')).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res(String(k));
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op: String(k), fila }); return b; };
          return (...args: any[]) => { filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '137091732230271';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, alias_pago: 'outlet.de.bebidas', cbu_pago: '0720000000000000000000', titular_pago: 'Chinvenguencha SRL', banco_pago: 'Santander', bot_activo: true };
const M12 = 'Te anoto:\n• 2 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Conjuro Bressia 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
const M18 = '• Judas Malbec x750cc — 2 × $79.900 c/u = $159.800\n• Catena Zapata Malbec Argentino — 1 × $73.800 c/u = $73.800\n• Conjuro Bressia — 1 × $83.500 c/u = $83.500\nTotal: $317.100\nPagando en efectivo o transferencia: $285.390 (10% off en vinos, destilados, aperitivos, estuchería y espumantes).\nRetiro en la sucursal Saint Thomas.\nIndicaciones: Retira en un rato. Pidió embalaje/caja para transportar las botellas en valija a España. Paga por transferencia.\n¿Lo confirmo?';
const M20 = 'Perfecto, mandame el comprobante por acá cuando lo hagas. Decime «confirmo» y dejo el pedido preparado para el retiro en la sucursal Saint Thomas.';
const PDF = '[el cliente mandó este PDF]';
const URL_PDF = 'https://x.supabase.co/publico/whatsapp/1/comprobante.pdf';
const ARCHIVO = { base64: 'JVBERi0xLjQKJcTl', mime: 'application/pdf' };
const PREP = { cotizacionId: 'cot-1', resumen: M18, total: 317100, renglones: [] };
// la cotización 00d16356 de las 16:34 (la del resumen M18)
const COT = {
  id: '00d16356-6def-445c-8169-c7f07b9cdf08', total: 317100, tipo: 'pickup', direccion: null, notas: 'Retira en un rato. Paga por transferencia.',
  resumen: M18, creada_en: new Date(Date.now() - 31 * 60_000).toISOString(), confirmada_en: null, pedido_id: null,
  items: [
    { sku: 'JUDAS', cantidad: 2, subtotal: 159800, subtotalEfectivo: 143820 },
    { sku: 'CATENA', cantidad: 1, subtotal: 73800, subtotalEfectivo: 66420 },
    { sku: 'CONJURO', cantidad: 1, subtotal: 83500, subtotalEfectivo: 75150 },
  ],
};
const HIST = [
  { role: 'user', content: 'Me llevo los 3 y un judas más.' },
  { role: 'assistant', content: M12 },
  { role: 'user', content: 'Si queres pásame el total y a donde puedo hacerte l transferencia' },
  { role: 'assistant', content: M18 },
  { role: 'user', content: 'En 10 minutos llego a la compu y hago la transferencia' },
  { role: 'assistant', content: M20 },
];
const tu = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const resp = (content: any[], stop = 'tool_use') => ({ stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });
const lectura = (importe: number | null) => resp([{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ importe }) }], 'end_turn');

// el servicio con la base por operación y lo de afuera simulado
function armar(o: { cotizacion?: any; pagosAbiertos?: any[]; importeLeido?: number | null; conversacion?: any[] } = {}) {
  const cot = o.cotizacion === undefined ? COT : o.cotizacion;
  const db = dbPorOperacion({
    lineas_whatsapp: { select: { data: CFG } },
    alertas_internas: { select: { data: null } },
    bot_contactos: { select: { data: { nombre: 'Pablo' } } },
    bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: cot ? [cot] : [] } : { data: cot }) },
    bot_pagos_en_confirmacion: { select: { data: o.pagosAbiertos ?? [] } },
    bot_conversaciones: { select: { data: o.conversacion ? { mensajes: o.conversacion, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] } : null } },
  });
  db.rpc.mockImplementation(async (nombre: string) => (nombre === 'confirmar_cotizacion_bot' ? { data: 'pedido-1', error: null } : { data: null, error: null }));
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-00D163566DEF', total: 317100, estado: 'recibido' })) };
  const s = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  const envios: any[] = [];
  (s as any).enviarPorWhatsapp = jest.fn(async (p: any) => (envios.push(p), { enviado: true, id: `W${envios.length}` }));
  (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
  const lecturas: any[] = [];
  const principal: any[] = [];
  // una sola falsa de Claude: la lectura aparte se reconoce por la salida estructurada
  const create = jest.fn(async (p: any) => {
    if (p?.output_config?.format) { lecturas.push(p); return lectura(o.importeLeido === undefined ? 285390 : o.importeLeido); }
    return principal.shift() ?? resp([{ type: 'text', text: 'Recibido.' }], 'end_turn');
  });
  (s as any).claude = { messages: { create } };
  return { s, db, envios, lecturas, principal, create };
}
const ctxComprobante = (extra: any = {}) => ({
  ultimoBot: M20, ultimosBot: [M20, M18, M12], ultimosCliente: [...HIST.filter((m) => m.role === 'user').map((m) => m.content), PDF],
  textoCliente: PDF, archivoUrl: URL_PDF, archivo: ARCHIVO, historial: HIST, fallos: new Map<string, number>(), fija: {} as any, salidas: [], ...extra,
});
const derivarComprobante = (monto: number) => tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto, motivo: `Transfirió $${monto.toLocaleString('es-AR')} por el pedido de vinos`, de_quien: 'Pablo' });
const filasInsertadas = (db: any, tabla: string) => db.escrituras.filter((e: any) => e.tabla === tabla && e.op === 'insert');

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

describe('el alias y el total juntos (mensaje 16 de Pablo)', () => {
  const texto = 'Si queres pásame el total y a donde puedo hacerte l transferencia';
  const ctx = () => ({ ultimoBot: M12, ultimosBot: [M12], ultimosCliente: ['Me llevo los 3 y un judas más.', texto], textoCliente: texto, fallos: new Map<string, number>(), fija: {} as any });
  const verificar = (t: string) => {
    expect(t).toContain('Total: $317.100');
    expect(t).toContain('$285.390');
    expect(t).toContain('Alias: outlet.de.bebidas');
    expect(t).toContain('Cuando transfieras, mandame el comprobante por acá.');
    expect(t.indexOf('outlet.de.bebidas')).toBeLessThan(t.indexOf('¿Lo confirmo?'));
    expect(t.trim().endsWith('¿Lo confirmo?')).toBe(true);
    expect(t.match(/¿Lo confirmo\?/g)).toHaveLength(1);
  };

  it('preparar_pedido y después derivar_pago (quiere_pagar): el resumen con el alias antes de «¿Lo confirmo?»', async () => {
    const { s } = armar();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const c = ctx();
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias y total', monto: 0 }), TEL, 'pedidos', c);
    verificar(c.fija.texto);
    expect(c.fija.operacion).toBe(true);
  });

  it('en el orden inverso, igual', async () => {
    const { s } = armar();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const c = ctx();
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias y total', monto: 0 }), TEL, 'pedidos', c);
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    verificar(c.fija.texto);
  });

  it('sin resumen en el turno, el alias sale como siempre', async () => {
    const { s } = armar();
    const c = ctx();
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias', monto: 0 }), TEL, 'pedidos', c);
    expect(c.fija.texto).toBe('Alias: outlet.de.bebidas · CBU: 0720000000000000000000 · Titular: Chinvenguencha SRL (Santander). Cuando transfieras, mandame el comprobante por acá.');
  });

  it('conDatosDePago no toca un texto sin «¿Lo confirmo?» al final', () => {
    expect(conDatosDePago('Pedido X confirmado.', 'Alias: a')).toBe('Pedido X confirmado.');
    expect(conDatosDePago('Total: $1\n¿Lo confirmo?', 'Alias: a')).toBe('Total: $1\nAlias: a\n¿Lo confirmo?');
  });
});

describe('el comprobante confirma el pedido (decisión de Leandro, 5/10/2026)', () => {
  it('PDF por $285.390 después del resumen de $317.100 / $285.390: crea el pedido en modo comprobante y contesta con el código', async () => {
    const { s, db, envios, lecturas } = armar();
    const c = ctxComprobante();
    const r = await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: PDF, p_modo: 'comprobante', p_monto: 285390 });
    expect(c.fija.texto).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(c.fija.texto).not.toMatch(/acreditad|pagad|te confirmo/i);
    expect(c.fija.operacion).toBe(true);
    expect(c.fallos.get('__pedido_creado__')).toBe(1);
    expect(String(r.content)).toMatch(/No llames preparar_pedido ni crear_pedido/);
    // la lectura aparte: sin la charla, con razonamiento, salida estructurada
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0].model).toBe(MODELO_BOT);
    expect(lecturas[0].thinking).toEqual(razonamientoPara(MODELO_BOT));
    expect(lecturas[0].messages).toHaveLength(1);
    expect(lecturas[0].messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ARCHIVO.base64 } });
    expect(JSON.stringify(lecturas[0].messages)).not.toContain('Judas');
    // administración: UN aviso, con el PDF y diciendo que el monto coincide con el pedido
    expect(envios).toHaveLength(1);
    expect(envios[0].documentoUrl).toBe(URL_PDF);
    expect(envios[0].text).toContain('El monto coincide con el pedido PICKUP-00D163566DEF');
    const pagos = filasInsertadas(db, 'bot_pagos_en_confirmacion');
    expect(pagos).toHaveLength(1);
    expect(pagos[0].fila.resumen).toMatch(/^El monto coincide con el pedido PICKUP-00D163566DEF/);
  });

  it('un preparar_pedido después, en el mismo turno, no arma otro resumen ni pisa la confirmación', async () => {
    const { s } = armar();
    const preparar = jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    expect(preparar).not.toHaveBeenCalled();
    expect(c.fija.texto).toMatch(/^Recibido\. Tu pedido PICKUP-/);
  });

  it('el total de lista también confirma', async () => {
    const { s, db } = armar({ importeLeido: 317100 });
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(317100), TEL, 'pedidos', c);
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.objectContaining({ p_modo: 'comprobante', p_monto: 317100 }));
  });

  it('monto distinto: no se crea nada, va «Recibido.» y administración sabe que no coincide', async () => {
    const { s, db, envios, lecturas } = armar();
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(300000), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(lecturas).toHaveLength(0); // con el monto del modelo distinto, ni se lee aparte
    expect(c.fija.texto).toBe('Recibido.');
    expect(c.fija.operacion).toBeUndefined();
    expect(envios).toHaveLength(1);
    expect(envios[0].text).toContain('El monto no coincide con el resumen ($300.000; el pedido es $317.100 / $285.390)');
  });

  it('la lectura aparte no coincide con el monto del modelo: no se crea', async () => {
    const { s, db, envios } = armar({ importeLeido: 28539 });
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
    expect(envios[0].text).toContain('El monto no coincide con el resumen ($28.539; el pedido es $317.100 / $285.390)');
  });

  it('la lectura aparte no encuentra el importe: no se crea', async () => {
    const { s, db } = armar({ importeLeido: null });
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('sin archivo en este turno («ya te lo pasé»), un comprobante nunca crea el pedido', async () => {
    const { s, db } = armar();
    const c = ctxComprobante({ archivoUrl: undefined, archivo: undefined, textoCliente: 'Ya te hice la transferencia de 285.390' });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('si el cliente cambió el pedido después del resumen, el comprobante no lo confirma', async () => {
    const { s, db } = armar();
    const historial = [...HIST.slice(0, 4), { role: 'user', content: 'Sacá el Catena y sumale 2 judas' }, { role: 'assistant', content: M20 }];
    const c = ctxComprobante({ historial });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('si después del resumen el bot anotó otra lista, el comprobante no confirma', async () => {
    const { s, db } = armar();
    const historial = [...HIST.slice(0, 4), { role: 'user', content: 'y un fernet' }, { role: 'assistant', content: `${M12.replace('Te anoto:', 'Sumé:')}\n• 1 × Fernet Branca 750 cc` }];
    const c = ctxComprobante({ historial, ultimosBot: [historial[5].content, M18, M12] });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('si la base rechaza el pedido (el precio cambió), va «Recibido.» y administración lo sabe', async () => {
    const { s, db, envios } = armar();
    db.rpc.mockImplementation(async () => ({ data: null, error: { message: 'El precio cambio: volver a cotizar' } }));
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(c.fija.texto).toBe('Recibido.');
    expect(c.fallos.get('__pedido_creado__')).toBeUndefined();
    expect(envios).toHaveLength(1);
    expect(envios[0].text).toContain('hubo un error al confirmar el pedido (El precio cambio: volver a cotizar)');
  });

  it('si el cliente nunca vio el resumen con «¿Lo confirmo?», no se crea', async () => {
    const { s, db } = armar();
    const c = ctxComprobante({ ultimosBot: [M12], historial: HIST.slice(0, 2) });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });

  it('con un pedido del chat confirmado hace menos de 15 min, no se crea otro', async () => {
    const otro = { ...COT, id: 'otra', confirmada_en: new Date(Date.now() - 5 * 60_000).toISOString(), pedido_id: 'p0' };
    const db = dbPorOperacion({
      lineas_whatsapp: { select: { data: CFG } },
      bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: [COT, otro] } : { data: COT }) },
    });
    const s = new BotService(db, { obtener: jest.fn() } as any, {} as any, {} as any, {} as any);
    (s as any).enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W' }));
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    (s as any).claude = { messages: { create: jest.fn(async () => lectura(285390)) } };
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('el resumen vencido para el servidor (más de 3 h) no se confirma', async () => {
    const { s, db } = armar({ cotizacion: { ...COT, creada_en: new Date(Date.now() - 4 * 3600_000).toISOString() } });
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });

  it('crearPedido en modo comprobante exige la misma cotización evaluada; los otros modos llaman igual que siempre', async () => {
    const { s, db } = armar();
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', modo: 'comprobante', monto: 285390, cotizacionId: 'otra' })).rejects.toThrow(/resumen verificable/);
    await expect(s.crearPedido({ telefono: TEL, linea: 'pedidos', modo: 'comprobante', monto: 0, cotizacionId: COT.id })).rejects.toThrow(/confirmación/);
    await s.crearPedido({ telefono: TEL, linea: 'pedidos', confirmacion: 'sí', resumenPresentado: M18 });
    expect(db.rpc).toHaveBeenLastCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'sí' });
  });

  it('para envío, la plantilla de siempre: «Envío sin cargo a …»', () => {
    expect(respuestaPedidoPorComprobante({ codigo: 'DOM-ABC', tipo: 'domicilio', direccion: 'Juana de Arco 7450' }))
      .toBe('Recibido. Tu pedido DOM-ABC quedó confirmado. Envío sin cargo a Juana de Arco 7450.');
  });

  it('montos: lista o efectivo, a menos de $1; el envío nunca se suma', () => {
    expect(totalEfectivoDe(COT.items)).toBe(285390);
    expect(montoDelPedido(285390, 317100, 285390)).toBe('efectivo');
    expect(montoDelPedido(317100.5, 317100, 285390)).toBe('lista');
    expect(montoDelPedido(285391, 317100, 285390)).toBeNull();
    expect(montoDelPedido(0, 317100, 285390)).toBeNull();
  });

  it('razonamiento siempre encendido: adaptive en los modelos nuevos, budget_tokens en los viejos', () => {
    expect(razonamientoPara('claude-opus-5')).toEqual({ type: 'adaptive' });
    expect(razonamientoPara('claude-opus-5-5')).toEqual({ type: 'adaptive' });
    expect(razonamientoPara('claude-sonnet-4-6')).toEqual({ type: 'adaptive' });
    expect(razonamientoPara('claude-haiku-4-5')).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(razonamientoPara('claude-sonnet-4-20250514')).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });
});

describe('el «Recibido.» no se pisa y el comprobante no se registra dos veces', () => {
  it('preparar_pedido después del comprobante (sin pedido creado) guarda la cotización pero al cliente va «Recibido.»', async () => {
    const { s } = armar({ cotizacion: null });
    const preparar = jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    const r = await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(c.fija.texto).toBe('Recibido.');
    expect(c.fija.operacion).toBeUndefined();
    expect(String(r.content)).toContain('Recibido.');
  });

  it('«Ahí te pase el comprobante de tranfernacia» sin archivo, con el pago abierto: ni fila ni WhatsApp nuevos, «Recibido.»', async () => {
    const previo = { id: 'c76', monto: 285390, confirmado_en: null, creado_en: new Date(Date.now() - 100_000).toISOString() };
    const { s, db, envios } = armar({ pagosAbiertos: [previo] });
    const c: any = { ultimoBot: M18, ultimosBot: [M18, M20], textoCliente: 'Ahí te pase el comprobante de tranfernacia', fallos: new Map(), fija: {} };
    const r = await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'mandó comprobante', de_quien: 'Pablo' }), TEL, 'pedidos', c);
    expect(filasInsertadas(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
    expect(filasInsertadas(db, 'alertas_internas')).toHaveLength(0);
    expect(envios).toHaveLength(0);
    expect(c.fija.texto).toBe('Recibido.');
    expect(JSON.parse(String(r.content)).yaRegistrado).toBe(true);
  });

  it('si lo último que le dijimos ya era «Recibido.», no se repite el mismo mensaje', async () => {
    const previo = { id: 'c76', monto: 285390, confirmado_en: null, creado_en: new Date(Date.now() - 100_000).toISOString() };
    const { s } = armar({ pagosAbiertos: [previo] });
    const c: any = { ultimoBot: 'Recibido.', ultimosBot: ['Recibido.'], textoCliente: 'Ahí te pase el comprobante de tranfernacia', fallos: new Map(), fija: {} };
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'mandó comprobante' }), TEL, 'pedidos', c);
    expect(c.fija.texto).toBe('Sí, ya lo tengo.');
  });

  it('una fila sin fecha de creación no cuenta como reciente: el comprobante se registra', async () => {
    const { s, db, envios } = armar({ pagosAbiertos: [{ id: 'pc1', monto: 285390, confirmado_en: null }] });
    const c: any = { ultimoBot: M18, ultimosBot: [M18], textoCliente: 'Ahí te pase el comprobante de tranfernacia', fallos: new Map(), fija: {} };
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'mandó comprobante', de_quien: 'Pablo' }), TEL, 'pedidos', c);
    expect(envios).toHaveLength(1);
    expect(filasInsertadas(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
  });

  it('otro monto abierto no frena un comprobante distinto', async () => {
    const previo = { id: 'c1', monto: 120000, confirmado_en: null, creado_en: new Date(Date.now() - 100_000).toISOString() };
    const { s, envios } = armar({ pagosAbiertos: [previo] });
    const c: any = { ultimoBot: M18, ultimosBot: [M18], textoCliente: 'te pasé el de 285390', fallos: new Map(), fija: {} };
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'mandó comprobante', de_quien: 'Pablo' }), TEL, 'pedidos', c);
    expect(envios).toHaveLength(1);
  });
});

describe('la charla entera: el PDF del pago (mensajes 21 y 22 de Pablo)', () => {
  it('el PDF que coincide crea el pedido y contesta con el código, sin repetir el resumen', async () => {
    const { s, db, principal } = armar({ conversacion: HIST });
    principal.push(resp([derivarComprobante(285390)]));
    principal.push(resp([tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] })]));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '', archivoBase64: ARCHIVO.base64, mimeType: 'application/pdf', archivoUrl: URL_PDF });
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.objectContaining({ p_modo: 'comprobante', p_monto: 285390 }));
  });

  it('el PDF que no coincide: «Recibido.» aunque el modelo vuelva a preparar el resumen', async () => {
    const { s, db, principal } = armar({ conversacion: HIST });
    const preparar = jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    principal.push(resp([derivarComprobante(250000)]));
    principal.push(resp([tu('p', 'preparar_pedido', { tipo: 'pickup', items: [], notas: 'Pagado por transferencia ($250.000, comprobante enviado).' })]));
    principal.push(resp([{ type: 'text', text: M18 }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '', archivoBase64: ARCHIVO.base64, mimeType: 'application/pdf', archivoUrl: URL_PDF });
    expect(r.respuesta).toBe('Recibido.');
    expect(r.respuesta).not.toMatch(/¿Lo confirmo\?/);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    // y las notas que ve el cliente en un resumen no dicen «pagado»
    expect((preparar.mock.calls[0][2] as any).notas).toBe('Paga por transferencia.');
  });

  it('«En 10 minutos llego a la compu y hago la transferencia»: nunca «Decime «confirmo»»', async () => {
    const { s, principal } = armar({ conversacion: HIST.slice(0, 4) });
    // el texto real del mensaje 20, también en la regeneración («dejo el pedido» cuenta como promesa)
    principal.push(resp([{ type: 'text', text: M20 }], 'end_turn'), resp([{ type: 'text', text: M20 }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'En 10 minutos llego a la compu y hago la transferencia' });
    expect(r.respuesta).not.toMatch(/dec[ií]me\s*«?confirmo/i);
    expect(r.respuesta).toBe('Perfecto, mandame el comprobante por acá cuando lo hagas.');
  });

  it('«¿Cierro con esos tres y te paso el total?» es prometer el total para después (G2 con voseo)', async () => {
    const { s, principal, create } = armar({ conversacion: [{ role: 'user', content: 'Decime los valores' }, { role: 'assistant', content: 'Son estos tres: ...' }] });
    principal.push(resp([{ type: 'text', text: 'Ya te pasé los tres precios más arriba. ¿Cierro con esos tres y te paso el total?' }], 'end_turn'));
    principal.push(resp([{ type: 'text', text: 'Total: $317.100.' }], 'end_turn'));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me gustaría saber los precios' });
    const notas = create.mock.calls.map((c: any[]) => JSON.stringify(c[0]?.messages ?? []));
    expect(notas.some((m: string) => m.includes('prometiste el total para después'))).toBe(true);
  });
});

describe('piezas: «si» condicional, precios, «confirmo», notas y cambios', () => {
  it('«Si queres pásame el total…» no es una confirmación', () => {
    expect(confirmacionInequivoca('Si queres pásame el total y a donde puedo hacerte l transferencia')).toBe(false);
    expect(confirmacionInequivoca('si podés mandámelo')).toBe(false);
    expect(confirmacionInequivoca('Si te parece bien')).toBe(false);
  });
  it.each(['sí', 'si dale confirmalo', 'confirmo', 'dale, hacelo', 'Sí, confirmo', 'si, dale'])('«%s» sigue confirmando', (t) => expect(confirmacionInequivoca(t)).toBe(true));

  it.each(['Decime los valores', 'Me gustaría saber los precios', 'qué valor tiene?'])('«%s» es pregunta de precio', (t) => expect(puedeCotizar(t, [], [])).toBe(true));
  it('«Me llevo los 3» sola no habilita precios', () => expect(puedeCotizar('Me llevo los 3 y un judas más.', [], [])).toBe(false));

  it('saca la oración que pide escribir «confirmo»', () => {
    expect(sinPedirConfirmo(M20)).toBe('Perfecto, mandame el comprobante por acá cuando lo hagas.');
    expect(sinPedirConfirmo('Decime "confirmo" y lo cargo.', 'hago la transferencia')).toBe('Dale, mandalo por acá.');
    expect(sinPedirConfirmo('Total: $317.100\n¿Lo confirmo?')).toBe('Total: $317.100\n¿Lo confirmo?');
  });

  it('las notas no dicen «pagado»', () => {
    expect(notasSinPagado('Retira hoy en un rato. Pidió caja/embalaje para transportar las botellas en valija a España. Pagado por transferencia ($285.390, comprobante enviado).'))
      .toBe('Retira hoy en un rato. Pidió caja/embalaje para transportar las botellas en valija a España. Paga por transferencia.');
    expect(notasSinPagado('Pago confirmado por transferencia de $285.390. Retira a las 18')).toBe('Paga por transferencia. Retira a las 18');
    expect(notasSinPagado('Ya está pagado.')).toBe('');
    expect(notasSinPagado('Forma de pago: transferencia')).toBe('Forma de pago: transferencia');
    expect(notasSinPagado('Retira Pablo. Paga por transferencia.')).toBe('Retira Pablo. Paga por transferencia.');
  });

  it.each([
    ['En 10 minutos llego a la compu y hago la transferencia', false],
    [PDF, false],
    ['Ahí te pase el comprobante de tranfernacia', false],
    ['Te transferí 285.390, a las 18:30 paso', false],
    ['Sacá el Catena', true],
    ['sumale 2 judas', true],
    ['mejor que sean 3 judas', true],
    ['y otro judas', true],
    ['uno más de judas', true],
    ['cancelalo', true],
    ['2 Fernet también', true],
    ['y un fernet', true],
    ['sumá un hielo', true],
  ])('cambiaElPedido(«%s») = %s', (t, esperado) => expect(cambiaElPedido(t as string)).toBe(esperado));
});

// REVISIÓN DEL 5/10/2026: lo que encontraron los revisores sobre la plata
describe('revisión de la plata (5/10/2026)', () => {
  it('el PDF que paga un pedido YA confirmado hace 40 min no crea un segundo pedido; administración sabe de cuál puede ser', async () => {
    // A confirmado a las 10:00; B, el mismo resumen armado otra vez a las 10:20 con el alias
    const A = { ...COT, id: 'aaaaaaaa-1111-2222-3333-444444444444', confirmada_en: new Date(Date.now() - 40 * 60_000).toISOString(), pedido_id: 'p-A', creada_en: new Date(Date.now() - 60 * 60_000).toISOString() };
    const B = { ...COT, id: 'bbbbbbbb-1111-2222-3333-444444444444', creada_en: new Date(Date.now() - 10 * 60_000).toISOString() };
    const db = dbPorOperacion({
      lineas_whatsapp: { select: { data: CFG } },
      bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: [B, A] } : { data: B }) },
    });
    db.rpc.mockImplementation(async () => ({ data: 'pedido-B', error: null }));
    const s = new BotService(db, { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-BBBBBBBB1111', total: 317100 })) } as any, {} as any, {} as any, {} as any);
    const envios: any[] = [];
    (s as any).enviarPorWhatsapp = jest.fn(async (p: any) => (envios.push(p), { enviado: true, id: 'W' }));
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    (s as any).claude = { messages: { create: jest.fn(async () => lectura(285390)) } };
    const c = ctxComprobante();
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
    expect(envios[0].text).toContain('Puede ser el pago del pedido PICKUP-AAAAAAAA1111');
  });

  it('después de «Recibido. Tu pedido X quedó confirmado…», un «Sí, gracias» se calla (no va al modelo)', async () => {
    const conf = 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.';
    for (const dicho of ['Sí, gracias', 'Si']) {
      const { s, create } = armar({ conversacion: [...HIST, { role: 'user', content: PDF }, { role: 'assistant', content: conf }] });
      const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: dicho });
      expect(r.respuesta ?? null).toBeNull();
      expect(create).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['¿Me lo podés mandar a casa?'],
    ['Mandámelo a Av. Mitre 1200'],
    ['Envialo a mi casa'],
    ['Lo retiro el sábado'],
  ])('si después del resumen el cliente cambió la entrega («%s»), el comprobante no confirma', async (dicho) => {
    const { s, db } = armar();
    const historial = [...HIST.slice(0, 4), { role: 'user', content: dicho }, { role: 'assistant', content: 'Dale.' }];
    const c = ctxComprobante({ historial });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(c.fija.texto).toBe('Recibido.');
  });

  it('una dirección en el epígrafe del PDF, o el bot que pidió la dirección, tampoco confirman', async () => {
    const a = armar();
    const c1 = ctxComprobante({ textoCliente: 'Av. Hipólito Yrigoyen 8250, Lomas. Recibe Pablo' });
    await (a.s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c1);
    expect(a.db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    const b = armar();
    const historial = [...HIST.slice(0, 4), { role: 'user', content: 'Al final prefiero que me lo traigan' }, { role: 'assistant', content: 'Pasame la dirección con calle y número.' }];
    await (b.s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', ctxComprobante({ historial }));
    expect(b.db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });

  it.each([
    ['En vez del Malbec, el Cabernet', true],
    ['en lugar del Catena, otro Judas', true],
    ['que sea Cabernet', true],
    ['Lo paso a buscar en un rato', false],
    ['Hoy a la tarde lo retiro', false],
  ])('cambiaElPedido o cambiaLaEntrega(«%s») = %s', (t, esperado) => expect(cambiaElPedido(t as string) || cambiaLaEntrega(t as string)).toBe(esperado));

  it('un PDF con «Sí, ahí va la transferencia»: crear_pedido no crea por el «sí»; lo decide el comprobante', async () => {
    const { s, db } = armar();
    const c = ctxComprobante({ textoCliente: 'Sí, ahí va la transferencia', ultimoBot: M18, ultimosBot: [M18, M12] });
    const r = await (s as any).ejecutarHerramienta(tu('c', 'crear_pedido', {}), TEL, 'pedidos', c);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/derivar_pago/);
    // y después derivar_pago lo crea por el comprobante, con la nota de la transferencia
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.objectContaining({ p_modo: 'comprobante' }));
    expect(c.fija.texto).not.toMatch(/Se abona al retirar/);
  });

  it('un cliente nuevo (lo crea la RPC con el pedido): el pago no va a «Cobros a ingresar»', async () => {
    const { s, db } = armar();
    // antes del pedido no existía; después del pedido, sí (lo creó la RPC)
    (s as any).identificarCliente = jest.fn(async () => (db.rpc.mock.calls.length ? { existe: true, clienteId: 'cli-nuevo', nombre: 'Pablo' } : { existe: false }));
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', ctxComprobante());
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
    expect(filasInsertadas(db, 'cobranzas_pendientes')).toHaveLength(0);
  });

  it('un cliente que ya existía sigue cargando la cobranza como siempre', async () => {
    const { s, db } = armar();
    (s as any).identificarCliente = jest.fn(async () => ({ existe: true, clienteId: 'cli-1', nombre: 'Pablo' }));
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', ctxComprobante());
    expect(filasInsertadas(db, 'cobranzas_pendientes')).toHaveLength(1);
  });

  it('el archivo del turno cuenta aunque su copia pública haya fallado: un comprobante nuevo se registra', async () => {
    const previo = { id: 'c1', monto: 150000, confirmado_en: null, creado_en: new Date(Date.now() - 40 * 60_000).toISOString() };
    const { s, db, envios } = armar({ pagosAbiertos: [previo], cotizacion: null });
    const c = ctxComprobante({ archivoUrl: '' });
    await (s as any).ejecutarHerramienta(derivarComprobante(150000), TEL, 'pedidos', c);
    expect(envios).toHaveLength(1);
    expect(filasInsertadas(db, 'bot_pagos_en_confirmacion')).toHaveLength(1);
  });

  it('sin monto, una consulta de pago abierta (sin monto) no calla un comprobante', async () => {
    const consultaDePago = { id: 'q1', monto: null, confirmado_en: null, creado_en: new Date(Date.now() - 10 * 60_000).toISOString() };
    const db = dbPorOperacion({ bot_pagos_en_confirmacion: { select: { data: [consultaDePago] } } });
    expect(await comprobanteYaRegistrado(db, 'pedidos', TEL, 0)).toBe(false);
    const db2 = dbPorOperacion({ bot_pagos_en_confirmacion: { select: { data: [{ ...consultaDePago, monto: 285390 }] } } });
    expect(await comprobanteYaRegistrado(db2, 'pedidos', TEL, 0)).toBe(true);
  });

  it('la lectura de pagos abiertos filtra por línea, teléfono, sin confirmar y ventana de 2 h', async () => {
    let filtros: any[][] = [];
    const db = dbPorOperacion({ bot_pagos_en_confirmacion: { select: (q: Consulta) => { filtros = q.filtros; return { data: [] }; } } });
    await comprobanteYaRegistrado(db, 'pedidos', TEL, 285390);
    expect(filtros).toContainEqual(['eq', 'linea', 'pedidos']);
    expect(filtros).toContainEqual(['eq', 'telefono_cliente', TEL]);
    expect(filtros).toContainEqual(['is', 'confirmado_en', null]);
    expect(filtros.some((f) => f[0] === 'gte' && f[1] === 'creado_en')).toBe(true);
  });

  it('«Decime confirmo» solo, sin hablar de pagar: «Total $X. ¿Lo confirmo?» con el total del resumen, nunca un «¿Lo confirmo?» suelto', () => {
    expect(sinPedirConfirmo('Decime «confirmo» y lo dejo listo.', 'Perfecto, lo retiro a la tarde', [M18, M12])).toBe('Total $317.100. ¿Lo confirmo?');
    expect(sinPedirConfirmo('Decime «confirmo» y lo dejo listo.', 'Perfecto', [])).toBe('¿Lo confirmo?');
  });

  // el epígrafe más común de un comprobante habla del pago, no de la entrega:
  // con un «envi\w*» suelto, «Te envío el comprobante» dejaba sin pedido al que pagó
  it.each(['Te envío el comprobante', 'Transferencia enviada', 'Ya te la envié', 'Ahí te mando la transferencia', 'Envío comprobante', 'Ahí va, operación 12345', 'Comprobante n° 4567'])(
    'el epígrafe «%s» no cambia la entrega', (t) => expect(cambiaElPedido(t) || cambiaLaEntrega(t)).toBe(false));
  it.each(['¿Hacen envío a Lomas?', 'mejor con envío', 'me lo mandás a Mitre 1200?', 'Traémelo a casa', 'Enviámelo', 'Que me lo envíen a Canning'])(
    '«%s» sí cambia la entrega', (t) => expect(cambiaLaEntrega(t)).toBe(true));

  it('un PDF con «Te envío el comprobante» por el total con descuento crea el pedido igual', async () => {
    const { s, db } = armar();
    const c = ctxComprobante({ textoCliente: 'Te envío el comprobante' });
    await (s as any).ejecutarHerramienta(derivarComprobante(285390), TEL, 'pedidos', c);
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.objectContaining({ p_modo: 'comprobante', p_monto: 285390 }));
    expect(c.fija.texto).toMatch(/^Recibido\. Tu pedido PICKUP-00D163566DEF quedó confirmado/);
  });

  it.each(['Si es correcto', 'Sí te confirmo', 'si te lo confirmo', 'Si me lo preparas', 'Si son esos'])('«%s» sigue confirmando (el «si» sin tilde)', (t) => expect(confirmacionInequivoca(t)).toBe(true));
  it.each(['si me pasás el total', 'si tenés el alias pasámelo', 'si hay, dale', 'Si te parece bien'])('«%s» es condicional', (t) => expect(confirmacionInequivoca(t)).toBe(false));

  // EL ESPEJO Y EL ORDEN DE LA RPC (5/10/2026, revisión): el «si» condicional se
  // cambia igual en el código y en la base, y la migración del comprobante es la
  // última versión de confirmar_cotizacion_bot (la de 'completo' ya está aplicada
  // y no se vuelve a correr: dejaría dos sobrecargas y ningún pedido se confirmaría)
  it('la migración del comprobante: una sola firma, permisos cerrados, el orden escrito y el mismo «si» condicional que el código', () => {
    const sql: string = require('fs').readFileSync(require('path').join(__dirname, '../../../../db/migracion-bot-pedido-comprobante.sql'), 'utf8');
    expect(sql).toMatch(/drop function if exists public\.confirmar_cotizacion_bot\(uuid, text, text, text, text\);/);
    expect(sql).toMatch(/revoke all on function public\.confirmar_cotizacion_bot\(uuid, text, text, text, text, numeric\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.confirmar_cotizacion_bot\(uuid, text, text, text, text, numeric\) to service_role;/);
    expect(sql).toMatch(/va ANTES del deploy/);
    expect(sql).toMatch(/migracion-bot-pedido-completo\.sql[\s\S]{0,80}YA ESTÁ APLICADA y NO se vuelve a correr/);
    // el regex del «si» condicional de la base, leído con las reglas de JS: en la
    // base \w toma las letras con tilde y \M es el fin de palabra
    const linea = /p_confirmacion ~\* '(\^\\s\*s\[ií\]\\s\+[^']+)'/.exec(sql)?.[1] ?? '';
    expect(linea).not.toBe('');
    const condicionalEnLaBase = new RegExp(linea.replace(/\\w/g, '[\\wáéíóúñ]').replace(/\\M/g, '(?![\\wáéíóúñ])'), 'i');
    for (const t of ['si querés pasame el total', 'Si podés', 'si tenés el alias', 'si hay, dale', 'si me pasás el total', 'Si te parece bien', 'si vos querés'])
      expect([t, condicionalEnLaBase.test(t), confirmacionInequivoca(t)]).toEqual([t, true, false]);
    for (const t of ['Si es correcto', 'Sí te confirmo', 'si te lo confirmo', 'Si son esos', 'Si me lo preparas', 'si dale'])
      expect([t, condicionalEnLaBase.test(t), confirmacionInequivoca(t)]).toEqual([t, false, true]);
  });
});
