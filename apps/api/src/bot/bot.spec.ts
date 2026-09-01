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
        // el builder real de Supabase es "thenable": await db.from(...).insert(...) resuelve
        then: (fnOk: any, fnErr: any) => Promise.resolve(res).then(fnOk, fnErr),
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
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Buenas tardes. ¿En qué te puedo ayudar?'));
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
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Buenas tardes. ¿En qué te puedo ayudar?'));
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
      'Buen día. Cómo ando no lo puedo responder, soy el asistente automático, no una persona. ¿En qué te puedo ayudar?',
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
      'Soy el asistente de O.D.B. ¿En qué te puedo ayudar?',
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

  it('caso hielo: la oración que sigue al paréntesis de un renglón completo baja a su línea', () => {
    const r = emprolijarListado(
      'De hielo tenemos:\n• Hielo Bolsa 15 kg — $9.900 (Sant Thomas) La bolsa de 5 kg ($5.800) hoy solo queda en Santa Inés.',
    );
    expect(r.split('\n')).toContain('• Hielo Bolsa 15 kg — $9.900 (Sant Thomas)');
    expect(r).toMatch(/\n\nLa bolsa de 5 kg/);
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
    expect(r).toBe('Buenas noches, te damos la bienvenida a O.D.B. El Fernet Branca de 750 cc está $20.500. ¿Cuántas botellas necesita?');
  });

  it('si el modelo no saludó, el saludo y la bienvenida se anteponen', () => {
    const r = saludarConBienvenida('El local abre a las 9.', 'Buenas tardes');
    expect(r).toBe('Buenas tardes, te damos la bienvenida a O.D.B. El local abre a las 9.');
  });

  it('no duplica la bienvenida si el modelo ya la dio', () => {
    const r = saludarConBienvenida('Buenas tardes, bienvenido a O.D.B. ¿Qué necesita?', 'Buenas tardes');
    expect(r).toBe('Buenas tardes. Bienvenido a O.D.B. ¿Qué necesita?');
    expect((r.match(/bienvenid/gi) ?? []).length).toBe(1);
  });

  it('"Hola, buen día" no queda duplicado ni suelto', () => {
    const r = saludarConBienvenida('Hola, buen día, ¿cómo le va? Todo bien por acá.', 'Buen día');
    expect(r).toBe('Buen día, te damos la bienvenida a O.D.B. ¿cómo le va? Todo bien por acá.');
  });

  it('un saludo solo se completa con el ofrecimiento de ayuda', () => {
    expect(saludarConBienvenida('Buenas tardes.', 'Buenas noches')).toBe(
      'Buenas noches, te damos la bienvenida a O.D.B. ¿En qué te puedo ayudar?',
    );
  });
});

