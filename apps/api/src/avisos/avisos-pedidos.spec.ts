import { AvisosPedidosService } from './avisos-pedidos.service';
import { esperaParaReintentar, idLargoDeMensaje, origenDelPedido, telefonoLegible, textoDelAviso, type PedidoParaAviso } from './aviso-pedido';

// REGLA (Leandro, 3/10/2026): toda confirmación de pedido sale al teléfono de
// administración. El 3/10 el bot confirmó PICKUP-5F2451C6C111 y no se avisó a nadie.

const PEDIDO: PedidoParaAviso = {
  id: '500e1312-3e5c-43f2-84e1-6ff5987c7acc', qr_retiro: 'PICKUP-5F2451C6C111', canal: 'pickup', estado: 'recibido',
  total: 133500, creado_en: '2026-10-03T13:10:13Z', notas: 'Retira mañana antes del mediodía en sucursal Saint Thomas.',
  destino_direccion: null, entrega_fecha: '2026-10-04', entrega_franja: 'mañana', pagado_en: null,
  cliente: { nombre: null, telefono: '230566779732018' }, telefonoReal: '5491135901236',
  items: [{ nombre: 'Combo Picada Box', cantidad: 3, precio_unitario: 44500 }], esDelBot: true,
};

describe('el texto del aviso a administración', () => {
  it('el pedido de las picadas: código, por dónde entró, cuándo se retira, el cliente y el total', () => {
    expect(textoDelAviso(PEDIDO, { conRenglones: true })).toBe([
      'PEDIDO NUEVO · PICKUP-5F2451C6C111',
      'Entró por el WhatsApp de la casa (bot) a las 10:10.',
      'Retiro en la sucursal Saint Thomas, el domingo 4/10 por la mañana.',
      'Cliente: +54 9 11 3590-1236',
      '• 3 × Combo Picada Box — $133.500',
      'Total: $133.500. Se cobra al retirar.',
      'Notas: Retira mañana antes del mediodía en sucursal Saint Thomas.',
    ].join('\n'));
    // con la tarjeta, los productos van en la imagen
    expect(textoDelAviso(PEDIDO, { conRenglones: false })).not.toMatch(/Combo Picada Box/);
  });

  it('un envío sin dirección lo dice en vez de callarlo, y una compra sin cuenta también', () => {
    const t = textoDelAviso({ ...PEDIDO, canal: 'domicilio', qr_retiro: 'DOM-AB12CD', esDelBot: false, cliente: null, telefonoReal: null, entrega_fecha: null, entrega_franja: null }, { conRenglones: true });
    expect(t).toMatch(/Entró por la tienda web o la app/);
    expect(t).toMatch(/Envío a DIRECCIÓN SIN CARGAR \(revisar\)\./);
    expect(t).toMatch(/Cliente: sin datos \(compra sin cuenta\)/);
    expect(t).toMatch(/Se cobra al recibir\./);
  });

  it('el chat @lid no se muestra como teléfono; un pedido sin renglones se avisa igual', () => {
    const t = textoDelAviso({ ...PEDIDO, telefonoReal: null, items: [] }, { conRenglones: true });
    expect(t).toMatch(/Cliente: sin datos/);
    expect(t).toMatch(/sin productos cargados: revisar/);
  });

  it('por dónde entró', () => {
    expect(origenDelPedido({ qr_retiro: 'PY-123456', canal: 'web', esDelBot: false })).toBe('PedidosYa');
    expect(origenDelPedido({ qr_retiro: 'TN-99', canal: 'web', esDelBot: false })).toBe('Tiendanube');
    expect(origenDelPedido({ qr_retiro: 'WA-1', canal: 'whatsapp', esDelBot: false })).toMatch(/panel/);
  });

  it('teléfonos, ids y esperas', () => {
    expect(telefonoLegible('5491125213601')).toBe('+54 9 11 2521-3601');
    expect(telefonoLegible('5492214567890')).toBe('+54 9 221 456-7890');
    expect(idLargoDeMensaje('5491125213601@c.us', '3EB0AA')).toBe('true_5491125213601@c.us_3EB0AA');
    expect(idLargoDeMensaje('x@c.us', 'true_x@c.us_3EB0AA')).toBe('true_x@c.us_3EB0AA');
    expect([1, 2, 3, 6, 20].map(esperaParaReintentar)).toEqual([15_000, 30_000, 60_000, 480_000, 600_000]);
  });
});

