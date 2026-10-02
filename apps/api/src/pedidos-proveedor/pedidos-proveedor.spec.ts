import { PedidosProveedorService, envioAutomaticoActivo, textoPedido } from './pedidos-proveedor.service';

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

function dbFalsa(o: { tomada?: boolean; oc?: any; faltan?: string[]; enviadasHoy?: number; contactoExiste?: boolean; estadoActual?: any } = {}) {
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
        if (tabla === 'usuarios') return { data: [{ id: 'u-comprador', nombre: 'Anabella' }, { id: 'u-duenio', nombre: 'Juan Pablo' }], error: null };
        if (tabla === 'bot_contactos' && op.includes('insert')) { log.push({ insert: tabla, datos: q.ops.find((x: any) => x[0] === 'insert')[1] }); return { data: null, error: null }; }
        if (tabla === 'bot_contactos') return { data: o.contactoExiste ? { telefono: '5491133195593' } : null, error: null };
        if (tabla === 'alertas_internas' || tabla === 'bot_envios') { log.push({ insert: tabla, datos: q.ops.find((x: any) => x[0] === 'insert')?.[1] }); return { data: null, error: null }; }
        return { data: null, error: null };
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit', 'update', 'insert']) {
        q[m] = (...a: any[]) => { q.ops.push([m, ...a]); return q; };
      }
      q.maybeSingle = async () => resultado();
      q.then = (ok: any, err: any) => Promise.resolve(resultado()).then(ok, err);
      return q;
    },
    storage: {
      from: () => ({
        upload: jest.fn(async (ruta: string) => { log.push({ subido: ruta }); return { error: null }; }),
        createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://x.supabase.co/firmado/OC-2026-00002.pdf?token=t' }, error: null })),
      }),
    },
  };
  return db;
}

const llamadasWaha: any[] = [];
beforeEach(() => {
  llamadasWaha.length = 0;
  process.env.WAHA_URL = 'https://waha.prueba';
  process.env.WAHA_API_KEY = 'k';
  delete process.env.ODB_OC_WHATSAPP;
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    llamadasWaha.push({ url, cuerpo: JSON.parse(init.body) });
    return { ok: true, status: 201, json: async () => ({ id: { _serialized: `true_5491133195593@c.us_${llamadasWaha.length}` } }) };
  });
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
  it('sale el texto y el PDF al celular del proveedor y la orden pasa a enviada', async () => {
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', { usuarioId: 'u-duenio' });
    expect(r).toMatchObject({ enviado: true, estado: 'enviado', folio: 'OC-2026-00002', telefono: '+54 9 11 3319-5593' });
    expect(llamadasWaha.map((l) => l.url)).toEqual(['https://waha.prueba/api/sendText', 'https://waha.prueba/api/sendFile']);
    expect(llamadasWaha[0].cuerpo.chatId).toBe('5491133195593@c.us');
    expect(llamadasWaha[0].cuerpo.text).toContain('• 12 × Jugo Baggio 1LT (cód. BAG1)');
    expect(llamadasWaha[1].cuerpo.file.filename).toBe('OC-2026-00002.pdf');
    const upd = db.log.filter((l: any) => l.update).pop().datos;
    expect(upd).toMatchObject({ estado: 'enviada', whatsapp_estado: 'enviado', whatsapp_telefono: '5491133195593', enviada_por: 'u-duenio', whatsapp_error: null });
    // el eco del mensaje no se toma como alguien escribiendo desde el teléfono
    expect(db.log.filter((l: any) => l.insert === 'bot_envios')).toHaveLength(2);
    // contacto nuevo: queda como proveedor
    expect(db.log.find((l: any) => l.insert === 'bot_contactos').datos).toMatchObject({ tipo: 'proveedor', proveedor_id: 'pv1' });
    expect(db.log.find((l: any) => l.subido)?.subido).toBe('notas-de-pedido/OC-2026-00002.pdf');
  });

  it('un contacto que ya existe (puede ser un cliente o alguien de la casa) no se reclasifica', async () => {
    const db = dbFalsa({ contactoExiste: true });
    await new PedidosProveedorService(db).enviar('oc1', {});
    expect(db.log.find((l: any) => l.insert === 'bot_contactos')).toBeUndefined();
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

  it('un teléfono fijo o sin código de área no se usa', async () => {
    const db = dbFalsa({ oc: { proveedor: { ...ocBase.proveedor, telefono: '4222-1234' } } });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    expect(r.mensaje).toMatch(/no es un celular/);
    expect(llamadasWaha).toHaveLength(0);
  });

  it('con el tope diario alcanzado no sale (cuida la línea del bot)', async () => {
    const db = dbFalsa({ enviadasHoy: 20 });
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.mensaje).toMatch(/tope 20/);
    expect(llamadasWaha).toHaveLength(0);
  });

  it('si WhatsApp rechaza el texto, la orden queda aprobada con el motivo', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.estado).toBe('error');
    const upd = db.log.filter((l: any) => l.update).pop().datos;
    expect(upd).toMatchObject({ whatsapp_estado: 'error' });
    expect(upd.estado).toBeUndefined();
  });

  it('si sale el texto pero no el PDF, el pedido igual cuenta como enviado y se avisa', async () => {
    let n = 0;
    (global as any).fetch = jest.fn(async () => (++n === 1
      ? { ok: true, status: 201, json: async () => ({ id: 'm1' }) }
      : { ok: false, status: 500, json: async () => ({}) }));
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', {});
    expect(r.enviado).toBe(true);
    expect(r.mensaje).toMatch(/el PDF no salió/);
    expect(db.log.filter((l: any) => l.update).pop().datos).toMatchObject({ estado: 'enviada', whatsapp_error: expect.stringMatching(/PDF no salió/) });
  });

  it('apagado: lo automático no sale ni toma la orden', async () => {
    process.env.ODB_OC_WHATSAPP = '0';
    const db = dbFalsa();
    const r = await new PedidosProveedorService(db).enviar('oc1', { automatico: true });
    expect(r.estado).toBe('apagado');
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