describe('Emilia: presentación breve y adjuntos que el bot abre solo', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

  it('la presentación "soy Emilia, la asistente de O.D.B" NO la borra el guard anti-robot', async () => {
    const { s } = servicio();
    (s as any).claude = { messages: { create: jest.fn().mockResolvedValue(respuestaClaude(
      'Buen día. Jaqueline no está disponible en este momento; soy Emilia, la asistente de O.D.B. Dígame en qué lo puedo ayudar y con gusto lo hago.',
    )) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '3011', mensaje: 'hola, está Jacqueline?' });
    expect(r.respuesta).toContain('soy Emilia, la asistente de O.D.B');
    expect(r.respuesta).toContain('no está disponible');
  });

  it('un PDF del cliente viaja al modelo como documento (el bot lo LEE, no lo deriva)', async () => {
    const { s } = servicio();
    const crear = jest.fn().mockResolvedValue(respuestaClaude('De esa lista tenemos el Malbec a $16.600.'));
    (s as any).claude = { messages: { create: crear } };
    const r: any = await s.charla({
      linea: 'pedidos', telefono: '3012', mensaje: '¿tienen algo de esta lista?',
      archivoBase64: 'JVBERi0xLjQKJcTl', mimeType: 'application/pdf',
    });
    expect(r.respuesta).toContain('Malbec');
    const contenido = crear.mock.calls[0][0].messages.at(-1).content;
    expect(Array.isArray(contenido)).toBe(true);
    expect(contenido[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
  });

  it('la vista previa de un video entra como imagen y el modelo sabe que es un video', async () => {
    const { s } = servicio();
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Recibido. Lo veo y le confirmo por acá.'));
    (s as any).claude = { messages: { create: crear } };
    await s.charla({
      linea: 'pedidos', telefono: '3013', mensaje: '',
      archivoBase64: '/9j/4AAQSkZJRg', mimeType: 'image/jpeg', vistaPreviaDeVideo: true,
    });
    const contenido = crear.mock.calls[0][0].messages.at(-1).content;
    expect(contenido[0]).toMatchObject({ type: 'image' });
    expect(contenido[1].text).toContain('VIDEO');
    expect(contenido[1].text).toContain('vista previa');
  });
});

describe('derivarPago reenvía el comprobante REAL a administración', () => {
  const cfg = { data: { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, alias_pago: 'outlet.de.bebidas' }, error: null };
  const armar = () => {
    const { s } = servicio(dbFalsa({ lineas_whatsapp: cfg }));
    const envios: any[] = [];
    (s as any).enviarPorWhatsapp = jest.fn(async (p: any) => (envios.push(p), { enviado: true }));
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    return { s, envios };
  };

  it('una foto de comprobante llega como IMAGEN al WhatsApp de administración, con el texto del cliente', async () => {
    const { s, envios } = armar();
    await s.derivarPago('pedidos', '5491133344455', 'Transferencia por la factura de la semana pasada', {
      monto: 85000, tipo: 'comprobante_enviado',
      comprobanteUrl: 'https://x.supabase.co/publico/whatsapp/549/171.jpg',
      dichoPorElCliente: 'les mando el comprobante de los 85 mil',
      deQuien: 'Distribuidora Norte SRL',
    });
    expect(envios).toHaveLength(1);
    expect(envios[0].to).toBe('5491125213601');
    expect(envios[0].imagenUrl).toContain('171.jpg');
    expect(envios[0].text).toContain('85.000');
    expect(envios[0].text).toContain('les mando el comprobante de los 85 mil');
    expect(envios[0].text).not.toContain('https://'); // la foto va adjunta, no como link
  });

  it('un PDF de comprobante llega como DOCUMENTO adjunto', async () => {
    const { s, envios } = armar();
    await s.derivarPago('pedidos', '5491133344455', 'Factura del proveedor', {
      monto: 120000, tipo: 'comprobante_enviado',
      comprobanteUrl: 'https://x.supabase.co/publico/whatsapp/549/172.pdf',
      deQuien: 'Teide S.R.L.',
    });
    expect(envios[0].documentoUrl).toContain('172.pdf');
    expect(envios[0].imagenUrl).toBeUndefined();
  });

  it('una consulta sin comprobante va como texto, sin adjuntos', async () => {
    const { s, envios } = armar();
    await s.derivarPago('pedidos', '5491133344455', 'Pregunta si le llegó la transferencia', {
      tipo: 'consulta', dichoPorElCliente: '¿les llegó la plata?', deQuien: 'Laura Blanco',
    });
    expect(envios[0].imagenUrl).toBeUndefined();
    expect(envios[0].documentoUrl).toBeUndefined();
    expect(envios[0].text).toContain('¿les llegó la plata?');
  });
});

describe('candados: el bot JAMÁS dice que no puede ver/escuchar/recibir lo que mandan', () => {
  const { niegaPercepcion } = require('./prolijo');
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

  it('el detector atrapa todas las frases que se escaparon y sus variantes', () => {
    for (const frase of [
      'Las imágenes que envió no las puedo visualizar de este lado.',
      'No cuento con la función de interpretar mensajes de audio.',
      'No dispongo de la posibilidad de reenviar archivos.',
      'No tengo acceso para abrir los archivos adjuntos.',
      'No puedo abrir lo que me mandó.',
      'Me resulta imposible reproducir la nota de voz.',
      'Este canal no permite recibir videos.',
      'Solo puedo procesar texto por este medio.',
      'Los PDF no los logro leer desde acá.',
      'Estoy imposibilitado de descargar la captura de pantalla.',
    ]) {
      expect({ frase, atrapa: niegaPercepcion(frase) }).toEqual({ frase, atrapa: true });
    }
  });

  it('no atrapa respuestas legítimas (reenvío por nitidez, un pago que no llegó)', () => {
    for (const frase of [
      '¿Me la reenvía un poco más nítida así la veo bien?',
      'El comprobante todavía no nos figura acreditado.',
      'Recibido, ya lo tengo. Lo revisa alguien de la casa.',
      'No me quedó claro el segundo renglón de la lista, ¿me lo confirma?',
    ]) {
      expect({ frase, atrapa: niegaPercepcion(frase) }).toEqual({ frase, atrapa: false });
    }
  });

  it('CANDADO FINAL: si una regeneración tardía mete "no puedo ver", el mensaje entero se reemplaza', async () => {
    const { s } = servicio();
    // 1ª respuesta: pasa el candado de percepción pero dispara la guarda de
    // "3+ preguntas"; la regeneración (tardía, después del candado) vuelve con
    // la frase prohibida. Solo el candado final puede atraparla.
    const crear = jest.fn()
      .mockResolvedValueOnce(respuestaClaude('¿Qué marca busca? ¿Cuántas unidades? ¿Retira o enviamos?'))
      .mockResolvedValue(respuestaClaude('No puedo ver la foto que mandó, discúlpeme.'));
    (s as any).claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '4001', mensaje: 'hola necesito bebidas', mensajeId: undefined });
    expect(niegaPercepcion(r.respuesta)).toBe(false);
    expect(r.respuesta).toContain('Recibido');
  });
});

