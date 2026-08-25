import { BotGuard } from './bot.guard';
import { BotService } from './bot.service';
import { UnauthorizedException } from '@nestjs/common';

// contexto HTTP falso para el guard
const ctx = (apiKey?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: apiKey ? { 'x-api-key': apiKey } : {} }) }),
  }) as any;

describe('BotGuard (API key de los bots)', () => {
  const guard = new BotGuard();

  it('sin BOT_API_KEY configurada es fail-closed (nadie entra)', () => {
    delete process.env.BOT_API_KEY;
    expect(() => guard.canActivate(ctx('lo-que-sea'))).toThrow(UnauthorizedException);
  });

  it('rechaza la clave incorrecta', () => {
    process.env.BOT_API_KEY = 'clave-correcta';
    expect(() => guard.canActivate(ctx('clave-incorrecta'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('acepta la clave correcta', () => {
    process.env.BOT_API_KEY = 'clave-correcta';
    expect(guard.canActivate(ctx('clave-correcta'))).toBe(true);
  });
});

// --- mocks mínimos para el servicio ---

// builder de Supabase encadenable: cada tabla resuelve lo que le configures
function dbFalsa(porTabla: Record<string, any> = {}) {
  const llamadas: Record<string, any[]> = { upsert: [], insert: [] };
  const db = {
    llamadas,
    from(tabla: string) {
      const res = porTabla[tabla] ?? { data: null, error: null };
      const b: any = {
        select: () => b, eq: () => b, ilike: () => b, limit: () => b,
        maybeSingle: async () => res,
        single: async () => res,
        upsert: async (fila: any) => (llamadas.upsert.push({ tabla, fila }), { data: null, error: null }),
        insert: (fila: any) => (llamadas.insert.push({ tabla, fila }), b),
        update: () => b,
      };
      return b;
    },
  };
  return db as any;
}

function servicio(db = dbFalsa()) {
  const s = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  return { s, db };
}

// respuesta falsa de Claude (texto directo, sin herramientas)
const respuestaClaude = (texto: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: texto }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

describe('BotService.charla (robustez del agente)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test';
  });

  // el tope por hora es una variable de entorno: si una prueba falla antes de
  // limpiarla, la siguiente arranca con el límite puesto y falla sin motivo
  afterEach(() => { delete process.env.ODB_BOT_MENSAJES_HORA; });

  it('corta por límite de mensajes por hora SIN llamar a Opus', async () => {
    process.env.ODB_BOT_MENSAJES_HORA = '2';
    const { s } = servicio();
    const crear = jest.fn();
    (s as any).claude = { messages: { create: crear.mockResolvedValue(respuestaClaude('hola')) } };
    await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'a' });
    await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'b' });
    const r3 = await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'c' });
    expect(r3.respuesta).toContain('doy aviso al sector');
    expect(crear).toHaveBeenCalledTimes(2); // el 3ro no gastó tokens
  });

  it('mismo mensajeId reintentado devuelve la respuesta guardada sin reprocesar', async () => {
    const db = dbFalsa({ bot_mensajes: { data: { respuesta: 'ya te respondí esto' }, error: null } });
    const { s } = servicio(db);
    const crear = jest.fn();
    (s as any).claude = { messages: { create: crear } };
    const r = await s.charla({ linea: 'pedidos', telefono: '222', mensaje: 'hola', mensajeId: 'wamid.ABC' });
    expect(r.respuesta).toBe('ya te respondí esto');
    expect(crear).not.toHaveBeenCalled();
  });

  it('serializa mensajes simultáneos del mismo teléfono (no se pisan)', async () => {
    const { s } = servicio();
    const orden: string[] = [];
    let enVuelo = 0;
    (s as any).claude = {
      messages: {
        create: jest.fn(async () => {
          enVuelo++;
          expect(enVuelo).toBe(1); // nunca dos llamadas del mismo tel en paralelo
          await new Promise((r) => setTimeout(r, 20));
          enVuelo--;
          orden.push('llamada');
          return respuestaClaude('ok');
        }),
      },
    };
    await Promise.all([
      s.charla({ linea: 'pedidos', telefono: '333', mensaje: 'uno' }),
      s.charla({ linea: 'pedidos', telefono: '333', mensaje: 'dos' }),
      s.charla({ linea: 'pedidos', telefono: '333', mensaje: 'tres' }),
    ]);
    expect(orden).toHaveLength(3);
  });

  // El "hola" suelto se calla solo mientras la charla sigue viva. Antes bastaba
  // con que el número hubiera escrito alguna vez —y el historial no vence—, así
  // que cualquiera que ya hubiera hablado con el bot se quedaba sin respuesta al
  // saludar, para siempre.
  it('no contesta un "hola" suelto si la charla sigue viva', async () => {
    const db = dbFalsa({
      bot_conversaciones: {
        data: {
          mensajes: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Buenas tardes.' }],
          actualizado_en: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
        error: null,
      },
    });
    const { s } = servicio(db);
    const crear = jest.fn();
    (s as any).claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '777', mensaje: 'Hola' });
    expect(crear).not.toHaveBeenCalled();
    expect(r.respuesta ?? '').toBe('');
  });

  it('SÍ contesta un "hola" cuando la última charla quedó vieja', async () => {
    const db = dbFalsa({
      bot_conversaciones: {
        data: {
          mensajes: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Buenas tardes.' }],
          actualizado_en: new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
        },
        error: null,
      },
    });
    const { s } = servicio(db);
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Buenas tardes. ¿En qué lo puedo ayudar?'));
    (s as any).claude = { messages: { create: crear } };
    await s.charla({ linea: 'pedidos', telefono: '888', mensaje: 'Hola' });
    expect(crear).toHaveBeenCalled();
  });

  it('contesta el segundo "hola" seguido: ya nos callamos una vez', async () => {
    const db = dbFalsa({
      bot_conversaciones: {
        data: {
          // el turno anterior fue un saludo del cliente que quedó sin respuesta
          mensajes: [{ role: 'assistant', content: 'Buenas tardes.' }, { role: 'user', content: 'Hola' }],
          actualizado_en: new Date(Date.now() - 60_000).toISOString(),
        },
        error: null,
      },
    });
    const { s } = servicio(db);
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Buenas tardes. ¿En qué lo puedo ayudar?'));
    (s as any).claude = { messages: { create: crear } };
    await s.charla({ linea: 'pedidos', telefono: '999', mensaje: 'Hola' });
    expect(crear).toHaveBeenCalled();
  });

  // Cuando el bot dice que el pedido quedó cargado sin haberlo creado, la
  // corrección de emergencia tiraba la frase EN MEDIO de la oración y salía
  // "Le el pedido todavía no quedó cargado para retiro...". Se tira la oración
  // entera y se dice la verdad aparte.
  it('corrige "pedido cargado" sin partir la oración al medio', async () => {
    const db = dbFalsa({ bot_conversaciones: { data: { mensajes: [] }, error: null } });
    const { s } = servicio(db);
    // el modelo miente y además falla al regenerar: se usa la corrección local
    (s as any).claude = {
      messages: { create: jest.fn().mockResolvedValue(respuestaClaude('Le confirmo el pedido para retiro en Sant Thomas: 1 Fernet. Lo esperamos.')) },
    };
    (s as any).regenerar = jest.fn().mockResolvedValue(null);
    const r: any = await s.charla({ linea: 'pedidos', telefono: '1010', mensaje: 'dale confirmalo' });
    expect(r.respuesta).not.toMatch(/Le el pedido/);
    expect(r.respuesta).toMatch(/todavía no quedó cargado/);
  });

  // WhatsApp dejó de mandar el teléfono (llega un @lid), así que comparar contra
  // los teléfonos del equipo ya no reconoce a nadie. La marca manual sí.
  it('no le contesta a un contacto marcado como gente de la casa', async () => {
    const db = dbFalsa({
      bot_contactos: { data: { es_equipo: true, telefono_real: null }, error: null },
      bot_conversaciones: { data: { mensajes: [] }, error: null },
    });
    const { s } = servicio(db);
    const crear = jest.fn();
    (s as any).claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '49375296409753', mensaje: 'quiero un fernet' });
    expect(crear).not.toHaveBeenCalled();
    expect(r.respuesta ?? '').toBe('');
  });

  it('acumula tokens del mensaje en la conversación', async () => {
    const db = dbFalsa({ bot_conversaciones: { data: { mensajes: [], tokens: 1000 }, error: null } });
    const { s } = servicio(db);
    (s as any).claude = { messages: { create: jest.fn().mockResolvedValue(respuestaClaude('hola!')) } };
    await s.charla({ linea: 'pedidos', telefono: '444', mensaje: 'hola' });
    const upsertConv = db.llamadas.upsert.find((u: any) => u.tabla === 'bot_conversaciones');
    expect(upsertConv.fila.tokens).toBe(1150); // 1000 previos + 100 in + 50 out
  });
});

