const mockCartel = jest.fn(async (_n: any) => Buffer.from('png'));
jest.mock('../comun/cartel-pedido', () => ({ ...jest.requireActual('../comun/cartel-pedido'), cartelNotaDePedido: (n: any) => mockCartel(n) }));

import { PedidosProveedorService, envioAutomaticoActivo, epigrafePedido, observacionParaProveedor, telefonoLegible, textoPedido } from './pedidos-proveedor.service';

// El pedido le llega al proveedor por WhatsApp (2/10/2026). WAHA va simulado:
// acá no sale ningún mensaje.

const ocBase = {
  id: 'oc1', numero: 57, estado: 'aprobada', total: 1000, creado_en: '2026-10-02T10:00:00-03:00', fecha_entrega: null,
  condicion_pago: null, observaciones: null, creada_por: 'u-comprador', aprobada_por: 'u-duenio', whatsapp_estado: 'enviando',
  whatsapp_telefono: null, proveedor_id: 'pv1',
  proveedor: { razon_social: 'Luvik Mayorista', cuit: '30712345678', telefono: '11 3319-5593', email: null, condicion_pago: 'contado' },
  sucursal: { nombre: 'Suc Sant Thomas', direccion: 'Mariano Castex 3601' },
  items: [
    { producto_id: 'p1', cantidad: 12, costo_unitario: 100, producto: { sku: 'L1', nombre: 'Jugo Baggio 1LT' } },
    { producto_id: 'p2', cantidad: 6, costo_unitario: 50, producto: { sku: 'L2', nombre: 'Aceite Cañuelas 900cc' } },
  ],
};

function dbFalsa(o: { tomada?: boolean; oc?: any; faltan?: string[]; enviadasHoy?: number; contactoExiste?: boolean; esDeLaCasa?: boolean; estadoActual?: any } = {}) {
  const log: any[] = [];
  const oc = { ...ocBase, ...(o.oc ?? {}) };
  const db: any = {
    log,
    rpc: jest.fn(async (nombre: string, args: any) => {
      log.push({ rpc: nombre, args });
      if (nombre === 'oc_tomar_envio') return { data: o.tomada ?? true, error: null };
      if (nombre === 'proveedor_faltantes') return { data: o.faltan ?? [], error: null };
      if (nombre === 'emitir_documento') return { data: { folio: 'OC-2026-00002', emitido_en: '2026-10-02T10:05:00Z' }, error: null };
      return { data: null, error: null };
    }),
    from(tabla: string) {
      const q: any = { tabla, ops: [] as any[] };
      const resultado = () => {
        const op = q.ops.map((x: any) => x[0]);
        if (tabla === 'ordenes_compra' && op.includes('update')) {
          log.push({ update: tabla, datos: q.ops.find((x: any) => x[0] === 'update')[1] });
          return { data: { whatsapp_intentos: 1 }, error: null };
        }
        if (tabla === 'ordenes_compra' && q.ops.some((x: any) => x[0] === 'select' && x[2]?.head)) return { data: null, count: o.enviadasHoy ?? 0, error: null };
        if (tabla === 'ordenes_compra') return { data: o.estadoActual ?? oc, error: null };
        if (tabla === 'proveedor_productos') return { data: [{ producto_id: 'p1', codigo_proveedor: 'BAG1' }], error: null };
        if (tabla === 'usuarios' && q.ops.some((x: any) => x[0] === 'eq' && x[1] === 'telefono')) return { data: o.esDeLaCasa ? [{ id: 'u-duenio' }] : [], error: null };
        if (tabla === 'usuarios') return { data: [{ id: 'u-comprador', nombre: 'Anabella' }, { id: 'u-duenio', nombre: 'Juan Pablo' }], error: null };
        if (tabla === 'bot_contactos' && op.includes('insert')) { log.push({ insert: tabla, datos: q.ops.find((x: any) => x[0] === 'insert')[1] }); return { data: null, error: null }; }
        if (tabla === 'bot_contactos') return { data: o.contactoExiste ? [{ telefono: '117269803880579' }] : [], error: null };
        if (tabla === 'alertas_internas' || tabla === 'bot_envios') { log.push({ insert: tabla, datos: q.ops.find((x: any) => x[0] === 'insert')?.[1] }); return { data: null, error: null }; }
        return { data: null, error: null };
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit', 'update', 'insert', 'neq', 'is']) {
        q[m] = (...a: any[]) => { q.ops.push([m, ...a]); return q; };
      }
      q.maybeSingle = async () => resultado();
      q.then = (ok: any, err: any) => Promise.resolve(resultado()).then(ok, err);
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        upload: jest.fn(async (ruta: string) => { log.push({ subido: `${bucket}/${ruta}` }); return { error: null }; }),
        createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://x.supabase.co/firmado/OC-2026-00002.pdf?token=t' }, error: null })),
        getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://x.supabase.co/publico/${ruta}` } }),
      }),
    },
  };
  return db;
}