describe('registro: voseo respetuoso, jamás usted ni confianzudo', () => {
  const { respetuosoSinConfianza } = require('./prolijo');

  it('convierte los restos de usted inequívocos a voseo', () => {
    expect(respetuosoSinConfianza('Dígame en qué lo puedo ayudar. Cuando transfiera, mándeme el comprobante, y si tiene dudas, escríbame por acá, usted primero.'))
      .toBe('Decime en qué lo puedo ayudar. Cuando transfiera, mandame el comprobante, y si tiene dudas, escribime por acá, vos primero.');
  });

  it('saca lo confianzudo: che, dale, apodos, exclamaciones y emojis', () => {
    expect(respetuosoSinConfianza('¡Dale, che! Te lo mando ya 🍷😀')).toBe('De acuerdo. Te lo mando ya');
    expect(respetuosoSinConfianza('Gracias, capo! Quedó joya el pedido.')).toBe('Gracias. Quedó joya el pedido.');
  });

  it('no rompe la tercera persona legítima ni las palabras del negocio', () => {
    const t = 'El local tiene stock y la caja tiene cambio. Jaqueline dice que mañana llega. • 2 × Fernet — $41.000';
    expect(respetuosoSinConfianza(t)).toBe(t);
  });
});

describe('memoria de adjuntos: lo que llega con el bot apagado no se pierde', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

  it('con el bot apagado, el PDF deja su rastro con link en el historial (caso del catálogo del 1/9)', async () => {
    const db = dbFalsa({
      lineas_whatsapp: { data: { bot_activo: false }, error: null },
      bot_conversaciones: { data: { mensajes: [] }, error: null },
    });
    const { s } = servicio(db);
    (s as any).claude = { messages: { create: jest.fn() } };
    const r: any = await s.charla({
      linea: 'pedidos', telefono: '5491155556666', mensaje: 'Les sumamos unos doypacks',
      archivoBase64: 'JVBERi0xLjQ=', mimeType: 'application/pdf',
      archivoUrl: 'https://x.supabase.co/publico/whatsapp/549/cat.pdf',
    });
    expect(r.respuesta ?? null).toBeNull();
    const up = db.llamadas.upsert.find((u: any) => u.tabla === 'bot_conversaciones');
    const ultimo = up.fila.mensajes.at(-1);
    expect(ultimo.role).toBe('user');
    expect(ultimo.content).toContain('Les sumamos unos doypacks');
    expect(ultimo.content).toContain('[adjunto sin leer: https://x.supabase.co/publico/whatsapp/549/cat.pdf]');
  });

  it('al retomar la charla, el adjunto pendiente se baja, viaja al modelo y queda como leído', async () => {
    const db = dbFalsa({
      bot_conversaciones: {
        data: { mensajes: [
          { role: 'user', content: 'Les sumamos unos doypacks [adjunto sin leer: https://x.supabase.co/publico/whatsapp/549/cat.pdf]' },
        ], tokens: 0 },
        error: null,
      },
    });
    const { s } = servicio(db);
    const fetchViejo = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.4 catalogo').buffer })) as any;
    const crear = jest.fn().mockResolvedValue(respuestaClaude('Perfecto, veo el catálogo de Almendras del Sur. Quedamos a la espera del jueves.'));
    (s as any).claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: '5491155556666', mensaje: 'pudieron ver lo que les mandé?' });
    global.fetch = fetchViejo;

    expect(r.respuesta).toContain('catálogo');
    // el turno que vio el modelo lleva el documento y la advertencia
    const msgs = crear.mock.calls[0][0].messages;
    const turno = msgs.at(-1).content;
    expect(Array.isArray(turno)).toBe(true);
    expect(turno[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(turno.at(-1).text).toContain('NO preguntes nada que esos archivos ya respondan');
    // y en la memoria guardada el adjunto quedó como leído
    const up = db.llamadas.upsert.filter((u: any) => u.tabla === 'bot_conversaciones').at(-1);
    const historialGuardado = JSON.stringify(up.fila.mensajes);
    expect(historialGuardado).toContain('[adjunto ya leído]');
    expect(historialGuardado).not.toContain('adjunto sin leer');
  });
});

