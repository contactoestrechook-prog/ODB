// EL PAGO Y LA CONSULTA EN EL MISMO TURNO (5/10/2026). Los dos arreglos de la
// charla de Pablo (vinos a España) se tocan en el armado final de la respuesta:
// la consulta (desde el 6/10/2026 SILENCIOSA: al cliente no se le dice nada de
// ella) y el cierre por comprobante («Recibido.» que no se pisa, el pedido que
// crea el comprobante, el alias con el total). Estas pruebas fijan qué le llega
// al cliente cuando pasan las dos cosas juntas: el texto fijo tal cual.
import { BotService } from './bot.service';

process.env.ANTHROPIC_API_KEY ??= 'test';

// base falsa por operación y por cómo termina la consulta (maybeSingle o await)
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
const M18 = '• Judas Malbec x750cc — 2 × $79.900 c/u = $159.800\n• Catena Zapata Malbec Argentino — 1 × $73.800 c/u = $73.800\n• Conjuro Bressia — 1 × $83.500 c/u = $83.500\nTotal: $317.100\nPagando en efectivo o transferencia: $285.390 (10% off en vinos, destilados, aperitivos, estuchería y espumantes).\nRetiro en la sucursal Saint Thomas.\nIndicaciones: Retira en un rato. Paga por transferencia.\n¿Lo confirmo?';
const M20 = 'Perfecto, mandame el comprobante por acá cuando lo hagas.';
const URL_PDF = 'https://x.supabase.co/publico/whatsapp/1/comprobante.pdf';
const PDF64 = 'JVBERi0xLjQKJcTl';
const PREP = { cotizacionId: 'cot-1', resumen: M18, total: 317100, renglones: [] };
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
const CAJA = 'Cliente Pablo lleva 4 botellas a España en valija: ¿tenemos caja o embalaje de protección para darle?';
const tu = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const resp = (content: any[], stop = 'tool_use') => ({ stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });
const consultarCaja = (id = 'c') => tu(id, 'consultar_interno', { area: 'local', consulta: CAJA, tema: 'la caja para viajar', direccion: '' });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: any) => e.tabla === tabla && e.op === 'insert');

function armar(o: { conversacion?: any[]; consultasAbiertas?: any[]; pagosAbiertos?: any[]; importeLeido?: number | null } = {}) {
  const db = dbPorOperacion({
    lineas_whatsapp: { select: { data: CFG } },
    alertas_internas: { select: { data: null } },
    bot_contactos: { select: { data: { nombre: 'Pablo' } } },
    bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: [COT] } : { data: COT }) },
    bot_pagos_en_confirmacion: { select: { data: o.pagosAbiertos ?? [] } },
    bot_consultas_internas: { select: { data: o.consultasAbiertas ?? [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    bot_conversaciones: { select: { data: { mensajes: o.conversacion ?? HIST, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] } } },
  });
  db.rpc.mockImplementation(async (nombre: string) => (nombre === 'confirmar_cotizacion_bot' ? { data: 'pedido-1', error: null } : { data: null, error: null }));
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-00D163566DEF', total: 317100, estado: 'recibido' })) };
  const s: any = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  const envios: any[] = [];
  s.enviarPorWhatsapp = jest.fn(async (p: any) => (envios.push(p), { enviado: true, id: `W${envios.length}` }));
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  const principal: any[] = [];
  const llamadas: any[] = [];
  // la lectura aparte del comprobante se reconoce por la salida estructurada
  const create = jest.fn(async (p: any) => {
    llamadas.push(p);
    if (p?.output_config?.format) {
      return resp([{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ importe: o.importeLeido === undefined ? 285390 : o.importeLeido }) }], 'end_turn');
    }
    return principal.shift() ?? resp([{ type: 'text', text: 'Perfecto, Pablo.' }], 'end_turn');
  });
  s.claude = { messages: { create } };
  return { s, db, envios, principal, llamadas };
}

