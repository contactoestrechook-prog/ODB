import { BotService } from './bot.service';

// LA CHARLA DE PABLO (5/10/2026, vinos a España). El bot repitió «Ya te confirmo
// por acá» pegado abajo de «¿Está completo el pedido…?», después SOLO como
// respuesta a un audio que traía nombre, retiro y la pregunta por una caja, y
// consultó dos veces lo mismo de la caja. El 5/10 se cambió por «Lo de <tema> te
// lo confirmo por acá.», y el 6/10 Leandro dijo que no: CONSULTA SILENCIOSA. Lo
// que no se sabe se consulta por adentro y al cliente no se le dice nada de eso;
// se le contesta lo demás y, si no había nada más, no se le manda nada.
// Estas pruebas usan los textos reales de esa charla (ver también
// consulta-silenciosa.spec.ts).

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

// ¿la fila pasa los filtros de la consulta? (eq, is, gte, lte, neq)
function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return col in fila && String(fila[col]) === String(val);
    if (k === 'neq') return String(fila[col]) !== String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return col in fila && String(fila[col]) >= String(val);
    if (k === 'lte') return col in fila && String(fila[col]) <= String(val);
    return true;
  });
}

// base falsa por operación: cada tabla contesta distinto a select, insert y update.
// Un select que devuelve filas las FILTRA con eq/is/gte como la base de verdad
// (5/10/2026, revisión): antes devolvía todo, y sacar el .eq('telefono_cliente')
// de la lectura de consultas abiertas no rompía ningún test.
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
        const out = r ?? { data: null, error: null };
        return op === 'select' && Array.isArray(out.data) ? { ...out, data: out.data.filter((f: any) => cumple(f, ctx.filtros)) } : out;
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