describe('audios cortados: la bajada verifica el cierre del OGG y reintenta', () => {
  const { oggCompleto } = require('./ogg');
  // páginas OGG mínimas: 'OggS' + versión + header_type + granule(8) + serial(4) + seq(4) + crc(4) + nsegs(0)
  const pagina = (headerType: number) => Buffer.concat([Buffer.from('OggS'), Buffer.from([0, headerType]), Buffer.alloc(21)]);

  it('detecta el fin de stream (bit 0x04 de la última página)', () => {
    expect(oggCompleto(Buffer.concat([pagina(0x02), pagina(0x00), pagina(0x04)]))).toBe(true);
    expect(oggCompleto(Buffer.concat([pagina(0x02), pagina(0x00), pagina(0x00)]))).toBe(false);
    expect(oggCompleto(Buffer.from('no soy un ogg'))).toBe(false);
  });

  it('los tres audios reales truncados del 1/9 dan incompleto', () => {
    const fs = require('fs');
    for (const f of ['1788282041183', '1788284657605', '1788285291423']) {
      const ruta = `/var/folders/jz/dxyzv5zn2pl6n7cwchpw51840000gn/T/audio-${f}.oga`;
      if (!fs.existsSync(ruta)) continue; // solo corre en la máquina donde se bajaron
      expect(oggCompleto(fs.readFileSync(ruta))).toBe(false);
    }
  });

  it('bajarMediaWaha reintenta hasta que el OGG cierra y devuelve la versión completa', async () => {
    const cortado = Buffer.concat([pagina(0x02), pagina(0x00)]);
    const completo = Buffer.concat([pagina(0x02), pagina(0x00), pagina(0x00), pagina(0x04)]);
    const fetchViejo = global.fetch;
    let llamadas = 0;
    const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => ab(++llamadas === 1 ? cortado : completo) })) as any;
    process.env.WAHA_URL = 'https://waha';
    const falso = { log: { log: () => undefined, warn: () => undefined } };
    const r = await (BotService.prototype as any).bajarMediaWaha.call(falso, {
      media: { url: 'https://waha/api/files/x.oga', mimetype: 'audio/ogg; codecs=opus' },
    });
    global.fetch = fetchViejo;
    expect(llamadas).toBe(2);
    expect(Buffer.from(r.base64, 'base64').length).toBe(completo.length);
    expect(r.mime).toBe('audio/ogg');
  }, 20000);
});