// ---- el servicio, con la base, WhatsApp y el storage simulados ----

function baseFalsa(r: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any; filtros: any[] }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async (fn: string) => r[`rpc:${fn}`] ?? { data: null, error: null }),
    storage: { from: () => ({ upload: async () => r['storage:upload'] ?? { error: null }, getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://publico/${ruta}` } }) }) },
    from(tabla: string) {
      let op = 'select';
      let fila: any = null;
      const filtros: any[] = [];
      const b: any = {};
      for (const k of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'not']) b[k] = (...a: any[]) => { if (k !== 'select') filtros.push([k, ...a]); return b; };
      b.update = (f: any) => { op = 'update'; fila = f; escrituras.push({ tabla, op, fila, filtros }); return b; };
      b.insert = (f: any) => { op = 'insert'; fila = f; escrituras.push({ tabla, op, fila, filtros }); return b; };
      const res = () => (op === 'select' ? r[tabla] : r[`${tabla}:${op}`]) ?? { data: op === 'update' ? [{ pedido_id: 'x' }] : null, error: null };
      b.maybeSingle = b.single = async () => res();
      b.then = (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
      return b;
    },
  };
  return db;
}

const PEDIDO_DB = {
  id: PEDIDO.id, qr_retiro: PEDIDO.qr_retiro, canal: 'pickup', estado: 'recibido', total: 133500, creado_en: PEDIDO.creado_en,
  notas: PEDIDO.notas, destino_direccion: null, entrega_fecha: '2026-10-04', entrega_franja: 'mañana', pagado_en: null, cliente_id: 'cli-1',
  pedidos_items: [{ cantidad: 3, precio_unitario: 44500, productos: { nombre: 'Combo Picada Box' } }],
};
const TABLAS = {
  lineas_whatsapp: { data: { derivar_pagos_a: '5491125213601' } },
  pedidos: { data: PEDIDO_DB },
  clientes: { data: { nombre: null, telefono: '230566779732018' } },
  bot_cotizaciones: { data: { id: 'cot-1' } },
  bot_contactos: { data: { telefono_real: '5491135901236' } },
};
const FILA = { pedido_id: PEDIDO.id, creado_en: '2026-10-03T13:10:13Z', estado: 'pendiente', intentos: 1, incierto: false, destino: null, waha_id: null, enviado_en: null, ultimo_error: null, escalado_en: null, escalado_entrega_en: null };

describe('AvisosPedidosService: el aviso sale a administración', () => {
  const wsp = require('../comun/whatsapp');
  const tarjeta = require('../comun/cartel-pedido');
  let imagen: jest.SpyInstance; let texto: jest.SpyInstance; let carteles: jest.SpyInstance;
  beforeEach(() => {
    imagen = jest.spyOn(wsp, 'enviarImagenWhatsapp');
    texto = jest.spyOn(wsp, 'enviarTextoWhatsapp');
    carteles = jest.spyOn(tarjeta, 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
  });
  afterEach(() => jest.restoreAllMocks());
  const enviar = (s: AvisosPedidosService, f = FILA) => (s as any).enviar(f);
  const actualizacion = (db: any) => db.escrituras.filter((w: any) => w.tabla === 'avisos_pedidos' && w.op === 'update').pop()?.fila;

  it('manda la tarjeta PEDIDO NUEVO al teléfono de administración, con el texto como epígrafe, y lo marca enviado con el id', async () => {
    imagen.mockResolvedValue({ enviado: true, id: 'true_5491125213601@c.us_3EB0AA' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(imagen).toHaveBeenCalledWith(db, '5491125213601', expect.stringContaining('aviso-PICKUP-5F2451C6C111'), expect.stringContaining('PEDIDO NUEVO · PICKUP-5F2451C6C111'), 'aviso-pedido');
    expect(carteles.mock.calls[0][0]).toMatchObject({ titulo: 'PEDIDO NUEVO', subtitulo: 'PICKUP-5F2451C6C111', total: 133500 });
    expect(texto).not.toHaveBeenCalled();
    expect(actualizacion(db)).toMatchObject({ estado: 'enviado', destino: '5491125213601', waha_id: 'true_5491125213601@c.us_3EB0AA' });
  });

  it('si la tarjeta no sale, va el texto con los productos', async () => {
    imagen.mockResolvedValue({ enviado: false, motivo: 'WAHA sendImage 400' });
    texto.mockResolvedValue({ enviado: true, id: 'true_5491125213601@c.us_3EB0BB' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box — \$133\.500/);
    expect(actualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'true_5491125213601@c.us_3EB0BB' });
  });

  it('si la tarjeta no se puede armar, va el texto igual', async () => {
    carteles.mockRejectedValue(new Error('sin fuentes'));
    texto.mockResolvedValue({ enviado: true, id: 'X1' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(imagen).not.toHaveBeenCalled();
    expect(actualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'X1' });
  });

  it('si no sale nada, queda pendiente con el motivo y el próximo intento', async () => {
    imagen.mockResolvedValue({ enviado: false, motivo: 'WAHA sendImage 500', incierto: true });
    texto.mockResolvedValue({ enviado: false, motivo: 'WAHA sendText 400' });
    const db = baseFalsa({ ...TABLAS, 'avisos_pedidos:update': { data: [] } });
    // el incierto de la imagen: antes del texto se mira en el chat (no está)
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [] } as any);
    process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k';
    await enviar(new AvisosPedidosService(db));
    const f = actualizacion(db);
    expect(f.estado).toBeUndefined();
    expect(f.ultimo_error).toBe('WAHA sendText 400');
    expect(new Date(f.proximo_intento).getTime()).toBeGreaterThan(Date.now());
  });

  it('enviado sin id no cuenta: sin prueba de que salió, se reintenta', async () => {
    imagen.mockResolvedValue({ enviado: true, id: null });
    texto.mockResolvedValue({ enviado: true, id: null });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(actualizacion(db).estado).toBeUndefined();
    expect(actualizacion(db).ultimo_error).toMatch(/no devolvió el id/);
  });

  it('sin teléfono de administración cargado, no se da por enviado: queda la falla a la vista', async () => {
    const db = baseFalsa({ ...TABLAS, lineas_whatsapp: { data: { derivar_pagos_a: null } } });
    await enviar(new AvisosPedidosService(db));
    expect(imagen).not.toHaveBeenCalled();
    expect(actualizacion(db).ultimo_error).toMatch(/no hay teléfono de administración/);
  });

  it('un intento anterior incierto: si el mensaje ya está en el chat, no se manda de nuevo', async () => {
    process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k';
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [{ fromMe: true, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111', id: { _serialized: 'true_5491125213601@c.us_3EB0CC' } }] } as any);
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, incierto: true });
    expect(imagen).not.toHaveBeenCalled();
    expect(actualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'true_5491125213601@c.us_3EB0CC' });
  });
});

describe('AvisosPedidosService: que llegue y, si no, que se enteren los dueños', () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => { process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k'; delete process.env.AVISOS_ESCALAR_A; });

  it.each([[3, 'entregado'], [2, 'entregado'], [-1, 'pendiente']])('ack %s → %s', async (ack, estado) => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: [{ pedido_id: 'p1', destino: '5491125213601', waha_id: '3EB0AA', enviado_en: new Date().toISOString() }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/messages/true_5491125213601%40c.us_3EB0AA'), expect.anything());
    expect(db.escrituras.pop().fila).toMatchObject({ estado, ack });
  });

  it('un tilde solo: se vuelve a preguntar en un minuto', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: 1 }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: [{ pedido_id: 'p1', destino: '5491125213601', waha_id: '3EB0AA', enviado_en: new Date().toISOString() }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = db.escrituras.pop().fila;
    expect(f.estado).toBeUndefined();
    expect(new Date(f.proximo_intento).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('problemas: lo que no salió en 3 minutos y lo que no llegó en 15, sin los pedidos cancelados', async () => {
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const db = baseFalsa({ avisos_pedidos: { data: [
      { pedido_id: 'a', creado_en: hace(5), estado: 'pendiente', enviado_en: null, ultimo_error: 'WAHA 500', ack: null, pedidos: { qr_retiro: 'PICKUP-A', estado: 'recibido' } },
      { pedido_id: 'b', creado_en: hace(1), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, pedidos: { qr_retiro: 'PICKUP-B', estado: 'recibido' } },
      { pedido_id: 'c', creado_en: hace(30), estado: 'enviado', enviado_en: hace(20), ultimo_error: null, ack: 1, pedidos: { qr_retiro: 'DOM-C', estado: 'recibido' } },
      { pedido_id: 'd', creado_en: hace(30), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, pedidos: { qr_retiro: 'PICKUP-D', estado: 'cancelado' } },
    ] } });
    const p = await new AvisosPedidosService(db).problemas();
    expect(p.map((x) => [x.codigo, x.problema])).toEqual([['PICKUP-A', 'no_salio'], ['DOM-C', 'no_llego']]);
    expect(p[1].motivo).toMatch(/un solo tilde/);
  });

  it('escala UNA vez: WhatsApp a los dueños (no al mismo teléfono de administración) y campanita', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp').mockResolvedValue({ enviado: true, id: 'Z' });
    const db = baseFalsa({ ...TABLAS, usuarios: { data: [
      { id: 'u1', nombre: 'Leandro', telefono: '11 2660-0320' },
      { id: 'u2', nombre: 'Jaqueline', telefono: '5491124862295' },
      { id: 'u3', nombre: 'Admin', telefono: '5491125213601' },
    ] } });
    const s = new AvisosPedidosService(db);
    jest.spyOn(s, 'problemas').mockResolvedValue([{ pedidoId: PEDIDO.id, codigo: 'PICKUP-5F2451C6C111', problema: 'no_salio', minutos: 4, motivo: 'WAHA 500' }]);
    await (s as any).vigilar();
    expect(texto.mock.calls.map((c) => c[1])).toEqual(['5491126600320', '5491124862295']);
    expect(texto.mock.calls[0][2]).toMatch(/^ATENCIÓN: El aviso del pedido PICKUP-5F2451C6C111 NO SALIÓ a administración/);
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box/);
    expect(db.escrituras.filter((w: any) => w.tabla === 'alertas_internas')).toHaveLength(3);
    // ya marcado por otro proceso (la marca no se pudo poner): no se repite
    texto.mockClear();
    const db2 = baseFalsa({ ...TABLAS, 'avisos_pedidos:update': { data: [] } });
    const s2 = new AvisosPedidosService(db2);
    jest.spyOn(s2, 'problemas').mockResolvedValue([{ pedidoId: PEDIDO.id, codigo: 'PICKUP-5F2451C6C111', problema: 'no_salio', minutos: 4, motivo: null }]);
    await (s2 as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
  });

  it('la vuelta encola los faltantes, toma y manda; el interruptor de desarrollo la apaga', async () => {
    const db = baseFalsa({ 'rpc:encolar_avisos_faltantes': { data: 0 }, 'rpc:tomar_avisos_pedidos': { data: [] }, avisos_pedidos: { data: [] } });
    const s = new AvisosPedidosService(db);
    await s.vuelta();
    expect(db.rpc).toHaveBeenCalledWith('encolar_avisos_faltantes');
    expect(db.rpc).toHaveBeenCalledWith('tomar_avisos_pedidos', { p_limite: 5 });
    db.rpc.mockClear();
    process.env.ODB_AVISOS_PEDIDOS = '0';
    await s.vuelta();
    expect(db.rpc).not.toHaveBeenCalled();
    delete process.env.ODB_AVISOS_PEDIDOS;
  });
});
