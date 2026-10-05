// EL «NADA MÁS» Y EL COMPROBANTE JUNTOS (5/10/2026, unión de main con el
// arreglo publicado). Main trajo el «nada más» que confirma (apagado con
// ODB_NADA_MAS_CONFIRMA), la pregunta del nombre para las picadas y la tarjeta
// del pedido confirmado; la rama publicada, el comprobante que confirma el
// pedido, el alias junto con el total y la limpieza de las promesas. Acá se
// prueba lo que aparece recién cuando están las dos cosas.
import { BotService } from './bot.service';
import { sinLoConsulto } from './prolijo';
import { sinPedirConfirmo } from './pago-confirma';

// base falsa por operación (como la de pago-confirma.spec.ts)
type Consulta = { op: string; terminal: string; filtros: any[][] };
function dbPorOperacion(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: 'pedido-1', error: null })),
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
const COT = {
  id: '00d16356-6def-445c-8169-c7f07b9cdf08', total: 133500, tipo: 'pickup', direccion: null, notas: null, resumen: 'RESUMEN',
  creada_en: new Date(Date.now() - 20 * 60_000).toISOString(), confirmada_en: null, pedido_id: null, entrega_fecha: null, entrega_franja: null,
  items: [{ producto_id: 'p1', nombre: 'Combo Picada Box', cantidad: 3, subtotal: 133500 }],
};
const tu = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const resp = (content: any[], stop = 'tool_use') => ({ stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } });

function armar(o: { cotizacion?: any; conversacion?: any[] } = {}) {
  const cot = o.cotizacion === undefined ? COT : o.cotizacion;
  const db = dbPorOperacion({
    lineas_whatsapp: { select: { data: CFG } },
    alertas_internas: { select: { data: null } },
    bot_contactos: { select: { data: { nombre: 'Pablo' } } },
    bot_cotizaciones: { select: (q: Consulta) => (q.terminal === 'then' ? { data: cot ? [cot] : [] } : { data: cot }) },
    bot_pagos_en_confirmacion: { select: { data: [] } },
    productos: { select: { data: [] } },
    bot_conversaciones: { select: { data: o.conversacion ? { mensajes: o.conversacion, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] } : null } },
  });
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-00D163566DEF', total: 133500, estado: 'recibido' })) };
  const s = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  (s as any).enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W1' }));
  (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
  const create = jest.fn(async () => resp([{ type: 'text', text: 'Dale.' }], 'end_turn'));
  (s as any).claude = { messages: { create } };
  return { s, db, create };
}

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });
afterEach(() => { delete process.env.ODB_NADA_MAS_CONFIRMA; });

describe('crearPedido con los tres modos', () => {
  it('«sí»: los 4 parámetros de siempre; «completo»: p_modo sin p_monto; «comprobante»: p_modo y p_monto', async () => {
    const reciente = { ...COT, creada_en: new Date().toISOString() };
    const si = armar({ cotizacion: reciente });
    await si.s.crearPedido({ telefono: TEL, confirmacion: 'sí', resumenPresentado: 'RESUMEN' });
    expect(si.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'sí' });

    const completo = armar({ cotizacion: reciente });
    await completo.s.crearPedido({ telefono: TEL, confirmacion: 'Solo eso', modo: 'completo', cotizacionId: COT.id });
    expect(completo.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: 'Solo eso', p_modo: 'completo' });

    const comprobante = armar();
    const r = await comprobante.s.crearPedido({ telefono: TEL, confirmacion: '[el cliente mandó este PDF]', modo: 'comprobante', monto: 133500, cotizacionId: COT.id });
    expect(comprobante.db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: COT.id, p_telefono: TEL, p_linea: 'pedidos', p_confirmacion: '[el cliente mandó este PDF]', p_modo: 'comprobante', p_monto: 133500 });
    // con el interruptor apagado (como está publicado), la respuesta de la rama tal cual
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
  });

  it('cada modo con su guarda: «completo» solo la recién guardada, «comprobante» solo la evaluada y con monto', async () => {
    // la del comprobante tiene 20 minutos: para «completo» ya no es la recién guardada
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'Solo eso', modo: 'completo', cotizacionId: COT.id })).rejects.toThrow(/resumen verificable/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: 'otra', monto: 133500 })).rejects.toThrow(/resumen verificable/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id })).rejects.toThrow(/confirmación inequívoca/);
    await expect(armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id, monto: 133500 })).resolves.toBeTruthy();
  });

  it('con el «nada más» prendido, el retiro con picadas confirmado por el comprobante también pregunta a nombre de quién', async () => {
    process.env.ODB_NADA_MAS_CONFIRMA = '1';
    const r = await armar().s.crearPedido({ telefono: TEL, confirmacion: 'x', modo: 'comprobante', cotizacionId: COT.id, monto: 133500 });
    expect(r.respuesta).toBe('Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.\n\n¿A nombre de quién lo retiran?');
  });
});

