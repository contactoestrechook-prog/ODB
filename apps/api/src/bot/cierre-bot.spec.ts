import { BotService } from './bot.service';

// EL "NADA MÁS" CONFIRMA y LAS PICADAS VAN A NOMBRE DE ALGUIEN (3/10/2026).
// Pedido de Leandro: "una vez que ya dijo nada más no tiene que preguntar todo
// el tiempo si lo confirma" y "cuando es picada, al final le pregunta con qué
// nombre la retira".

function baseFalsa(tablas: Record<string, any> = {}) {
  const escrituras: { tabla: string; operacion: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: 'pedido-1', error: null })),
    from(tabla: string) {
      const res = tablas[tabla] ?? { data: null, error: null };
      const b: any = {};
      for (const k of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'range', 'ilike']) b[k] = () => b;
      for (const k of ['insert', 'update', 'upsert']) b[k] = (fila: any) => { escrituras.push({ tabla, operacion: k, fila }); return b; };
      b.single = b.maybeSingle = async () => res;
      b.then = (ok: any, err: any) => Promise.resolve(res).then(ok, err);
      return b;
    },
  };
  return db;
}
const servicio = (db = baseFalsa()) => new BotService(db, {} as any, {} as any, {} as any, {} as any);

const LISTA = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';
const PREPARADO = {
  cotizacionId: 'cot-1',
  resumen: '• Combo Picada Box — 3 × $44.500 = $133.500\nTotal: $133.500\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?',
  total: 133500,
  renglones: [{ cantidad: 3, nombre: 'Combo Picada Box' }],
};
const preparar = { type: 'tool_use', id: 'p1', name: 'preparar_pedido', input: { tipo: 'pickup', items: [{ sku: 'PICADA', cantidad: 3 }] } };