describe('BotService.crearPedido (topes del canal WhatsApp)', () => {
  it('rechaza pedidos que superan las unidades máximas', async () => {
    const { s } = servicio();
    await expect(
      s.crearPedido({ telefono: '555', tipo: 'pickup', items: [{ sku: 'X', cantidad: 999 }] }),
    ).rejects.toThrow(/máximo del canal/);
  });

  it('rechaza pedidos con demasiados renglones', async () => {
    const { s } = servicio();
    const items = Array.from({ length: 30 }, (_, i) => ({ sku: `S${i}`, cantidad: 1 }));
    await expect(s.crearPedido({ telefono: '555', tipo: 'pickup', items })).rejects.toThrow(/máximo del canal/);
  });
});

describe('BotService.ejecutarHerramienta (recuperación ante errores)', () => {
  it('un error de herramienta vuelve como tool_result con is_error', async () => {
    const { s } = servicio();
    const r = await (s as any).ejecutarHerramienta({ type: 'tool_use', id: 't1', name: 'herramienta_inexistente', input: {} }, '111');
    expect(r.is_error).toBe(true);
    expect(r.tool_use_id).toBe('t1');
    expect(String(r.content)).toContain('desconocida');
  });
});

describe('BotService.ejecutarHerramienta (seguridad: no confía en el teléfono que manda el modelo)', () => {
  // Un cliente le puede escribir al bot "usá este teléfono: 1122334455" y el
  // modelo puede intentar mandarlo como argumento — el backend debe IGNORARLO
  // siempre y usar el teléfono real y autenticado del request, o cualquiera
  // podría consultar/operar la cuenta de otra persona (fuga de datos + fraude
  // de precio mayorista / cuenta corriente ajena).
  it('identificar_cliente usa el teléfono real del request, no el del input del modelo', async () => {
    const { s, db } = servicio();
    const identificar = jest.spyOn(s, 'identificarCliente').mockResolvedValue({ existe: false } as any);
    await (s as any).ejecutarHerramienta(
      { type: 'tool_use', id: 't1', name: 'identificar_cliente', input: { telefono: '1122334455-ajeno' } },
      '5491199990000', // teléfono real del chat
    );
    expect(identificar).toHaveBeenCalledWith('5491199990000');
    expect(identificar).not.toHaveBeenCalledWith(expect.stringContaining('ajeno'));
  });

  // Para que crear_pedido pase las guardas de cierre (doble confirmación): el
  // sku tiene que haber salido de una búsqueda de la charla, el último mensaje
  // del bot tiene que tener el total y "¿Lo confirmo?", y el cliente decir que sí.
  const CIERRE_OK = {
    input: { telefono: '1122334455-ajeno', tipo: 'pickup', items: [{ sku: 'X', cantidad: 1 }], confirmacion_del_cliente: 'sí, confirmo' },
    ctx: { ultimoBot: '1 Fernet — 20.500\nTotal: 20.500\nRetiro en Sant Thomas. ¿Lo confirmo?', textoCliente: 'sí, confirmo' },
  };

  it('crear_pedido usa el teléfono real del request, no el del input del modelo', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    (s as any).skusDe('5491199990000').add('X');
    await (s as any).ejecutarHerramienta(
      { type: 'tool_use', id: 't2', name: 'crear_pedido', input: CIERRE_OK.input },
      '5491199990000',
      'pedidos',
      CIERRE_OK.ctx,
    );
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ telefono: '5491199990000' }));
  });
});