const llamadasWaha: any[] = [];
// qué números "tienen WhatsApp" para la consulta check-exists de WAHA
let conWhatsapp = new Set(['5491133195593']);
function fetchFalso(envio?: (url: string) => any) {
  return jest.fn(async (url: string, init?: any) => {
    if (String(url).includes('/api/contacts/check-exists')) {
      const tel = new URL(url).searchParams.get('phone')!;
      return { ok: true, status: 200, json: async () => ({ numberExists: conWhatsapp.has(tel), chatId: `${tel}@c.us` }) };
    }
    llamadasWaha.push({ url, cuerpo: JSON.parse(init.body) });
    if (envio) return envio(url);
    return { ok: true, status: 201, json: async () => ({ id: { _serialized: `true_5491133195593@c.us_${llamadasWaha.length}` } }) };
  });
}
beforeEach(() => {
  conWhatsapp = new Set(['5491133195593']);
  llamadasWaha.length = 0;
  mockCartel.mockReset();
  mockCartel.mockImplementation(async () => Buffer.from('png'));
  process.env.WAHA_URL = 'https://waha.prueba';
  process.env.WAHA_API_KEY = 'k';
  delete process.env.ODB_OC_WHATSAPP;
  (global as any).fetch = fetchFalso();
});

describe('pedido al proveedor: el mensaje', () => {
  it('dice el folio, a dónde y qué, con el código del proveedor', () => {
    const t = textoPedido({
      folio: 'OC-2026-00002', proveedor: 'Luvik', sucursal: 'Saint Thomas', direccion: 'Mariano Castex 3601',
      items: [{ nombre: 'Jugo Baggio 1LT', cantidad: 12, codigoProveedor: 'BAG1' }, { nombre: 'Aceite', cantidad: 1500 }],
    });
    expect(t).toContain('*OC-2026-00002*');
    expect(t).toContain('*Saint Thomas (Mariano Castex 3601)*');
    expect(t).toContain('• 12 × Jugo Baggio 1LT (cód. BAG1)');
    expect(t).toContain('• 1.500 × Aceite');
    expect(t).not.toMatch(/\$/); // sin precios
  });

  it('con muchos productos lista 25 y manda al PDF', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ nombre: `P${i}`, cantidad: 1 }));
    const t = textoPedido({ folio: 'F', proveedor: 'X', sucursal: 'Santa Inés', items });
    expect(t.match(/^• \d/gm)).toHaveLength(25);
    expect(t).toContain('…y 5 productos más (están todos en el PDF)');
  });

  it('el envío automático se apaga con ODB_OC_WHATSAPP=0', () => {
    expect(envioAutomaticoActivo({})).toBe(true);
    expect(envioAutomaticoActivo({ ODB_OC_WHATSAPP: '0' })).toBe(false);
    expect(envioAutomaticoActivo({ ODB_OC_WHATSAPP: 'apagado' })).toBe(false);
  });
});