describe('regla del dueño: los pedidos viven adentro; el WhatsApp interno es solo para plata', () => {
  it('derivarAHumano avisa por la campanita del sistema y NO manda WhatsApp', async () => {
    const db = dbFalsa({ lineas_whatsapp: { data: { avisar_proveedores_a: 'jp-id' }, error: null } });
    const { s } = servicio(db);
    const wsp = jest.fn();
    (s as any).enviarPorWhatsapp = wsp;
    const r = await s.derivarAHumano('pedidos', '5491133344455', 'Pedido confirmado de 23 productos por $445.266: cargarlo desde el local', true);
    expect(r.derivada).toBe(true);
    expect(wsp).not.toHaveBeenCalled();
    const alerta = db.llamadas.insert.find((i: any) => i.tabla === 'alertas_internas');
    expect(alerta.fila.tipo).toBe('derivacion');
    expect(alerta.fila.detalle).toContain('$445.266');
  });

  it('consultarInterno registra adentro y NO manda WhatsApp (antes caía al teléfono de administración)', async () => {
    const db = dbFalsa({ lineas_whatsapp: { data: { derivar_pagos_a: '5491125213601', avisar_proveedores_a: 'jp-id' }, error: null } });
    const { s } = servicio(db);
    const wsp = jest.fn();
    (s as any).enviarPorWhatsapp = wsp;
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    const r: any = await (s as any).consultarInterno('pedidos', '5491133344455', 'reparto', '¿Llegamos hoy a La Providencia con el pedido?', 'Ruta 52 10001');
    expect(wsp).not.toHaveBeenCalled();
    expect(r.consultado).toBe(true);
    expect(r.aviso).toContain('adentro del sistema');
    expect(db.llamadas.insert.some((i: any) => i.tabla === 'alertas_internas')).toBe(true);
    expect(db.llamadas.insert.some((i: any) => i.tabla === 'bot_notas_equipo')).toBe(true);
  });
});

describe('identidad primero: sin saber de quién es la plata, no se molesta a administración', () => {
  const cfg = { data: { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null }, error: null };
  const armar = () => {
    const { s } = servicio(dbFalsa({ lineas_whatsapp: cfg }));
    const envios: any[] = [];
    (s as any).enviarPorWhatsapp = jest.fn(async (p: any) => (envios.push(p), { enviado: true }));
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    return { s, envios };
  };

  it('teléfono desconocido sin nombre: NO manda WhatsApp y pide preguntar de quién es', async () => {
    const { s, envios } = armar();
    const r: any = await s.derivarPago('pedidos', '5491100000027', 'Avisa que transfirió $85.000 por la factura de la semana pasada', {
      monto: 85000, tipo: 'comprobante_enviado',
    });
    expect(envios).toHaveLength(0);
    expect(r.faltaIdentidad).toBe(true);
    expect(r.aviso).toContain('de_quien');
    expect(r.aviso).toContain('NO le digas al cliente que ya está avisado');
  });

  it('con la identidad construida, el nombre encabeza el mensaje a administración', async () => {
    const { s, envios } = armar();
    await s.derivarPago('pedidos', '5491100000027', 'Transfirió $85.000 por la factura de la semana pasada; la factura era de $125.000: faltan $40.000', {
      monto: 85000, tipo: 'comprobante_enviado', deQuien: 'Distribuidora Norte SRL',
      comprobanteUrl: 'https://x.supabase.co/publico/whatsapp/549/173.jpg',
    });
    expect(envios).toHaveLength(1);
    expect(envios[0].text).toContain('De: Distribuidora Norte SRL');
    expect(envios[0].text).toContain('faltan $40.000');
  });

  it('el cliente YA conocido del sistema pasa sin preguntar nada', async () => {
    const { s, envios } = armar();
    (s as any).identificarCliente = jest.fn(async () => ({ existe: true, clienteId: 'c1', nombre: 'Laura Blanco' }));
    await s.derivarPago('pedidos', '5491133344455', 'Pregunta si llegó su transferencia', { tipo: 'consulta' });
    expect(envios).toHaveLength(1);
    expect(envios[0].text).toContain('De: Laura Blanco');
  });

  it('pedir el alias (quiere_pagar) no exige identidad: los datos se dan directo', async () => {
    const { s } = servicio(dbFalsa({ lineas_whatsapp: { data: { ...cfg.data, alias_pago: 'outlet.de.bebidas' }, error: null } }));
    (s as any).identificarCliente = jest.fn(async () => ({ existe: false }));
    const r: any = await s.derivarPago('pedidos', '5491100000027', 'Quiere transferir', { tipo: 'quiere_pagar' });
    expect(r.respuestaFija).toContain('outlet.de.bebidas');
  });
});