describe('la charla de Pablo: consulta silenciosa (6/10/2026)', () => {
  it('(i) mensaje 2: lista + «¿Está completo…?» + consulta nueva del PerSe → la lista y la pregunta, sin nada de la consulta', async () => {
    const hist = h(['user', 'Quiero 1 Judas Malbec, 1 Catena Zapata Malbec Argentino y 1 PerSe Inseparable para retirar'], ['assistant', 'Sumé el Bressia Conjuro 750 cc a la lista. Decime si cerramos así.']);
    // los precios del Adrianna River salieron de la cava (importes verificados, en
    // centavos): desde la revisión del 6/10/2026 un importe sin fuente no sale
    // tampoco en un turno con consulta
    const conPrecios = { data: { ...conv(hist).data, importes_verificados: [18200000, 16380000] }, error: null };
    const db = baseFalsa({
      bot_conversaciones: { select: conPrecios }, lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-perse' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'compras', consulta: '¿Entra el PerSe Inseparable 750 cc? El cliente lo quiere para retirar.', tema: 'el PerSe Inseparable', direccion: '' })))
      .mockResolvedValueOnce(texto(M2_SIN_ACUSE.replace('Del PerSe Inseparable no tengo ahora.', 'Del PerSe Inseparable no tengo ahora, ya te confirmo por acá si entra.')));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Opcion 4' });
    expect(r.respuesta).toBe(M2_SIN_ACUSE);
    expect(veces(r.respuesta, /confirm/)).toBe(0);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila.tema).toBe('el PerSe Inseparable');
  });

  it('(ii) mensaje 8 → contesta lo de una de cada o tres iguales, sin nada de la caja', async () => {
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
    expect(r.respuesta).toBe(M8);
    expect(wsp).toHaveBeenCalledTimes(1);
    // el resultado de la herramienta le dice al modelo que no mencione la consulta y conteste lo demás
    const resultado = JSON.parse((crear.mock.calls[1][0].messages.at(-1).content as any[]).find((b: any) => b.type === 'tool_result').content);
    expect(resultado.aviso).toMatch(/Al cliente NO le menciones nada de eso/);
    expect(resultado.aviso).toMatch(/Contestale ahora solo lo demás/);
    expect(resultado.aviso).toMatch(/Si no hay nada más que contestar, no escribas nada/);
  });

  it('(iii) mensaje 14: el audio con la caja YA consultada → no hay otra consulta ni WhatsApp, y contesta lo del nombre y el retiro, nada de la caja', async () => {
    const hist = h(
      ['user', 'Opcion 4'], ['assistant', `${M2_SIN_ACUSE}\n\nYa te confirmo por acá.`],
      ['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nYa te confirmo por acá.`],
      ['user', 'Raquis monasterio tenes?'], ['assistant', 'De Raquis Monasterio no tengo ahora.'],
      ['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12],
    );
    // la consulta de las 16:02, todavía sin respuesta (de antes del tema: sin tema)
    const abierta = { id: 'f764d448', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'local', consulta: CAJA_1602, tema: null, waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString() };
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
      // la reescritura (puede buscar y cotizar) contesta lo demás
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
    // contesta nombre y retiro, y nada de la caja
    expect(r.respuesta).toBe(dale);
    expect(r.respuesta).not.toMatch(/caja|confirm|pendiente/i);
    // la reescritura fue UNA, con razonamiento, y puede buscar y cotizar (6/10/2026,
    // revisión: sin herramientas no podía cotizar y un total armado a mano se
    // descartaba entero). Desde el cambio a Opus 5.5 ve la MISMA lista de
    // herramientas que el bucle (achicarla invalida el razonamiento guardado y la
    // caché): lo que no puede usar lo frena el código (ver la prueba de abajo)
    expect(crear).toHaveBeenCalledTimes(3);
    const nombres = (crear.mock.calls[2][0].tools ?? []).map((t: any) => t.name);
    expect(nombres).toEqual((crear.mock.calls[0][0].tools ?? []).map((t: any) => t.name));
    expect(crear.mock.calls[2][0].tool_choice).toBeUndefined();
    expect(crear.mock.calls[2][0].thinking).toEqual({ type: 'adaptive' });
    expect(crear.mock.calls[2][0].output_config).toEqual(crear.mock.calls[0][0].output_config);
    // el modelo vio desde el arranque que la caja ya estaba consultada
    const primero = crear.mock.calls[0][0].messages.at(-1).content;
    const textoPrimero = typeof primero === 'string' ? primero : primero.map((b: any) => b.text ?? '').join(' ');
    expect(textoPrimero).toContain('Consultas internas abiertas, ya en manos de administración (al cliente NO le menciones nada de eso');
    expect(textoPrimero).toContain('vienen en caja/estuche individual');
  });

  it('(iv) el modelo escribe solo «Lo consulto y vuelvo a vos.», consulta nueva, y el cliente solo preguntó eso → al cliente no le sale nada', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-kit' }, error: null } },
    });
    const { s } = servicio(db);
    const vuelta = conHerramientas({ type: 'text', text: 'Lo consulto y vuelvo a vos.' }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: '¿Cuántas unidades trae el kit?', tema: 'el contenido del kit', direccion: '' }));
    const crear = jest.fn().mockResolvedValue(vuelta);
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Cuántas unidades trae el kit?' });
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    // sin reescritura: no había nada más que contestar. Insistió con herramientas
    // tras la consulta, así que la tercera vuelta (6/10/2026) va con las mismas
    // herramientas y tool_choice none para que escriba; el mock la ignora y el
    // corte rescata lo escrito, que es solo la mención de la consulta
    expect(crear).toHaveBeenCalledTimes(3);
    expect(crear.mock.calls[2][0].tool_choice).toEqual({ type: 'none' });
    expect(crear.mock.calls[2][0].tools).toEqual(crear.mock.calls[0][0].tools);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('el corte por insistir con herramientas no tira lo que el modelo ya había escrito', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    // la forma de Opus 5: el texto antes de la herramienta viene como texto, y la
    // vuelta obligada a escribir (tool_choice none) vuelve vacía: se rescata lo escrito
    const insiste = conHerramientas({ type: 'text', text: dale }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' }));
    const crear = jest.fn(async (p: any) => (p.tool_choice?.type === 'none' ? texto('') : insiste));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    // nada de la caja (el saludo del primer mensaje lo escribe el modelo: desde el 10/10/2026 el código no lo agrega)
    expect(r.respuesta).toBe(dale);
    expect(crear).toHaveBeenCalledTimes(3);
  });

  it('Opus 5.5: lo escrito entre herramientas viene vacío (en el razonamiento); la vuelta con tool_choice none escribe nombre y retiro', async () => {
    const db = baseFalsa({
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-caja' }, error: null } },
    });
    const { s } = servicio(db);
    const dale = 'Dale, Pablo: te los dejo a tu nombre para retirar en la sucursal Saint Thomas.';
    // la forma de Opus 5.5: razonamiento vacío (display omitido) y la herramienta, sin texto
    const insiste = conHerramientas({ type: 'thinking', thinking: '', signature: 'firma-1' }, herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' }));
    const crear = jest.fn(async (p: any) => (p.tool_choice?.type === 'none'
      ? { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'firma-2' }, { type: 'text', text: dale }], usage }
      : insiste));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).toMatch(new RegExp(`${dale}$`));
    expect(r.respuesta).not.toMatch(/caja|confirm/i);
    expect(crear).toHaveBeenCalledTimes(3);
    // los bloques de razonamiento vuelven tal cual, en orden, con su firma
    const ultima = crear.mock.calls[2][0];
    const firmas = ultima.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === 'thinking').map((b: any) => b.signature);
    expect(firmas).toEqual(['firma-1', 'firma-1']);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('la caja ya consultada y el cliente vuelve a preguntar solo eso: no le sale nada (ni «todavía no lo tengo»), ni se consulta de nuevo', async () => {
    const abierta = { id: 'q-caja', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'local', consulta: CAJA_1602, tema: 'la caja para viajar', waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 30 * 60_000).toISOString() };
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
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });
});

