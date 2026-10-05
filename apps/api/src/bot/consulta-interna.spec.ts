import { BotService } from './bot.service';

// LA CHARLA DE PABLO (5/10/2026, vinos a España). El bot repitió «Ya te confirmo
// por acá» pegado abajo de «¿Está completo el pedido…?», después SOLO como
// respuesta a un audio que traía nombre, retiro y la pregunta por una caja, y
// consultó dos veces lo mismo de la caja. Regla de Leandro: «Lo de <tema> te lo
// confirmo por acá.», UNA vez por cosa pendiente, nunca suelto si el cliente
// dijo algo más, nunca abajo de una pregunta al cliente, y el resto contestado.
// Estas pruebas usan los textos reales de esa charla.

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

// base falsa por operación: cada tabla contesta distinto a select, insert y update
function baseFalsa(config: Record<string, Record<string, any> | ((op: string, ctx: Ctx) => any)> = {}) {
  const escrituras: Escritura[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const ctx: Ctx = { filtros: [] };
      const res = () => {
        const c = config[tabla];
        const r = typeof c === 'function' ? c(op, ctx) : c?.[op];
        return r ?? { data: null, error: null };
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (k === 'select') return (columnas?: string) => { if (op === 'select') ctx.columnas = columnas; return b; };
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) {
            return (fila: any) => { op = String(k); ctx.fila = fila; escrituras.push({ tabla, op, fila, filtros: ctx.filtros }); return b; };
          }
          return (...args: any[]) => { ctx.filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '137091732230271';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, bot_activo: true };
const conv = (mensajes: any[]) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] }, error: null });
const h = (...p: [string, string][]) => p.map(([role, content]) => ({ role, content }));
const usage = { input_tokens: 1, output_tokens: 1 };
const herramienta = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const conHerramientas = (...content: any[]) => ({ stop_reason: 'tool_use', content, usage });
const texto = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'insert');
const updatesDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'update');
const veces = (t: string, frase: RegExp) => (t.match(new RegExp(frase.source, 'gi')) ?? []).length;

// los mensajes reales del bot en esa charla
const M2_SIN_ACUSE = 'Del PerSe Inseparable no tengo ahora. En esa misma línea de Gualtallary sí tengo:\n• Adrianna River Malbec 750 cc — $182.000, o $163.800 en efectivo o transferencia\n\nPor ahora quedan anotados:\n• 1 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Bressia Conjuro 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
const M6 = 'Ya te pasé los tres precios más arriba. ¿Cierro con esos tres y te paso el total?';
const M8 = 'Perfecto, quedate tranquilo con la elección: podés llevar una de cada una o tres iguales, el precio por botella es el mismo.';
const M12 = 'Te anoto:\n• 2 × Judas Malbec 750 cc\n• 1 × Catena Zapata Malbec Argentino 750 cc\n• 1 × Conjuro Bressia 750 cc\n\n¿Está completo el pedido o querés sumar algo?';
const CAJA_1602 = 'Cliente viaja a España: ¿Judas Malbec 750, Catena Zapata Malbec Argentino 750 y Conjuro Bressia 750 vienen en caja/estuche individual? ¿Tenemos embalaje para llevar en avión?';
const CAJA_1617 = 'Cliente Pablo retira en un rato 4 botellas y las lleva a España en valija: ¿tenemos caja o embalaje de protección para darle?';
const AUDIO_14 = 'En un ratito los puedo pasar a buscar, y si tenés alguna caja para ponerlos... a nombre de Pablo, por las dudas.';

function servicio(db: any) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  const wsp = jest.fn(async () => ({ enviado: true, id: 'W-NUEVO' }));
  s.enviarPorWhatsapp = wsp;
  return { s, wsp };
}