describe('pedido al proveedor: el envío', () => {
  it('sale la tarjeta Placa roja con el saludo y después el PDF; la orden pasa a enviada', async () => {
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', { usuarioId: 'u-duenio' });
    expect(r).toMatchObject({ enviado: true, estado: 'enviado', folio: 'OC-2026-00002', telefono: '+54 9 11 3319-5593' });
    expect(llamadasWaha.map((l) => l.url)).toEqual(['https://waha.prueba/api/sendImage', 'https://waha.prueba/api/sendFile']);
    expect(llamadasWaha[0].cuerpo.chatId).toBe('5491133195593@c.us');
    expect(llamadasWaha[0].cuerpo.file.url).toMatch(/publico\/carteles\/.*nota-pedido-OC-2026-00002/);
    expect(llamadasWaha[0].cuerpo.caption).toContain('*OC-2026-00002*');
    // la tarjeta lleva los productos con su código, sin precios
    expect(mockCartel.mock.calls[0][0]).toMatchObject({
      folio: 'OC-2026-00002', sucursal: 'Saint Thomas',
      renglones: expect.arrayContaining([{ nombre: 'Jugo Baggio 1LT', cantidad: 12, codigoProveedor: 'BAG1' }]),
    });
    expect(JSON.stringify(mockCartel.mock.calls[0][0])).not.toMatch(/costo|precio|100/);
    expect(llamadasWaha[1].cuerpo.file.filename).toBe('OC-2026-00002.pdf');
    const upd = db.log.filter((l: any) => l.update).pop().datos;
    expect(upd).toMatchObject({ estado: 'enviada', whatsapp_estado: 'enviado', whatsapp_telefono: '5491133195593', enviada_por: 'u-duenio', whatsapp_error: null });
    // el eco del mensaje no se toma como alguien escribiendo desde el teléfono
    expect(db.log.filter((l: any) => l.insert === 'bot_envios')).toHaveLength(2);
    // contacto nuevo: queda como proveedor
    expect(db.log.find((l: any) => l.insert === 'bot_contactos').datos).toMatchObject({ tipo: 'proveedor', proveedor_id: 'pv1' });
    expect(db.log.filter((l: any) => l.subido).map((l: any) => l.subido)).toContain('comprobantes/notas-de-pedido/OC-2026-00002.pdf');
  });

  it('si la tarjeta no se puede dibujar, el pedido sale igual en texto', async () => {
    mockCartel.mockImplementation(async () => { throw new Error('sin fuentes'); });
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.enviado).toBe(true);
    expect(llamadasWaha.map((l) => l.url)).toEqual(['https://waha.prueba/api/sendText', 'https://waha.prueba/api/sendFile']);
    expect(llamadasWaha[0].cuerpo.text).toContain('• 12 × Jugo Baggio 1LT (cód. BAG1)');
  });

  it('el epígrafe saluda, dice el número y a dónde, sin precios', () => {
    const t = epigrafePedido({ folio: 'OC-2026-00002', sucursal: 'Santa Inés', direccion: null });
    expect(t).toContain('*O.D.B Premium Market*');
    expect(t).toContain('*OC-2026-00002* para entregar en *Santa Inés*');
    expect(t).not.toMatch(/\$/);
  });

  it('un contacto que ya existe (puede ser un cliente) no se reclasifica, aunque esté guardado por su @lid', async () => {
    const db = dbFalsa({ contactoExiste: true });
    await new PedidosProveedorService(db).enviar('oc1', {});
    expect(db.log.find((l: any) => l.insert === 'bot_contactos')).toBeUndefined();
  });

  it('alguien de la casa (un usuario con ese teléfono) nunca queda marcado como proveedor', async () => {
    const db = dbFalsa({ esDeLaCasa: true });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.enviado).toBe(true);
    expect(db.log.find((l: any) => l.insert === 'bot_contactos')).toBeUndefined();
  });

  it('un número sin WhatsApp (un fijo) no recibe nada y no se reintenta solo', async () => {
    conWhatsapp = new Set();
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/no tiene WhatsApp/);
    expect(llamadasWaha).toHaveLength(0);
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ whatsapp_estado: 'error', whatsapp_intentos: 3 });
  });

  it('el WhatsApp Business de un fijo (54 sin el 9) se encuentra y se usa', async () => {
    conWhatsapp = new Set(['541143025555']);
    const db = dbFalsa({ oc: { proveedor: { ...ocBase.proveedor, telefono: '011 4302-5555' } } });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r).toMatchObject({ enviado: true, telefono: '+54 11 4302-5555' });
    expect(llamadasWaha[0].cuerpo.chatId).toBe('541143025555@c.us');
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ whatsapp_telefono: '541143025555' });
  });

  it('si WhatsApp no contesta a tiempo NO se reintenta solo (el pedido podría haber llegado)', async () => {
    (global as any).fetch = fetchFalso(() => { throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }); });
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/puede que le haya llegado/);
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ whatsapp_estado: 'error', whatsapp_intentos: 3 });
  });

  it('apenas sale el primer mensaje queda anotado (por si algo se corta antes de terminar)', async () => {
    const db = dbFalsa();
    await new PedidosProveedorService(db).enviar('oc1', {});
    const updates = db.log.filter((l: any) => l.update).map((l: any) => l.datos);
    expect(updates[0]).toMatchObject({ whatsapp_msg_id: 'true_5491133195593@c.us_1', whatsapp_telefono: '5491133195593' });
  });

  it('teléfono legible para celular y para fijo', () => {
    expect(telefonoLegible('5491133195593')).toBe('+54 9 11 3319-5593');
    expect(telefonoLegible('541143025555')).toBe('+54 11 4302-5555');
  });

  it('si otro ya lo está mandando o ya salió, no lo manda dos veces', async () => {
    const db = dbFalsa({ tomada: false, estadoActual: { numero: 57, estado: 'enviada', whatsapp_estado: 'enviado', whatsapp_telefono: '5491133195593' } });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('ya_enviada');
    expect(llamadasWaha).toHaveLength(0);
  });

  it('al proveedor le faltan datos: no sale nada y se dice qué falta', async () => {
    const db = dbFalsa({ faltan: ['teléfono / WhatsApp', 'plazo de entrega'] });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r).toMatchObject({ enviado: false, estado: 'error' });
    expect(r.mensaje).toMatch(/teléfono \/ WhatsApp, plazo de entrega/);
    expect(llamadasWaha).toHaveLength(0);
    expect(db.log.find((l: any) => l.insert === 'alertas_internas').datos).toMatchObject({ para_usuario: 'u-comprador', tipo: 'oc_no_salio' });
  });

  it('un teléfono sin código de área no se usa', async () => {
    conWhatsapp = new Set(['42221234']);
    const db = dbFalsa({ oc: { proveedor: { ...ocBase.proveedor, telefono: '4222-1234' } } });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/no es argentino con código de área/);
    expect(llamadasWaha).toHaveLength(0);
  });

  it('con el tope diario alcanzado no sale (cuida la línea del bot)', async () => {
    const db = dbFalsa({ enviadasHoy: 20 });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.mensaje).toMatch(/tope 20/);
    expect(llamadasWaha).toHaveLength(0);
  });

  it('si WhatsApp rechaza el envío (4xx), la orden queda aprobada con el motivo y se reintenta', async () => {
    (global as any).fetch = fetchFalso(() => ({ ok: false, status: 422, json: async () => ({}) }));
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    const upd = db.log.filter((l: any) => l.update).pop().datos;
    expect(upd).toMatchObject({ whatsapp_estado: 'error' });
    expect(upd.estado).toBeUndefined();
  });

  it('si sale el texto pero no el PDF, el pedido igual cuenta como enviado y se avisa', async () => {
    let n = 0;
    (global as any).fetch = fetchFalso(() => (++n === 1
      ? { ok: true, status: 201, json: async () => ({ id: 'm1' }) }
      : { ok: false, status: 500, json: async () => ({}) }));
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.enviado).toBe(true);
    expect(r.mensaje).toMatch(/el PDF no salió/);
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ estado: 'enviada', whatsapp_error: expect.stringMatching(/PDF no salió/) });
  });

  it('apagado: lo automático no sale ni toma la orden, y queda marcada para que el cron no la mande al prender', async () => {
    process.env.ODB_OC_WHATSAPP = '0';
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', { automatico: true });
    expect(r.estado).toBe('apagado');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ whatsapp_estado: 'error', whatsapp_intentos: 3 });
  });

  it('el texto para mandar a mano lista todo y no promete un PDF', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ nombre: `P${i}`, cantidad: 1 }));
    const t = textoPedido({ folio: 'F', proveedor: 'X', sucursal: 'Santa Inés', items, conPdf: false });
    expect(t.match(/^• \d/gm)).toHaveLength(30);
    expect(t).not.toMatch(/PDF/);
  });
});

describe('pedido al proveedor: lo interno no sale', () => {
  it('las marcas internas de la orden no le llegan al proveedor (prueba del 2/10/2026)', async () => {
    expect(observacionParaProveedor('Armada desde Qué comprar')).toBeNull();
    expect(observacionParaProveedor('Armada con el agente de abastecimiento')).toBeNull();
    expect(observacionParaProveedor('Traer en cajas cerradas')).toBe('Traer en cajas cerradas');
    const db = dbFalsa({ oc: { observaciones: 'Armada desde Qué comprar' } });
    await new PedidosProveedorService(db).enviar('oc1', {});
    expect(llamadasWaha[0].cuerpo.caption).not.toMatch(/Qué comprar|Nota:/);
  });

  it('una observación del comprador sí viaja en el epígrafe', async () => {
    const db = dbFalsa({ oc: { observaciones: 'Traer en cajas cerradas' } });
    await new PedidosProveedorService(db).enviar('oc1', {});
    expect(llamadasWaha[0].cuerpo.caption).toContain('Nota: Traer en cajas cerradas');
  });
});
