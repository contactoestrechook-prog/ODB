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
  const s = new BotService(db, {} as any, {} as any, {} as any);
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

  it('corta por límite de mensajes por hora SIN llamar a Opus', async () => {
    process.env.ODB_BOT_MENSAJES_HORA = '2';
    const { s } = servicio();
    const crear = jest.fn();
    (s as any).claude = { messages: { create: crear.mockResolvedValue(respuestaClaude('hola')) } };
    await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'a' });
    await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'b' });
    const r3 = await s.charla({ linea: 'pedidos', telefono: '111', mensaje: 'c' });
    expect(r3.respuesta).toContain('una persona');
    expect(crear).toHaveBeenCalledTimes(2); // el 3ro no gastó tokens
    delete process.env.ODB_BOT_MENSAJES_HORA;
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

  it('crear_pedido usa el teléfono real del request, no el del input del modelo', async () => {
    const { s } = servicio();
    const crear = jest.spyOn(s, 'crearPedido').mockResolvedValue({ pedidoId: 'x' } as any);
    await (s as any).ejecutarHerramienta(
      {
        type: 'tool_use',
        id: 't2',
        name: 'crear_pedido',
        input: { telefono: '1122334455-ajeno', tipo: 'pickup', items: [{ sku: 'X', cantidad: 1 }] },
      },
      '5491199990000',
    );
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ telefono: '5491199990000' }));
  });
});