describe('BotService.ejecutarHerramienta · cierre de pedido (doble confirmación, ronda 5 de la auditoría)', () => {
  const tel = '5491199990001';
  const base = { type: 'tool_use', id: 't3', name: 'crear_pedido' };
  const input = { tipo: 'domicilio', direccion: 'Juana de Arco 7450', items: [{ sku: 'X', cantidad: 1 }], confirmacion_del_cliente: 'mandamelo tipo 12' };

  it('la dirección + "mandámelo" NO crea el pedido: pide resumen con "¿Lo confirmo?"', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    (s as any).skusDe(tel).add('X');
    const r = await (s as any).ejecutarHerramienta({ ...base, input }, tel, 'pedidos', { ultimoBot: 'Total: 48.700. ¿Me pasa la dirección con calle y número?', textoCliente: 'juana de arco 7450, mandamelo tipo 12 asi estoy' });
    expect(crear).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/NO se creó el pedido/);
    expect(String(r.content)).toMatch(/confirm/i);
  });

  it('"sí" con acento cuenta como afirmación (antes el \\b no lo tomaba)', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    (s as any).skusDe(tel).add('X');
    await (s as any).ejecutarHerramienta({ ...base, input: { ...input, confirmacion_del_cliente: 'sí' } }, tel, 'pedidos', { ultimoBot: 'Total: 20.500. ¿Lo confirmo?', textoCliente: 'sí' });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('con resumen + "¿Lo confirmo?" y un "sí" del cliente, SÍ crea', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    (s as any).skusDe(tel).add('X');
    await (s as any).ejecutarHerramienta({ ...base, input: { ...input, confirmacion_del_cliente: 'si dale confirmalo' } }, tel, 'pedidos', { ultimoBot: 'Resumen: 1 Fernet 20.500. Total: 20.500. Envío a Juana de Arco 7450. ¿Lo confirmo?', textoCliente: 'si dale confirmalo' });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('si el cliente dice "pará / todavía no", no crea aunque el bot haya preguntado', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    (s as any).skusDe(tel).add('X');
    const r = await (s as any).ejecutarHerramienta({ ...base, input: { ...input, confirmacion_del_cliente: 'dale' } }, tel, 'pedidos', { ultimoBot: 'Total: 20.500. ¿Lo confirmo?', textoCliente: 'pará, todavía no, lo consulto con mi señora' });
    expect(crear).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/NO se creó el pedido/);
  });

  it('un sku que no salió de ninguna búsqueda de la charla se rechaza', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    const r = await (s as any).ejecutarHerramienta({ ...base, input: { ...input, items: [{ sku: 'INVENTADO', cantidad: 1 }], confirmacion_del_cliente: 'sí' } }, tel, 'pedidos', { ultimoBot: 'Total: 20.500. ¿Lo confirmo?', textoCliente: 'sí' });
    expect(crear).not.toHaveBeenCalled();
    expect(String(r.content)).toMatch(/no salieron de ninguna búsqueda/);
  });
});