describe('consultarInterno: la misma consulta se suma a la abierta (5/10/2026)', () => {
  const abierta = (extra: any = {}) => ({ id: 'f764d448', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'local', consulta: CAJA_1602, tema: null, waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString(), ...extra });

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
    // la lectura de las abiertas no usa .filter (la base falsa de otros specs no lo tiene)
    // y filtra por línea, teléfono, abiertas y ventana: lo prueba el caso de abajo
    // «otro teléfono, una respondida y una vieja no se juntan» (5/10/2026, revisión)
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

// REVISIÓN DEL 5/10/2026: lo que encontraron los cuatro revisores sobre el aviso,
// probado con la charla entera (la base falsa filtra como la de verdad). Desde el
// 6/10/2026 sin aviso: lo que se esperaba como aviso ahora es nada al cliente.
describe('revisión del aviso (5/10/2026): sin consultas falsas ni repetidas', () => {
  const RESUMEN = '• Judas Malbec x750cc — 2 × $79.900 c/u = $159.800\n• Catena Zapata Malbec Argentino — 1 × $73.800 c/u = $73.800\n• Conjuro Bressia — 1 × $83.500 c/u = $83.500\nTotal: $317.100\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
  const conImportes = (mensajes: any[], importes: number[]) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: importes }, error: null });
  const abiertaCaja = (extra: any = {}) => ({ id: 'q-caja', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'local', consulta: CAJA_1602, tema: 'la caja para viajar', waha_msg_id: 'W-1602', respuesta_admin: null, creado_en: new Date(Date.now() - 15 * 60_000).toISOString(), ...extra });
  // el verificador de preguntas (Haiku) contesta "todo atendido"; el modelo principal, lo que se le cargue
  const claudeCon = (...principal: any[]) => jest.fn(async (p: any) => p.model === 'claude-haiku-4-5'
    ? { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sin_responder":[]}' }], usage }
    : principal.length > 1 ? principal.shift() : principal[0]);

  it('«Sí, te lo confirmo: $317.100.» afirma un dato: no abre consulta ni pega el genérico', async () => {
    const db = baseFalsa({
      // el total ya salió de una herramienta antes (importes verificados, en centavos)
      bot_conversaciones: { select: conImportes(h(['user', 'Pasame el total'], ['assistant', RESUMEN]), [31710000]) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'NO' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Sí, te lo confirmo: $317.100.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿El total es 317.100?' });
    expect(r.respuesta).toBe('Sí, te lo confirmo: $317.100.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });

  it('«Sí, te lo confirmo: el domingo abrimos…» tampoco: sale tal cual', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'NO' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Sí, te lo confirmo: el domingo abrimos de 10 a 14.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Abren el domingo' });
    expect(r.respuesta).toBe('Sí, te lo confirmo: el domingo abrimos de 10 a 14.');
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
  });

  it('«¿Y lo de la caja?» con la caja abierta y una promesa sin herramienta: ni fila ni WhatsApp, y al cliente nada', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nLo de la caja para viajar te lo confirmo por acá.`])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
      alertas_internas: { insert: { data: null, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Lo de la caja para viajar te lo confirmo por acá.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Y lo de la caja?' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
    expect(r.respuesta).toBeNull();
  });

  it('el audio del 14 sin herramienta («La caja te la confirmo por acá») con la caja abierta: contesta lo demás, sin otra consulta ni aviso', async () => {
    const abierta = abiertaCaja({ id: 'f764d448', tema: null });
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nYa te confirmo por acá.`], ['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abierta], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Dale, Pablo, te los dejo a tu nombre para retirar en la sucursal Saint Thomas. La caja te la confirmo por acá.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(wsp).not.toHaveBeenCalled();
    // («Dale» lo cambia el registro respetuoso: «De acuerdo»)
    expect(r.respuesta).toMatch(/^(?:Dale|De acuerdo), Pablo, te los dejo a tu nombre para retirar en la sucursal Saint Thomas\./);
    expect(r.respuesta).not.toMatch(/confirmo por acá/);
  });

  it('una promesa nueva sin herramienta abre la consulta a administración CON el tema de la oración, y al cliente solo lo que sabe', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-estuche' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('El Judas Malbec lo tengo. Lo del estuche te lo confirmo por acá.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tenés Judas Malbec? ¿Viene con estuche?' });
    expect(insertsDe(db, 'bot_consultas_internas')[0].fila).toMatchObject({ tema: 'el estuche', area: 'administracion' });
    expect(r.respuesta).toBe('El Judas Malbec lo tengo.');
  });

  it('(B2) otra foto sin texto con una consulta de foto abierta: se registra aparte, con su archivo y sin el marcador; al cliente nada (6/10/2026)', async () => {
    const vieja = abiertaCaja({ id: 'q-foto1', consulta: '[el cliente mandó esta foto]', tema: null, creado_en: new Date(Date.now() - 40 * 60_000).toISOString() });
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', '[el cliente mandó esta foto]'], ['assistant', 'Sí, Fernet Branca 750 cc a $15.000.'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [vieja], error: null }, insert: { data: { id: 'q-foto2' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('El Rutini Malbec sale $52.000.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, archivoBase64: '/9j/4AAQ', mimeType: 'image/jpeg', archivoUrl: 'https://x/foto2.jpg' });
    // solo la foto, y lo que el bot dijo de ella no tenía fuente: se consulta y no sale nada
    expect(r.respuesta).toBeNull();
    expect(r.silencio).toBe(true);
    const fila = insertsDe(db, 'bot_consultas_internas')[0]?.fila;
    expect(fila.consulta).toBe('Revisar la foto que mandó el cliente');
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].text).toContain('https://x/foto2.jpg');
  });

  it('(G) foto sin texto, consultar_interno con el tema de la abierta y el modelo no escribe nada: al cliente nada, y el archivo le llega al área', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nLo de la caja para viajar te lo confirmo por acá.`])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja()], error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'local', consulta: 'El cliente mandó la foto de la caja que quiere', tema: 'la caja para viajar', direccion: '' })), texto('')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, archivoBase64: '/9j/4AAQ', mimeType: 'image/jpeg', archivoUrl: 'https://x/caja.jpg' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    // sin tocar el id del aviso original: va un «dato nuevo» con el archivo
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].text).toMatch(/^Dato nuevo para una consulta/);
    expect((wsp.mock.calls[0] as any[])[0].text).toContain('https://x/caja.jpg');
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => 'waha_msg_id' in u.fila)).toBe(false);
  });

  it('(C) «¿y este?» con una foto y un precio sin fuente: se consulta y al cliente nada (antes salía «Eso también te lo confirmo por acá.»)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', '[el cliente mandó esta foto]'], ['assistant', 'Ya te confirmo por acá.'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-este' }, error: null } },
    });
    const { s } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('Ese sale $48.000.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿y este?', archivoBase64: '/9j/4AAQ', mimeType: 'image/jpeg', archivoUrl: 'https://x/foto3.jpg' });
    expect(r.respuesta).toBeNull();
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
  });

  it('(F) la reescritura devuelve el mensaje anterior tal cual: se descarta y no sale repetido (nunca el mismo mensaje dos veces)', async () => {
    const abierta = abiertaCaja({ id: 'f764d448', tema: null });
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Me llevo los 3 y un judas más.'], ['assistant', M12])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [abierta], error: null } },
    });
    const { s } = servicio(db);
    const crear = jest.fn()
      .mockResolvedValueOnce(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', direccion: '' })))
      .mockResolvedValueOnce(texto('Te confirmo por acá lo de la caja.'))
      .mockResolvedValueOnce(texto(M12));
    s.claude = { messages: { create: crear } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: AUDIO_14, deAudio: true });
    expect(r.respuesta).not.toBe(M12);
    expect(r.respuesta).toBeNull();
  });

  it('(1) «¿Tenés el Catena en magnum?» a compras no se junta con la caja abierta del local: fila, alerta y WhatsApp propios, y al cliente nada', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'vienen en cajas individuales?'], ['assistant', `${M8}\n\nLo de la caja para viajar te lo confirmo por acá.`])) },
      lineas_whatsapp: { select: { data: { ...CFG, whatsapp_compras: '5491100000999' }, error: null } },
      bot_consultas_internas: { select: { data: [abiertaCaja({ id: 'W-1602-caja' })], error: null }, insert: { data: { id: 'q-magnum' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'compras', consulta: '¿Tenemos Catena Zapata Malbec Argentino en magnum 1,5 L?', tema: 'el Catena Zapata en magnum', direccion: '' })), texto('')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Tenés el Catena en magnum?' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(insertsDe(db, 'alertas_internas')).toHaveLength(1);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toBeNull();
  });

  it('otro teléfono, una ya respondida y una de hace 8 h no se juntan (la lectura filtra por teléfono, abiertas y ventana)', async () => {
    const igual = { linea: 'pedidos', area: 'local', consulta: CAJA_1617, tema: 'la caja para viajar', waha_msg_id: 'W', respuesta_admin: null };
    const filas = [
      { ...igual, id: 'otro-tel', telefono_cliente: '5491199999999', respondido_en: null, creado_en: new Date(Date.now() - 5 * 60_000).toISOString() },
      { ...igual, id: 'respondida', telefono_cliente: TEL, respondido_en: new Date().toISOString(), creado_en: new Date(Date.now() - 5 * 60_000).toISOString() },
      { ...igual, id: 'vieja', telefono_cliente: TEL, respondido_en: null, creado_en: new Date(Date.now() - 8 * 3600_000).toISOString() },
      { ...igual, id: 'otra-linea', linea: 'proveedores', telefono_cliente: TEL, respondido_en: null, creado_en: new Date(Date.now() - 5 * 60_000).toISOString() },
    ];
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: filas, error: null }, insert: { data: { id: 'q-nueva' }, error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', CAJA_1617, '', undefined, 'la caja para viajar');
    expect(r).toMatchObject({ yaEstaba: false, consulta_id: 'q-nueva' });
    expect(wsp).toHaveBeenCalledTimes(1);
  });

  it('el mismo tema con un dato nuevo: se suma, la alerta vuelve a quedar sin leer y el área recibe el dato (sin tocar el id original)', async () => {
    const casancrem = { id: 'q-casan', linea: 'pedidos', telefono_cliente: TEL, respondido_en: null, area: 'local', consulta: '¿Hay Casancrem tapa roja 290 g?', tema: 'el Casancrem', waha_msg_id: 'W-CAS', respuesta_admin: null, creado_en: new Date(Date.now() - 60 * 60_000).toISOString() };
    const db = baseFalsa({ lineas_whatsapp: { select: { data: CFG, error: null } }, bot_consultas_internas: { select: { data: [casancrem], error: null } } });
    const { s, wsp } = servicio(db);
    const r: any = await s.consultarInterno('pedidos', TEL, 'local', 'Si no hay Casancrem, que mandemos el descremado', '', undefined, 'el Casancrem');
    expect(r.yaEstaba).toBe(true);
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(0);
    expect(updatesDe(db, 'alertas_internas')[0].fila).toMatchObject({ leida_en: null });
    expect(wsp).toHaveBeenCalledTimes(1);
    expect((wsp.mock.calls[0] as any[])[0].text).toMatch(/^Dato nuevo para una consulta que sigue sin respuesta \(local\)/);
    expect((wsp.mock.calls[0] as any[])[0].text).toContain('descremado');
    expect(updatesDe(db, 'bot_consultas_internas').some((u: Escritura) => 'waha_msg_id' in u.fila)).toBe(false);
  });

  it('el estado de la charla y el freno de repetidas miran la misma ventana', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q1' }, error: null } },
    });
    const { s } = servicio(db);
    const ventanas = jest.spyOn(s, 'consultasAbiertas');
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('c1', 'consultar_interno', { area: 'local', consulta: '¿Hay Casancrem?', tema: 'el Casancrem', direccion: '' })), texto('')) } };
    await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Hay Casancrem?' });
    const horas = ventanas.mock.calls.map((c: any[]) => c[2]);
    expect(horas.length).toBeGreaterThanOrEqual(2);
    expect(new Set(horas).size).toBe(1);
  });

  it('una consulta de pago derivada a administración: «Recibido.» y nada más, sin otra consulta (regla del 23/9 y del 6/10/2026)', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Hola'], ['assistant', 'Buenas tardes, ¿en qué te ayudo?'])) },
      lineas_whatsapp: { select: { data: { ...CFG, alias_pago: 'outlet.de.bebidas' }, error: null } },
      alertas_internas: { select: { data: null, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'NO-DEBERIA' }, error: null } },
    });
    const { s } = servicio(db);
    s.identificarCliente = jest.fn(async () => ({ existe: true, nombre: 'Pablo' }));
    const consultar = jest.spyOn(s, 'consultarInterno');
    s.claude = { messages: { create: claudeCon(conHerramientas(herramienta('d1', 'derivar_pago', { tipo: 'consulta', monto: 0, motivo: 'Pregunta si llegó la transferencia de ayer', de_quien: 'Pablo' })), texto('Recibido, le confirmo por acá.')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: '¿Les llegó la transferencia de ayer?' });
    expect(consultar).not.toHaveBeenCalled();
    expect(r.respuesta).toBe('Recibido.');
  });

  it('la disputa de precio por segunda vez: la consulta a administración la registra el código con tema, y al cliente nada de eso', async () => {
    const db = baseFalsa({
      bot_conversaciones: { select: conv(h(['user', 'Son 18 botellas, está mal la cuenta'], ['assistant', 'El total está correcto: corresponde al pack de 6.'])) },
      lineas_whatsapp: { select: { data: CFG, error: null } },
      bot_consultas_internas: { select: { data: [], error: null }, insert: { data: { id: 'q-precio' }, error: null } },
    });
    const { s, wsp } = servicio(db);
    s.claude = { messages: { create: claudeCon(texto('El total es correcto, corresponde al pack.'), texto('')) } };
    const r: any = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Está mal la cuenta, son 18 botellas de $1.950 c/u' });
    const fila = insertsDe(db, 'bot_consultas_internas')[0]?.fila;
    expect(fila).toMatchObject({ area: 'administracion', tema: 'el precio' });
    expect(insertsDe(db, 'bot_consultas_internas')).toHaveLength(1);
    expect(wsp).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toBeNull();
  });
});