describe('el comprobante y la consulta en el mismo turno', () => {
  it('PDF que no coincide + consulta nueva: al cliente «Recibido.» y nada más (no el texto del modelo); la consulta queda registrada', async () => {
    const { s, db, principal } = armar();
    principal.push(resp([tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 250000, motivo: 'Transfirió $250.000', de_quien: 'Pablo' }), consultarCaja()]));
    principal.push(resp([{ type: 'text', text: 'Perfecto, Pablo, ya tengo tu transferencia acreditada.' }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo del embalaje para el avión?', archivoBase64: PDF64, mimeType: 'application/pdf', archivoUrl: URL_PDF });
    expect(r.respuesta).toBe('Recibido.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });

  it('PDF que coincide + consulta nueva: la confirmación del pedido tal cual, sin nada de la consulta', async () => {
    const { s, db, principal } = armar();
    principal.push(resp([tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'Transfirió $285.390', de_quien: 'Pablo' }), consultarCaja()]));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo del embalaje para el avión?', archivoBase64: PDF64, mimeType: 'application/pdf', archivoUrl: URL_PDF });
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.objectContaining({ p_modo: 'comprobante', p_monto: 285390 }));
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('«Ahí te pase el comprobante» sin archivo (ya registrado) y el modelo vuelve a preparar el resumen: «Recibido.», no el resumen otra vez', async () => {
    const previo = { id: 'c76', monto: 285390, confirmado_en: null, creado_en: new Date(Date.now() - 100_000).toISOString() };
    const { s, db, envios, principal } = armar({ pagosAbiertos: [previo] });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    principal.push(resp([tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'mandó comprobante', de_quien: 'Pablo' }), tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] })]));
    principal.push(resp([{ type: 'text', text: M18 }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ahí te pase el comprobante de tranfernacia' });
    expect(r.respuesta).toBe('Recibido.');
    expect(envios).toHaveLength(0);
    expect(insertsDe(db, 'bot_pagos_en_confirmacion')).toHaveLength(0);
  });
});

describe('el texto fijo de una operación y la consulta en el mismo turno', () => {
  it('preparar_pedido + consulta nueva: el resumen tal cual, con «¿Lo confirmo?» última y nada de la consulta', async () => {
    const { s, principal } = armar({ conversacion: HIST.slice(0, 2) });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    principal.push(resp([consultarCaja(), tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] })]));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Pasame el total. ¿Y tienen caja para llevarlas en la valija?' });
    expect(r.respuesta).toBe(M18);
    expect(r.respuesta.match(/¿Lo confirmo\?/g)).toHaveLength(1);
  });

  it('preparar_pedido + la misma consulta ya abierta: el resumen tal cual, sin otra consulta', async () => {
    const abierta = { id: 'q-vieja', area: 'local', consulta: CAJA, tema: 'la caja para viajar', waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString() };
    const { s, db, envios, principal } = armar({ conversacion: HIST.slice(0, 2), consultasAbiertas: [abierta] });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREP as any);
    principal.push(resp([consultarCaja(), tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] })]));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Pasame el total. ¿Y lo de la caja para la valija?' });
    expect(r.respuesta).toBe(M18);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(envios).toHaveLength(0);
  });

  it('el alias + consulta nueva (sin resumen): los datos de pago, sin nada de la consulta ni el texto del modelo', async () => {
    const { s, principal } = armar({ conversacion: HIST.slice(0, 4) });
    principal.push(resp([tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias', monto: 0 }), consultarCaja()]));
    principal.push(resp([{ type: 'text', text: 'Ahí te paso los datos para transferir.' }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿A dónde te transfiero? ¿Y tienen caja para llevarlas en la valija?' });
    expect(r.respuesta).toBe('Alias: outlet.de.bebidas · CBU: 0720000000000000000000 · Titular: Chinvenguencha SRL (Santander). Cuando transfieras, mandame el comprobante por acá.');
  });
});

describe('el orden de la limpieza final', () => {
  it('«Decime «confirmo»» se va, y el envío sin cargo se dice igual si lo preguntó (asegurarEnvioSinCargo al final)', async () => {
    const { s, principal } = armar({ conversacion: HIST.slice(0, 4) });
    principal.push(resp([{ type: 'text', text: 'El envío es sin cargo, decime «confirmo» y avanzamos.' }], 'end_turn'));
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Cuánto me cobran el envío a Palermo?' });
    expect(r.respuesta).not.toMatch(/dec[ií]me\s*«?confirmo/i);
    expect(r.respuesta).toMatch(/^El envío es sin cargo en pedidos desde \$70\.000\./);
  });

  it('ninguna llamada a Claude del turno va sin razonamiento', async () => {
    const { s, principal, llamadas } = armar();
    principal.push(resp([tu('d', 'derivar_pago', { tipo: 'comprobante_enviado', monto: 285390, motivo: 'Transfirió $285.390', de_quien: 'Pablo' }), consultarCaja()]));
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo del embalaje para el avión?', archivoBase64: PDF64, mimeType: 'application/pdf', archivoUrl: URL_PDF });
    expect(llamadas.length).toBeGreaterThanOrEqual(2);
    for (const p of llamadas) expect(p.thinking?.type === 'adaptive' || (p.thinking?.type === 'enabled' && p.thinking.budget_tokens >= 1024 && p.max_tokens > p.thinking.budget_tokens)).toBe(true);
  });
});