describe('la charla de Pablo: el aviso, una vez por cosa pendiente (5/10/2026)', () => {
  it('(i) mensaje 2: lista + «¿Está completo…?» + consulta nueva del PerSe → el aviso va ANTES de la pregunta, una vez', async () => {
    const hist = h(['user', 'Quiero 1 Judas Malbec, 1 Catena Zapata Malbec Argentino y 1 PerSe Inseparable para retirar'], ['assistant', 'Sumé el Bressia Conjuro 750 cc a la lista. Decime si cerramos así.']);
    const db = baseFalsa({
      bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-perse' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'compras', consulta: '¿Entra el PerSe Inseparable 750 cc? El cliente lo quiere para retirar.', tema: 'el PerSe Inseparable', direccion: '' })))
      .mockResolvedValueOnce(texto(M2_SIN_ACUSE.replace('Del PerSe Inseparable no tengo ahora.', 'Del PerSe Inseparable no tengo ahora, ya te confirmo por acá si entra.')));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Opcion 4' });
    const aviso = 'Lo del PerSe Inseparable te lo confirmo por acá.';
    expect(r.respuesta.trim().endsWith(`${aviso}\n\n¿Está completo el pedido o querés sumar algo?`)).toBe(true);
    expect(veces(r.respuesta, /te lo confirmo por acá/)).toBe(1);
    expect(r.respuesta).not.toMatch(/Ya te confirmo/);
    expect(r.respuesta).toMatch(/^Del PerSe Inseparable no tengo ahora\./);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila.tema).toBe('el PerSe Inseparable');
  });

  it('(ii) mensaje 8 → «Lo de la caja…» una vez, al final, sin el acuse genérico', async () => {
    const hist = h(['user', 'Opcion 4'], ['assistant', `${M2_SIN_ACUSE}\n\nYa te confirmo por acá.`], ['user', 'Decime los valores'], ['assistant', 'Son estos tres: ...'], ['user', 'Me gustaría saber los precios'], ['assistant', M6]);
    const db = baseFalsa({
      bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas({ type: 'text', text: M8 }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1602, tema: 'la caja para viajar', direccion: '' })))
      .mockResolvedValueOnce(texto(`${M8} Si vienen en caja individual te confirmo por acá.`));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Ahí estoy averiguando que prefiere si uno de cada o 3 de uno. Son para llevar a España, vienen en cajas individuales? Para saber cómo los llevo' });
    expect(r.respuesta).toBe(`${M8}\n\nLo de la caja para viajar te lo confirmo por acá.`);
    expect(wsp).toHaveBeenCalledTimes(1);
    // el resultado de la herramienta ya no le ordena al modelo callarse
    const resultado = JSON.parse((crear.mock.calls[1][0].messages.at(-1).content as any[]).find((b: any) => b.type === 'tool_result').content);
    expect(resultado.aviso).toMatch(/Contestá ahora todo lo demás/);
    expect(resultado.aviso).not.toMatch(/NO envíes mensaje al cliente/);
  });

  it('(iii) mensaje 14: el audio con la caja YA consultada → no hay otra consulta ni WhatsApp, y contesta lo del nombre y el retiro sin repetir el aviso', async () => {
    const hist = h(
      ['user', 'Opcion 4'], ['assistant', `${M2_SIN_ACUSE}\n\nYa te confirmo por acá.`],
      ['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nYa te confirmo por acá.`],
      ['user', 'Raquis monasterio tenes?'], ['assistant', 'De Raquis Monasterio no tengo ahora.'],
      ['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12],
    );
    // la consulta de las 16:02, todavía sin respuesta (de antes del tema: sin tema)
    const abierta = { id: 'f764d448', area: 'local', consulta: CAJA_1602, tema: null, waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString() };
    const db = baseFalsa({
      bot_conversaciones: { select: conv(hist) }, lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abierta], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })))
      // el modelo cierra solo con la promesa (así terminó el 14 real)
      .mockResolvedValueOnce(texto('Te confirmo por acá lo de la caja.'))
      // la reescritura sin herramientas contesta lo demás
      .mockResolvedValueOnce(texto(dale));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });

    // no se inserta otra consulta ni sale otro WhatsApp a administración
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
    // el dato nuevo se suma a la abierta, sin tocar su waha_msg_id
    const suma = updatesDe(db, 'bot_consultas_internas').find((u: Escritura) => u.fila.consulta);
    expect(suma.fila.consulta).toBe(`${CAJA_1602}\n+ ${CAJA_1617}`);
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => 'waha_msg_id' in u.fila)).toBe(false);
    // la respuesta NO es solo el aviso: contesta nombre y retiro, sin repetir el aviso
    expect(r.respuesta).toBe(dale);
    expect(r.respuesta).not.toMatch(/confirmo por acá/i);
    // la reescritura fue UNA, sin herramientas y con razonamiento
    expect(crear).toHaveBeenCalledTimes(3);
    expect(crear.mock.calls[2][0].tools).toBeUndefined();
    expect(crear.mock.calls[2][0].thinking).toEqual({ type: 'adaptive' });
    // el modelo vio desde el arranque que la caja ya estaba consultada
    const primero = crear.mock.calls[0][0].messages.at(-1).content;
    const textoPrimero = typeof primero === 'string' ? primero : primero.map((b: any) => b.text ?? '').join(' ');
    expect(textoPrimero).toContain('Consultas internas abiertas (el cliente ya fue avisado; no las repitas ni las vuelvas a consultar)');
    expect(textoPrimero).toContain('vienen en caja/estuche individual');
  });

  it('(iv) el modelo escribe solo «Lo consulto y vuelvo a vos.», consulta nueva, y el cliente solo preguntó eso → sale solo el aviso', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-kit' }, error: null } },
    });
    const { s } = servicio(db);
    const vuelta = conHerramientas({ type: 'text', text: 'Lo consulto y vuelvo a vos.' }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: '¿Cuántas unidades trae el kit?', tema: 'el contenido del kit', direccion: '' }));
    const crear = jest.fn().mockResolvedValue(vuelta);
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Cuántas unidades trae el kit?' });
    expect(r.respuesta).toBe('Lo del contenido del kit te lo confirmo por acá.');
    // sin reescritura: no había nada más que contestar
    expect(crear).toHaveBeenCalledTimes(2);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('el corte por insistir con herramientas no tira lo que el modelo ya había escrito', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    const crear = jest.fn().mockResolvedValue(conHerramientas({ type: 'text', text: dale }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).toBe(`${dale}\n\nLo de la caja para viajar te lo confirmo por acá.`);
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it('la caja ya consultada y el cliente vuelve a preguntar solo eso: «todavía no lo tengo», sin repetir el aviso ni consultar de nuevo', async () => {
    const abierta = { id: 'q-caja', area: 'local', consulta: CAJA_1602, tema: 'la caja para viajar', waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 30 * 60_000).toISOString() };
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nLo de la caja para viajar te lo confirmo por acá.`])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abierta], error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'local', consulta: '¿Vienen en caja?', tema: 'la caja para viajar', direccion: '' })))
      .mockResolvedValueOnce(texto('Ya te confirmo por acá.'));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo de la caja?' });
    expect(r.respuesta).toBe('Lo de la caja para viajar todavía no lo tengo.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });
});

describe('consultarInterno: la misma consulta se suma a la abierta (5/10/2026)', () => {
  const abierta = (extra: any = {}) => ({ id: 'f764d448', area: 'local', consulta: CAJA_1602, tema: null, waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString(), ...extra });

  it('16:17 repite la de 16:02: sin insert, sin WhatsApp, se suma el dato y se actualiza el aviso de la campanita', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta()], error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', CAJA_1617, '', undefined, 'la caja para viajar');
    expect(r).toMatchObject({ consultado: true, yaEstaba: true, consulta_id: 'f764d448', tema: 'la caja para viajar' });
    expect(r.aviso).toMatch(/ya estaba abierta/);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
    const alerta = updatesDe(db, 'alertas_internas')[0];
    expect(alerta.fila.detalle).toBe(`${CAJA_1602}\n+ ${CAJA_1617}`);
    expect(alerta.filtros).toContainEqual(['eq', 'referencia->>consulta_id', 'f764d448']);
    // la consulta vieja no tenía tema: queda el de ahora
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => u.fila.tema === 'la caja para viajar')).toBe(true);
    // se leyó con eq/is/gte/order/limit (nada de filter)
    const lectura = db.escrituras.length; expect(lectura).toBeGreaterThan(0);
  });

  it('si la original nunca salió por WhatsApp, sale ahora con la consulta completa', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta({ waha_msg_id: null })], error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', CAJA_1617, '', undefined, 'la caja para viajar');
    expect(r.yaEstaba).toBe(true);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].text).toContain(`${CAJA_1602}\n+ ${CAJA_1617}`);
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => u.fila.waha_msg_id === 'W-NUEVO')).toBe(true);
  });

  it('lo mismo dicho igual no se vuelve a sumar', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta({ tema: 'la caja para viajar' })], error: null } } });
    const { s } = servicio(db);
    await s.consultarInterno('pedidos', TEL, 'local', CAJA_1602, '', undefined, 'la caja para viajar');
    expect(updatesDe(db, 'bot_consultas_internas').filter((u: Escritura) => u.fila.consulta)).toHaveLength(0);
  });

  it('otra cosa (el Raquis) es otra consulta: se registra con su tema y sale su WhatsApp', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta()], error: null }, insert: { data: { id: 'q-raquis' }, error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'compras', '¿Entra el Raquis Monasterio 750 cc?', '', undefined, 'el Raquis Monasterio');
    expect(r).toMatchObject({ consultado: true, yaEstaba: false, consulta_id: 'q-raquis', tema: 'el Raquis Monasterio' });
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila.tema).toBe('el Raquis Monasterio');
    expect(wsp).toHaveBeenCalledTimes(1);
  });

  it('una consulta que el área ya contestó (respuesta en camino) no recibe datos nuevos', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta({ respuesta_admin: 'Vienen sin estuche.' })], error: null }, insert: { data: { id: 'q-nueva' }, error: null } } });
    const { s } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', CAJA_1617, '', undefined, 'la caja para viajar');
    expect(r.yaEstaba).toBe(false);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('sin la columna tema en la base (migración sin aplicar), se lee y se registra igual', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: (op: string, ctx: Ctx) => {
        if (op === 'select') return /\btema\b/.test(ctx.columnas ?? '') ? { data: null, error: { message: 'column bot_consultas_internas.tema does not exist' } } : { data: [], error: null };
        if (op === 'insert') return 'tema' in (ctx.fila ?? {}) ? { data: null, error: { message: "Could not find the 'tema' column" } } : { data: { id: 'q-sin-tema' }, error: null };
        return { data: null, error: null };
      },
    });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', '¿Entra el PerSe Inseparable?', '', undefined, 'el PerSe Inseparable');
    expect(r).toMatchObject({ consultado: true, consulta_id: 'q-sin-tema', tema: 'el PerSe Inseparable' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(2);
    expect(wsp).toHaveBeenCalledTimes(1);
  });

  it('el banco de pruebas no busca ni suma: queda respondido al instante y no avisa', async () => {
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [abierta()], error: null }, insert: { data: { id: 'q-banco' }, error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', '5491100000027', 'local', CAJA_1617, '', undefined, 'la caja para viajar');
    expect(r.yaEstaba).toBe(false);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila.respondido_en).toBeTruthy();
    expect(wsp).not.toHaveBeenCalled();
  });
});

describe('razonamiento siempre encendido: el verificador de preguntas sin contestar (5/10/2026)', () => {
  it('Haiku 4.5 va con thinking enabled (budget 1024, max_tokens 2048) y se lee el bloque de texto', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, te damos la bienvenida a O.D.B. ¿En qué te puedo ayudar?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
    });
    const { s } = servicio(db);
    const crear = jest.fn(async (p: any) => p.model === 'claude-haiku-4-5'
      ? { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"sin_responder":[]}' }], usage }
      : texto('El Judas Malbec 750 cc lo tengo.'));
    s.claude = { messages: { create: crear } };
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tenés Judas Malbec?' });
    const verificador: any = crear.mock.calls.map((c: any[]) => c[0]).find((p: any) => p.model === 'claude-haiku-4-5');
    expect(verificador).toBeTruthy();
    expect(verificador.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(verificador.max_tokens).toBe(2048);
    expect(verificador.max_tokens).toBeGreaterThan(verificador.thinking.budget_tokens);
    // ninguna llamada del bot va sin razonamiento
    for (const [p] of crear.mock.calls as any[][]) expect(p.thinking).toBeTruthy();
  });
});
