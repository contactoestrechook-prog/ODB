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

  // A un "¿cómo andás?" el bot contestó "Cómo ando y si todo bien no lo puedo
  // responder, soy el asistente automático, no una persona". Nadie que atiende
  // un teléfono anuncia que es un robot sin que se lo pregunten.
  it('saca el discurso de robot cuando nadie preguntó la identidad', async () => {
    const db = dbFalsa({ bot_conversaciones: { data: { mensajes: [] }, error: null } });
    const { s } = servicio(db);
    (s as any).claude = { messages: { create: jest.fn().mockResolvedValue(respuestaClaude(
      'Buen día. Cómo ando no lo puedo responder, soy el asistente automático, no una persona. ¿En qué lo puedo ayudar?',
    )) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '2020', mensaje: 'Jackie, buen día, ¿cómo andás? ¿Todo bien?' });
    expect(r.respuesta).not.toMatch(/asistente|no una persona|no lo puedo responder/i);
    expect(r.respuesta.length).toBeGreaterThan(5);
  });

  // La sigla O.D.B lleva puntos: un corte ingenuo por puntos dejó
  // "gracias.D.B y le tomo la consulta" en producción.
  it('tira la oración de robot ENTERA aunque contenga O.D.B', async () => {
    const db = dbFalsa({ bot_conversaciones: { data: { mensajes: [] }, error: null } });
    const { s } = servicio(db);
    (s as any).claude = { messages: { create: jest.fn().mockResolvedValue(respuestaClaude(
      'Buen día, ¿cómo le va? Todo bien por acá, gracias. Le atiende el asistente de O.D.B y le tomo la consulta. De Coca 2,25 L no tenemos stock.',
    )) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '2022', mensaje: 'buen día, ¿cómo andás? ¿tenés coca de 2,25?' });
    // sin discurso de robot y sin fragmentos huérfanos tipo "gracias.D.B"
    // (el O.D.B de la bienvenida es legítimo)
    expect(r.respuesta).not.toMatch(/asistente|[a-záéíóú]\.D\.B/);
    expect(r.respuesta).toMatch(/Todo bien por acá/);
    expect(r.respuesta).toMatch(/no tenemos stock/);
  });

  it('la identidad SÍ se dice cuando el cliente la pregunta', async () => {
    const db = dbFalsa({ bot_conversaciones: { data: { mensajes: [] }, error: null } });
    const { s } = servicio(db);
    (s as any).claude = { messages: { create: jest.fn().mockResolvedValue(respuestaClaude(
      'Soy el asistente de O.D.B. ¿En qué lo puedo ayudar?',
    )) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '2021', mensaje: '¿sos un bot o una persona?' });
    expect(r.respuesta).toMatch(/asistente/i);
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

describe('BotService.cartelDePedido (tarjeta del pedido confirmado)', () => {
  // La tarjeta se prueba sin red: el "storage" guarda en memoria y devuelve
  // una URL fija. Lo que importa acá es el disparador y el parseo de renglones.
  const conStorageFalso = () => {
    const subidas: string[] = [];
    const falso = {
      db: {
        storage: {
          from: () => ({
            upload: async (ruta: string) => {
              subidas.push(ruta);
              return { error: null };
            },
            getPublicUrl: () => ({ data: { publicUrl: 'https://publico/cartel.png' } }),
          }),
        },
      },
      log: { warn: () => undefined },
    };
    return { falso, subidas };
  };
  const cartel = (respuesta: string) => {
    const { falso } = conStorageFalso();
    return (BotService.prototype as any).cartelDePedido.call(falso, respuesta);
  };

  it('dispara con código de pedido y un renglón con precio, y arma el pie sin las viñetas', async () => {
    const r = await cartel(
      'Confirmado. Código de retiro: PICKUP-ABC123.\n• 2 × Fernet Branca 750 cc — $20.500 c/u = $41.000\n*Total: $41.000*\nSe abona al retirar.',
    );
    expect(r).not.toBeNull();
    expect(r.imagenUrl).toContain('https://');
    expect(r.pie).toContain('PICKUP-ABC123');
    expect(r.pie).not.toContain('•');
  });

  it('toma el importe final del renglón (el "= $X"), no el precio unitario', async () => {
    const { falso } = conStorageFalso();
    const espia = jest
      .spyOn(require('../comun/cartel-precios'), 'cartelPrecios')
      .mockResolvedValue(Buffer.from('png'));
    await (BotService.prototype as any).cartelDePedido.call(
      falso,
      'Pedido DOM-XY99ZZ confirmado:\n• 3 × Coca Cola 1,75 L — $4.700 c/u = $14.100\n*Total: $14.100*',
    );
    const opciones = espia.mock.calls[0][0] as any;
    expect(opciones.titulo).toBe('Pedido DOM-XY99ZZ');
    expect(opciones.renglones).toEqual([{ nombre: '3 × Coca Cola 1,75 L', precio: '$14.100' }]);
    expect(opciones.total).toBe('$14.100');
    espia.mockRestore();
  });

  it('no dispara sin código de pedido, aunque haya renglones con precio', async () => {
    expect(await cartel('Le paso precios:\n• Fernet Branca 750 — $20.500\n• Coca 1,75 — $4.700')).toBeNull();
  });

  it('no dispara con código pero sin ningún renglón con precio', async () => {
    expect(await cartel('Su pedido RET-AB12CD está listo para retirar.')).toBeNull();
  });

  it('si la subida falla, devuelve null y el mensaje sale como texto normal', async () => {
    const falso = {
      db: { storage: { from: () => ({ upload: async () => ({ error: { message: 'sin permiso' } }), getPublicUrl: () => ({ data: { publicUrl: 'x' } }) }) } },
      log: { warn: () => undefined },
    };
    const r = await (BotService.prototype as any).cartelDePedido.call(
      falso,
      'Confirmado RET-AB12CD.\n• 1 × Agua 500 — $900\n*Total: $900*',
    );
    expect(r).toBeNull();
  });
});

describe('emprolijarListado (el total nunca queda pegado al renglón)', () => {
  const { emprolijarListado } = require('./prolijo');

  it('caso ronda 2: total YA en negrita, pegado al renglón y con texto detrás', () => {
    const r = emprolijarListado(
      'Tomo el pedido:\n• 6 × Cerveza Quilmes IPA 473 cc — $2.500 c/u = $15.000 *Total: $15.000* Es el total de la mercadería; el envío va aparte.',
    );
    const lineas = r.split('\n');
    expect(lineas).toContain('• 6 × Cerveza Quilmes IPA 473 cc — $2.500 c/u = $15.000');
    expect(lineas).toContain('*Total: $15.000*');
    expect(r).toMatch(/\*Total: \$15\.000\*\n\nEs el total/);
  });

  it('no duplica la negrita cuando el total ya viene bien escrito en su línea', () => {
    const r = emprolijarListado('• Coca 1,75 L — $4.700\n\n*Total: $4.700*\n\n¿Lo confirmo?');
    expect(r).toContain('*Total: $4.700*');
    expect(r).not.toContain('**');
  });

  it('caso ronda 3: la pregunta pegada a un renglón que termina en paréntesis baja a su línea', () => {
    const r = emprolijarListado(
      'Sí, tenemos hielo:\n• Hielo Bolsa 15 kg — $9.900 (Sant Thomas)\n• Hielo Bolsa 5 kg — $5.800 (solo en Santa Inés, se compra en el mostrador) ¿Cuántas bolsas necesita?',
    );
    expect(r.split('\n')).toContain('• Hielo Bolsa 5 kg — $5.800 (solo en Santa Inés, se compra en el mostrador)');
    expect(r).toMatch(/\n\n¿Cuántas bolsas necesita\?$/);
  });

  it('listado de corrido con guiones queda con viñetas, total y pregunta en sus líneas', () => {
    const r = emprolijarListado(
      'Ya cotizado: - 4 × Agua Glaciar 2 L — $2.300 c/u = $9200 - 2 × Coca Zero — $2.300 c/u = $4.600 Total: $13.800 ¿Lo confirmo?',
    );
    expect(r).toContain('• 4 × Agua Glaciar 2 L — $2.300 c/u = $9.200');
    expect(r).toContain('\n*Total: $13.800*');
    expect(r).toMatch(/\n¿Lo confirmo\?$/);
  });

  it('las líneas del pedido normalizadas las entiende la tarjeta gráfica', async () => {
    const respuesta = emprolijarListado(
      'Confirmado, RET-AB12CD.\n• 2 × Fernet Branca 750 cc — $20.500 c/u = $41.000 *Total: $41.000* Se abona al retirar.',
    );
    const espia = jest
      .spyOn(require('../comun/cartel-precios'), 'cartelPrecios')
      .mockResolvedValue(Buffer.from('png'));
    const falso = {
      db: { storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://publico/x.png' } }) }) } },
      log: { warn: () => undefined },
    };
    const r = await (BotService.prototype as any).cartelDePedido.call(falso, respuesta);
    expect(r).not.toBeNull();
    expect((espia.mock.calls[0][0] as any).renglones).toEqual([
      { nombre: '2 × Fernet Branca 750 cc', precio: '$41.000' },
    ]);
    expect((espia.mock.calls[0][0] as any).total).toBe('$41.000');
    espia.mockRestore();
  });
});

describe('nombreLimpio (un nombre es un nombre o no es nada)', () => {
  const { nombreLimpio } = require('./prolijo');
  it('acepta nombres reales con tildes, apóstrofos y compuestos', () => {
    expect(nombreLimpio('Martín')).toBe('Martín');
    expect(nombreLimpio("  María  del Carmen O'Brien ")).toBe("María del Carmen O'Brien");
  });
  it('descarta la basura de markup que llegó a producción', () => {
    expect(nombreLimpio('</parameter>\n<parameter name="tipo">pickup')).toBeNull();
    expect(nombreLimpio('nombre=Juan; DROP TABLE')).toBeNull();
    expect(nombreLimpio('4 fernet')).toBeNull();
    expect(nombreLimpio('')).toBeNull();
    expect(nombreLimpio(undefined)).toBeNull();
  });
});

describe('saludo universal con bienvenida (según la hora de Buenos Aires)', () => {
  const { saludoSegunHora, saludarConBienvenida } = require('./prolijo');

  it('el saludo acompaña el reloj: día hasta las 13, tarde hasta las 20, noche después', () => {
    expect(saludoSegunHora(8)).toBe('Buen día');
    expect(saludoSegunHora(12)).toBe('Buen día');
    expect(saludoSegunHora(13)).toBe('Buenas tardes');
    expect(saludoSegunHora(19)).toBe('Buenas tardes');
    expect(saludoSegunHora(20)).toBe('Buenas noches');
    expect(saludoSegunHora(23)).toBe('Buenas noches');
  });

  it('corrige el saludo del modelo cuando imaginó otra hora y suma la bienvenida', () => {
    const r = saludarConBienvenida('Buen día. El Fernet Branca de 750 cc está $20.500. ¿Cuántas botellas necesita?', 'Buenas noches');
    expect(r).toBe('Buenas noches, le damos la bienvenida a O.D.B. El Fernet Branca de 750 cc está $20.500. ¿Cuántas botellas necesita?');
  });

  it('si el modelo no saludó, el saludo y la bienvenida se anteponen', () => {
    const r = saludarConBienvenida('El local abre a las 9.', 'Buenas tardes');
    expect(r).toBe('Buenas tardes, le damos la bienvenida a O.D.B. El local abre a las 9.');
  });

  it('no duplica la bienvenida si el modelo ya la dio', () => {
    const r = saludarConBienvenida('Buenas tardes, bienvenido a O.D.B. ¿Qué necesita?', 'Buenas tardes');
    expect(r).toBe('Buenas tardes. Bienvenido a O.D.B. ¿Qué necesita?');
    expect((r.match(/bienvenid/gi) ?? []).length).toBe(1);
  });

  it('"Hola, buen día" no queda duplicado ni suelto', () => {
    const r = saludarConBienvenida('Hola, buen día, ¿cómo le va? Todo bien por acá.', 'Buen día');
    expect(r).toBe('Buen día, le damos la bienvenida a O.D.B. ¿cómo le va? Todo bien por acá.');
  });

  it('un saludo solo se completa con el ofrecimiento de ayuda', () => {
    expect(saludarConBienvenida('Buenas tardes.', 'Buenas noches')).toBe(
      'Buenas noches, le damos la bienvenida a O.D.B. ¿En qué lo puedo ayudar?',
    );
  });
});