describe('preparar_pedido con la lista cerrada confirma el pedido', () => {
  const ctxBase = () => ({ ultimoBot: LISTA, ultimosBot: [LISTA], ultimosCliente: ['3 picadas', 'Solo eso…'], textoCliente: 'Solo eso…', fallos: new Map<string, number>(), fija: {} as any });

  it('"Solo eso…" y lo cotizado es lo anotado: crea el pedido en modo completo y la respuesta es la confirmación', async () => {
    const s = servicio();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREPARADO as any);
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x', codigoRetiro: 'PICKUP-ABC123ABC123', total: 133500, estado: 'recibido', respuesta: 'Pedido PICKUP-ABC123ABC123 confirmado. Total: $133.500.' } as any);
    const ctx = { ...ctxBase(), cierre: 'Solo eso…', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    const r = await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(crear).toHaveBeenCalledWith({ telefono: '5491100000000', linea: 'pedidos', confirmacion: 'Solo eso…', modo: 'completo', cotizacionId: 'cot-1' });
    expect(ctx.fija.texto).toMatch(/^Pedido PICKUP-ABC123ABC123 confirmado\./);
    expect(ctx.fija.texto).not.toMatch(/lo confirmo/i);
    expect(ctx.fallos.get('__pedido_creado__')).toBe(1);
    expect(String(r.content)).toMatch(/QUEDÓ CONFIRMADO/);
  });

  it('sin la lista cerrada queda el resumen con "¿Lo confirmo?"', async () => {
    const s = servicio();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREPARADO as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const ctx = { ...ctxBase(), cierre: null, anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(crear).not.toHaveBeenCalled();
    expect(ctx.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });

  it('si el modelo cotizó otra cantidad que la anotada, vuelve a pedir confirmación', async () => {
    const s = servicio();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue({ ...PREPARADO, renglones: [{ cantidad: 4, nombre: 'Combo Picada Box' }] } as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const ctx = { ...ctxBase(), cierre: 'Solo eso…', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(crear).not.toHaveBeenCalled();
    expect(ctx.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });

  it('si la base lo rechaza, queda el resumen con "¿Lo confirmo?"', async () => {
    const s = servicio();
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREPARADO as any);
    jest.spyOn(s, 'crearPedido').mockRejectedValue(new Error('El cliente no cerro la lista'));
    const ctx = { ...ctxBase(), cierre: 'Solo eso…', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(ctx.fija.texto).toBe(PREPARADO.resumen);
    expect(ctx.fallos.get('__pedido_creado__')).toBeUndefined();
  });

  it('con un pedido ya confirmado en el turno, no prepara otro', async () => {
    const s = servicio();
    const prep = jest.spyOn(s, 'prepararPedido');
    const ctx = { ...ctxBase(), cierre: 'Solo eso…', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    ctx.fallos.set('__pedido_creado__', 1);
    const r = await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(prep).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/ya quedó confirmado/);
  });
});

describe('crearPedido en modo completo', () => {
  const cotizacion = (extra: any = {}) => ({
    id: 'cot-1', resumen: 'RESUMEN', tipo: 'pickup', total: 133500, notas: null, creada_en: new Date().toISOString(),
    confirmada_en: null, entrega_fecha: '2026-10-04', entrega_franja: 'mañana',
    items: [{ producto_id: 'p1', nombre: 'Combo Picada Box', cantidad: 3, subtotal: 133500 }], ...extra,
  });
  const conPedido = (s: BotService) => { (s as any).pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-ABC123ABC123', total: 133500, estado: 'recibido' })) }; return s; };

  it('pasa p_modo "completo" a la base y no pregunta "¿Lo confirmo?"', async () => {
    const db = baseFalsa({ bot_cotizaciones: { data: cotizacion() } });
    const s = conPedido(servicio(db));
    const r = await s.crearPedido({ telefono: '111', confirmacion: 'Solo eso…', modo: 'completo', cotizacionId: 'cot-1' });
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot', { p_id: 'cot-1', p_telefono: '111', p_linea: 'pedidos', p_confirmacion: 'Solo eso…', p_modo: 'completo' });
    expect(r.respuesta).toBe('Pedido PICKUP-ABC123ABC123 confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas, el domingo 4/10 por la mañana. Se abona al retirar, en efectivo o tarjeta.\n\n¿A nombre de quién lo retiran?');
  });

  it('solo con la cotización recién guardada en este turno', async () => {
    const otra = conPedido(servicio(baseFalsa({ bot_cotizaciones: { data: cotizacion({ id: 'cot-vieja' }) } })));
    await expect(otra.crearPedido({ telefono: '111', confirmacion: 'Solo eso…', modo: 'completo', cotizacionId: 'cot-1' })).rejects.toThrow(/resumen verificable/);
    const vieja = conPedido(servicio(baseFalsa({ bot_cotizaciones: { data: cotizacion({ creada_en: new Date(Date.now() - 5 * 60_000).toISOString() }) } })));
    await expect(vieja.crearPedido({ telefono: '111', confirmacion: 'Solo eso…', modo: 'completo', cotizacionId: 'cot-1' })).rejects.toThrow(/resumen verificable/);
    const sinId = conPedido(servicio(baseFalsa({ bot_cotizaciones: { data: cotizacion() } })));
    await expect(sinId.crearPedido({ telefono: '111', confirmacion: 'Solo eso…', modo: 'completo' })).rejects.toThrow(/confirmación inequívoca/);
  });

  it('"Solo eso…" sin modo completo sigue sin confirmar', async () => {
    const db = baseFalsa({ bot_cotizaciones: { data: cotizacion() } });
    await expect(conPedido(servicio(db)).crearPedido({ telefono: '111', confirmacion: 'Solo eso…', resumenPresentado: 'RESUMEN' })).rejects.toThrow(/confirmación inequívoca/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('a nombre de quién se retira', () => {
  const cotizacion = (extra: any = {}) => ({
    id: 'q', resumen: 'RESUMEN', tipo: 'pickup', total: 20500, notas: null, creada_en: new Date().toISOString(), confirmada_en: null,
    items: [{ producto_id: 'p1', nombre: 'Fernet Branca 750 cc', cantidad: 1, subtotal: 20500 }], ...extra,
  });
  const crear = (db: any) => {
    const s = servicio(db);
    (s as any).pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-1', total: 20500, estado: 'recibido' })) };
    return s.crearPedido({ telefono: '111', confirmacion: 'sí', resumenPresentado: 'RESUMEN' });
  };

  it('sin picadas no se pregunta', async () => {
    const r = await crear(baseFalsa({ bot_cotizaciones: { data: cotizacion() }, productos: { data: [] } }));
    expect(r.respuesta).not.toMatch(/a nombre de/i);
    expect(r.respuesta).toBe('Pedido PICKUP-1 confirmado. Total: $20.500.\nRetiro en la sucursal Saint Thomas. Se abona al retirar, en efectivo o tarjeta.');
  });

  it('un producto marcado "se arma a pedido" también lleva la pregunta', async () => {
    const r = await crear(baseFalsa({ bot_cotizaciones: { data: cotizacion() }, productos: { data: [{ id: 'p1' }] } }));
    expect(r.respuesta).toMatch(/\n\n¿A nombre de quién lo retiran\?$/);
  });

  it('para envío no se pregunta (ya está quién recibe), y si ya dijo quién retira, tampoco', async () => {
    const picada = [{ producto_id: 'p1', nombre: 'Picada ODB XL', cantidad: 1, subtotal: 20500 }];
    const envio = await crear(baseFalsa({ bot_cotizaciones: { data: cotizacion({ tipo: 'domicilio', direccion: 'Los Robles 123, Canning', items: picada }) } }));
    expect(envio.respuesta).toBe('Pedido PICKUP-1 confirmado. Total: $20.500.\nEnvío sin cargo a Los Robles 123, Canning. Se abona al recibir, en efectivo o tarjeta.');
    const dicho = await crear(baseFalsa({ bot_cotizaciones: { data: cotizacion({ items: picada, notas: 'Retira: Ana Gómez' }) } }));
    expect(dicho.respuesta).not.toMatch(/a nombre de/i);
  });

  it('la respuesta queda en las notas del pedido del código, sin pisar las que había', async () => {
    const db = baseFalsa({
      bot_cotizaciones: { data: { id: 'cot-1' } },
      pedidos: { data: { id: 'ped-1', notas: 'Paga con efectivo · Retira: otro', estado: 'recibido' } },
    });
    expect(await (servicio(db) as any).anotarQuienRetira('111', 'pedidos', 'PICKUP-ABC123ABC123', 'Juan Pérez')).toBe(true);
    expect(db.escrituras).toContainEqual({ tabla: 'pedidos', operacion: 'update', fila: { notas: 'Paga con efectivo · Retira: Juan Pérez' } });
  });

  it('un pedido de otro chat, o cancelado, no se anota', async () => {
    const ajeno = baseFalsa({ bot_cotizaciones: { data: null }, pedidos: { data: { id: 'ped-1', notas: null, estado: 'recibido' } } });
    expect(await (servicio(ajeno) as any).anotarQuienRetira('111', 'pedidos', 'PICKUP-ABC123ABC123', 'Juan')).toBe(false);
    expect(ajeno.escrituras).toEqual([]);
    const cancelado = baseFalsa({ bot_cotizaciones: { data: { id: 'cot-1' } }, pedidos: { data: { id: 'ped-1', notas: null, estado: 'cancelado' } } });
    expect(await (servicio(cancelado) as any).anotarQuienRetira('111', 'pedidos', 'PICKUP-ABC123ABC123', 'Juan')).toBe(false);
    expect(cancelado.escrituras).toEqual([]);
  });

  it('con un pedido de este chat confirmado hace minutos (un reintento), no confirma otro: queda el "¿Lo confirmo?"', async () => {
    const s = servicio(baseFalsa({ bot_cotizaciones: { data: { id: 'cot-0' } } }));
    jest.spyOn(s, 'prepararPedido').mockResolvedValue(PREPARADO as any);
    const crear = jest.spyOn(s, 'crearPedido');
    const ctx = { ultimoBot: LISTA, ultimosBot: [LISTA], ultimosCliente: ['3 picadas', 'Solo eso…'], textoCliente: 'Solo eso…', fallos: new Map<string, number>(), fija: {} as any, cierre: 'Solo eso…', anotado: [{ cantidad: 3, nombre: 'Combo Picada Box' }] };
    await (s as any).ejecutarHerramienta(preparar, '5491100000000', 'pedidos', ctx);
    expect(crear).not.toHaveBeenCalled();
    expect(ctx.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });
});