describe('el «nada más» con el alias pedido en el mismo turno', () => {
  it('la confirmación lleva los datos de pago abajo (el alias no se pierde)', async () => {
    const { s } = armar({ cotizacion: null });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-1', resumen: '• Combo Picada Box — 3 × $44.500 = $133.500\nTotal: $133.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?', total: 133500, renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }] } as any);
    jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x', codigoRetiro: 'PICKUP-ABC123ABC123', total: 133500, estado: 'recibido', respuesta: 'Pedido PICKUP-ABC123ABC123 confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.' } as any);
    const lista = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';
    const c: any = { ultimoBot: lista, ultimosBot: [lista], ultimosCliente: ['3 picadas', 'Solo eso, pasame el alias'], textoCliente: 'Solo eso, pasame el alias', fallos: new Map(), fija: {}, cierre: 'Solo eso', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(tu('d', 'derivar_pago', { tipo: 'quiere_pagar', motivo: 'pide alias', monto: 0 }), TEL, 'pedidos', c);
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    expect(c.fija.texto).toMatch(/^Pedido PICKUP-ABC123ABC123 confirmado\./);
    expect(c.fija.texto).toContain('Alias: outlet.de.bebidas');
    expect(c.fija.texto).not.toMatch(/¿Lo confirmo\?/);
    expect(c.fallos.get('__pedido_creado__')).toBe(1);
  });

  it('con un comprobante en el turno, el «nada más» no confirma: va «Recibido.»', async () => {
    const { s } = armar({ cotizacion: null });
    jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-1', resumen: 'Total: $133.500\n¿Lo confirmo?', total: 133500, renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }] } as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const c: any = { ultimoBot: 'x', ultimosBot: ['x'], ultimosCliente: ['Solo eso'], textoCliente: 'Solo eso', fallos: new Map([['__comprobante__', 1]]), fija: { texto: 'Recibido.' }, cierre: 'Solo eso', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(tu('p', 'preparar_pedido', { tipo: 'pickup', items: [] }), TEL, 'pedidos', c);
    expect(crear).not.toHaveBeenCalled();
    expect(c.fija.texto).toBe('Recibido.');
  });
});

describe('el «sí» de más después de una confirmación', () => {
  it.each([
    ['la de main (dónde y cómo se paga)', 'Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.'],
    ['con la frase del envío adelante', 'El envío es sin cargo. Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.'],
    ['la del comprobante', 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.'],
  ])('%s: un «Sí, gracias» se calla (no arma otro pedido)', async (_n, conf) => {
    const { s, create, db } = armar({ conversacion: [{ role: 'user', content: 'Sí' }, { role: 'assistant', content: conf }] });
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Sí, gracias' });
    expect(r.respuesta ?? null).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith('confirmar_cotizacion_bot', expect.anything());
  });
});

describe('la tarjeta del pedido confirmado por el comprobante', () => {
  const falso = () => {
    const consulta: any = { select: () => consulta, eq: () => consulta, maybeSingle: async () => ({ data: { id: 'p1', destino_direccion: null, entrega_fecha: null, entrega_franja: null, pedidos_items: [{ cantidad: 3, precio_unitario: 44500, productos: { nombre: 'Combo Picada Box' } }] } }) };
    return {
      db: { from: () => consulta, storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://publico/cartel.png' } }) }) } },
      log: { warn: () => undefined },
      subirPaginas: (BotService.prototype as any).subirPaginas,
    };
  };

  it('el pie no repite «Pedido confirmado.» ni el código: «Recibido. Tu pedido quedó confirmado.»', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const r = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.');
    expect(r.pie).toBe('Recibido. Tu pedido quedó confirmado.');
    expect((espia.mock.calls[0][0] as any).subtitulo).toBe('PICKUP-00D163566DEF');
    // con la pregunta del nombre (el «nada más» prendido), la pregunta queda al final, aparte
    const r2 = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Recibido. Tu pedido PICKUP-00D163566DEF quedó confirmado para retirar en la sucursal Saint Thomas.\n\n¿A nombre de quién lo retiran?');
    expect(r2.pie).toBe('Recibido. Tu pedido quedó confirmado.\n\n¿A nombre de quién lo retiran?');
    espia.mockRestore();
  });

  it('la confirmación por el «sí» sigue como en main', async () => {
    const espia = jest.spyOn(require('../comun/cartel-pedido'), 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
    const r = await (BotService.prototype as any).cartelDePedido.call(falso(), 'Pedido PICKUP-00D163566DEF confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.');
    expect(r.pie).toBe('Pedido confirmado. Se abona al retirar, en efectivo o tarjeta.');
    espia.mockRestore();
  });
});

describe('la limpieza final sin aplanar ni dejar huecos (quitarOraciones)', () => {
  it('sinLoConsulto saca el renglón entero y la lista queda en sus renglones', () => {
    expect(sinLoConsulto('Te anoto:\n• 2 × Judas Malbec 750 cc\nLo consulto con el local.\n\n¿Está completo el pedido o querés sumar algo?'))
      .toBe('Te anoto:\n• 2 × Judas Malbec 750 cc\n\n¿Está completo el pedido o querés sumar algo?');
    expect(sinLoConsulto('Del Catena no tengo ahora. Lo consulto. ¿Te sirve el Judas?')).toBe('Del Catena no tengo ahora. ¿Te sirve el Judas?');
  });

  it('sinPedirConfirmo tampoco deja un renglón vacío en el medio', () => {
    expect(sinPedirConfirmo('Total: $317.100\nDecime «confirmo» y lo dejo preparado.\nRetiro en la sucursal Saint Thomas.'))
      .toBe('Total: $317.100\nRetiro en la sucursal Saint Thomas.');
  });
});
