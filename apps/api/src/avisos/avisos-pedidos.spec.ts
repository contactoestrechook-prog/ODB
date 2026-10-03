import { AvisosPedidosService } from './avisos-pedidos.service';
import {
  cuandoFue, encabezado, esperaParaEscalar, esperaParaReintentar, idLargoDeMensaje, origenDelPedido, telefonoLegible,
  textoDeCancelado, textoDelAviso, textoDePagado, textoDeSinCargar, type PedidoParaAviso,
} from './aviso-pedido';

// REGLA (Leandro, 3/10/2026): toda confirmación de pedido sale al teléfono de
// administración. El 3/10 el bot confirmó PICKUP-5F2451C6C111 y no se avisó a
// nadie. Estas pruebas incluyen cada falla que encontraron los agentes que
// atacaron la primera versión.

const AHORA = new Date('2026-10-03T13:11:00Z');
const PEDIDO: PedidoParaAviso = {
  id: '500e1312-3e5c-43f2-84e1-6ff5987c7acc', qr_retiro: 'PICKUP-5F2451C6C111', canal: 'pickup', estado: 'recibido',
  total: 133500, creado_en: '2026-10-03T13:10:13Z', notas: 'Retira mañana antes del mediodía en sucursal Saint Thomas.',
  destino_direccion: null, entrega_fecha: '2026-10-04', entrega_franja: 'mañana', pagado_en: null,
  cliente: { nombre: null, telefono: '230566779732018' }, telefonoReal: '5491135901236',
  items: [{ nombre: 'Combo Picada Box', cantidad: 3, precio_unitario: 44500 }], esDelBot: true,
};

describe('los textos de los avisos', () => {
  it('el pedido de las picadas: código, por dónde entró, cuándo se retira, el cliente y el total', () => {
    expect(textoDelAviso(PEDIDO, { conRenglones: true, ahora: AHORA })).toBe([
      'PEDIDO NUEVO · PICKUP-5F2451C6C111',
      'Entró por el WhatsApp de la casa (bot) a las 10:10.',
      'Retiro en la sucursal Saint Thomas, el domingo 4/10 por la mañana.',
      'Cliente: +54 9 11 3590-1236',
      '• 3 × Combo Picada Box — $133.500',
      'Total: $133.500. Se cobra al retirar.',
      'Notas: Retira mañana antes del mediodía en sucursal Saint Thomas.',
    ].join('\n'));
    // con la tarjeta, los productos van en la imagen
    expect(textoDelAviso(PEDIDO, { conRenglones: false, ahora: AHORA })).not.toMatch(/Combo Picada Box/);
  });

  it('la web o la app: no afirma "se cobra al retirar" (puede estar pagando por Mercado Pago)', () => {
    const t = textoDelAviso({ ...PEDIDO, canal: 'domicilio', qr_retiro: 'DOM-AB12CD', esDelBot: false, cliente: null, telefonoReal: null, entrega_fecha: null, entrega_franja: null }, { conRenglones: true, ahora: AHORA });
    expect(t).toMatch(/Entró por la tienda web o la app/);
    expect(t).toMatch(/Envío a DIRECCIÓN SIN CARGAR \(revisar\)\./);
    expect(t).toMatch(/Cliente: sin datos \(compra sin cuenta\)/);
    expect(t).toMatch(/Todavía no figura pagado: puede estar pagándolo por Mercado Pago/);
    expect(t).not.toMatch(/Se cobra al/);
    expect(textoDelAviso({ ...PEDIDO, esDelBot: false, qr_retiro: 'PICKUP-AB12CD', pagado_en: '2026-10-03T13:11:00Z' }, { conRenglones: false, ahora: AHORA })).toMatch(/Ya está pagado\./);
  });

  it('PedidosYa y Tiendanube dicen lo suyo; un retiro sin día dice "lo antes posible"', () => {
    const py = textoDelAviso({ ...PEDIDO, esDelBot: false, qr_retiro: 'PY-123456', canal: 'web' }, { conRenglones: false, ahora: AHORA });
    expect(py).toMatch(/Lo retira el repartidor de PedidosYa\./);
    expect(py).toMatch(/Lo cobra PedidosYa\./);
    const tn = textoDelAviso({ ...PEDIDO, esDelBot: false, qr_retiro: 'TN-99', canal: 'web' }, { conRenglones: false, ahora: AHORA });
    expect(tn).toMatch(/Tiendanube/);
    expect(textoDelAviso({ ...PEDIDO, entrega_fecha: null, entrega_franja: null }, { conRenglones: false, ahora: AHORA })).toMatch(/sin día pedido \(lo antes posible\)/);
  });

  it('un chat @lid sin teléfono real no se muestra como teléfono; un pedido sin renglones se avisa igual', () => {
    const t = textoDelAviso({ ...PEDIDO, telefonoReal: null, items: [] }, { conRenglones: true, ahora: AHORA });
    expect(t).toMatch(/Cliente: sin datos/);
    expect(t).toMatch(/sin productos cargados: revisar/);
  });

  it('la hora lleva el día si no es de hoy', () => {
    expect(cuandoFue('2026-10-03T13:10:13Z', AHORA)).toBe('a las 10:10');
    expect(cuandoFue('2026-10-03T02:50:00Z', AHORA)).toBe('ayer a las 23:50');
    expect(cuandoFue('2026-10-01T21:51:00Z', AHORA)).toMatch(/^el jue 1\/10 a las 18:51$/);
  });

  it('baja, pago y pedido sin cargar', () => {
    expect(textoDeCancelado(PEDIDO)).toMatch(/^PEDIDO CANCELADO · PICKUP-5F2451C6C111\nEl pedido se canceló: no lo preparen/);
    expect(textoDePagado({ ...PEDIDO, pagado_en: '2026-10-03T13:20:00Z' })).toMatch(/^PEDIDO PAGADO · PICKUP-5F2451C6C111\nSe pagó .* por Mercado Pago: no hay que cobrarlo al retirar\./);
    const s = textoDeSinCargar({ telefono: '230566779732018', telefonoReal: '5491135901236', nota: 'PEDIDO NO CARGADO (falló crear_pedido: Stock insuficiente)', resumen: '• Combo Picada Box — 3 × $44.500\nTotal: $133.500\n¿Lo confirmo?' });
    expect(s).toMatch(/^PEDIDO CONFIRMADO SIN CARGAR · \+54 9 11 3590-1236\nEl cliente confirmó un pedido por WhatsApp y el sistema NO lo pudo cargar/);
    expect(s).toMatch(/Lo último que se le cotizó:\n• Combo Picada Box — 3 × \$44\.500\nTotal: \$133\.500\nDetalle:/);
  });

  it('teléfonos, ids, esperas y orígenes', () => {
    expect(telefonoLegible('5491125213601')).toBe('+54 9 11 2521-3601');
    expect(telefonoLegible('5492214567890')).toBe('+54 9 221 456-7890');
    expect(telefonoLegible('230566779732018')).toBeNull();
    expect(idLargoDeMensaje('5491125213601@c.us', '3EB0AA')).toBe('true_5491125213601@c.us_3EB0AA');
    expect(idLargoDeMensaje('x@c.us', 'true_x@c.us_3EB0AA')).toBe('true_x@c.us_3EB0AA');
    expect([1, 2, 3, 6, 20].map(esperaParaReintentar)).toEqual([15_000, 30_000, 60_000, 480_000, 600_000]);
    expect([0, 1, 2, 10].map(esperaParaEscalar)).toEqual([60_000, 120_000, 240_000, 1_800_000]);
    expect(origenDelPedido({ qr_retiro: 'WA-1', canal: 'whatsapp', esDelBot: false })).toBe('panel');
    expect(encabezado('pedido_nuevo', 'X')).toBe('PEDIDO NUEVO · X');
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
      const filtros: any[] = [];
      const b: any = {};
      for (const k of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'not', 'or', 'ilike', 'like']) b[k] = (...a: any[]) => { if (k !== 'select') filtros.push([k, ...a]); return b; };
      b.update = (f: any) => { op = 'update'; escrituras.push({ tabla, op, fila: f, filtros }); return b; };
      b.insert = (f: any) => { op = 'insert'; escrituras.push({ tabla, op, fila: f, filtros }); return b; };
      b.upsert = (f: any) => { op = 'upsert'; escrituras.push({ tabla, op, fila: f, filtros }); return b; };
      const res = () => (op === 'select' ? r[tabla] : r[`${tabla}:${op}`]) ?? { data: op === 'update' ? [{ escalar_intentos: 0 }] : null, error: null };
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
  bot_cotizaciones: { data: { telefono: '230566779732018' } },
  bot_contactos: { data: { telefono_real: '5491135901236' } },
};
const FILA = { id: 'aviso-1', pedido_id: PEDIDO.id, tipo: 'pedido_nuevo' as const, detalle: null, creado_en: '2026-10-03T13:10:13Z', pendiente_desde: '2026-10-03T13:10:13Z', estado: 'pendiente', intentos: 1, incierto: false, destino: null, waha_id: null };
const ultimaActualizacion = (db: any) => db.escrituras.filter((w: any) => w.tabla === 'avisos_pedidos' && w.op === 'update').pop()?.fila;
const chatConMensajes = (mensajes: any[]) => jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => mensajes } as any);

describe('AvisosPedidosService: el aviso sale a administración', () => {
  const wsp = require('../comun/whatsapp');
  const tarjeta = require('../comun/cartel-pedido');
  let imagen: jest.SpyInstance; let texto: jest.SpyInstance; let carteles: jest.SpyInstance;
  beforeEach(() => {
    process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k';
    imagen = jest.spyOn(wsp, 'enviarImagenWhatsapp');
    texto = jest.spyOn(wsp, 'enviarTextoWhatsapp');
    carteles = jest.spyOn(tarjeta, 'cartelesPedido').mockResolvedValue([Buffer.from('png')]);
  });
  afterEach(() => jest.restoreAllMocks());
  const enviar = (s: AvisosPedidosService, f: any = FILA) => (s as any).enviar(f);

  it('manda la tarjeta PEDIDO NUEVO con el texto como epígrafe de la primera página y lo marca enviado con el id', async () => {
    imagen.mockResolvedValue({ enviado: true, id: '3EB0AA' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(imagen).toHaveBeenCalledWith(db, '5491125213601', expect.stringContaining('aviso-PICKUP-5F2451C6C111'), expect.stringMatching(/^PEDIDO NUEVO · PICKUP-5F2451C6C111\n/), 'aviso-pedido');
    expect(carteles.mock.calls[0][0]).toMatchObject({ titulo: 'PEDIDO NUEVO', subtitulo: 'PICKUP-5F2451C6C111', total: 133500, entrega: { detalle: 'domingo 4/10 por la mañana' } });
    expect(texto).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', destino: '5491125213601', waha_id: '3EB0AA', waha_ids: ['3EB0AA'] });
  });

  it('tarjeta de dos páginas: si la segunda no sale, va también el texto completo, y quedan los ids de todo lo que salió', async () => {
    carteles.mockResolvedValue([Buffer.from('1'), Buffer.from('2')]);
    imagen.mockResolvedValueOnce({ enviado: true, id: 'P1' }).mockResolvedValueOnce({ enviado: false, motivo: 'WAHA sendImage 400' });
    texto.mockResolvedValue({ enviado: true, id: 'T1' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(imagen.mock.calls[1][3]).toBe(''); // la segunda página sin epígrafe
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box — \$133\.500/);
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'P1', waha_ids: ['P1', 'T1'] });
  });

  it('si la tarjeta no se puede armar, va el texto', async () => {
    carteles.mockRejectedValue(new Error('sin fuentes'));
    texto.mockResolvedValue({ enviado: true, id: 'X1' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(imagen).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'X1' });
  });

  it('si no sale nada, queda pendiente con el motivo y el próximo intento', async () => {
    imagen.mockResolvedValue({ enviado: false, motivo: 'WAHA sendImage 500', incierto: true });
    texto.mockResolvedValue({ enviado: false, motivo: 'WAHA sendText 400' });
    chatConMensajes([]);
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    const f = ultimaActualizacion(db);
    expect(f.estado).toBeUndefined();
    expect(f.ultimo_error).toBe('WAHA sendText 400');
    expect(new Date(f.proximo_intento).getTime()).toBeGreaterThan(Date.now());
  });

  it('enviado sin id no cuenta: sin prueba de que salió, se reintenta', async () => {
    imagen.mockResolvedValue({ enviado: true, id: null });
    texto.mockResolvedValue({ enviado: true, id: null });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(ultimaActualizacion(db).estado).toBeUndefined();
    expect(ultimaActualizacion(db).ultimo_error).toMatch(/no devolvió el id/);
  });

  it('sin teléfono de administración cargado, no se da por enviado', async () => {
    const db = baseFalsa({ ...TABLAS, lineas_whatsapp: { data: { derivar_pagos_a: null } } });
    await enviar(new AvisosPedidosService(db));
    expect(imagen).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db).ultimo_error).toMatch(/no hay teléfono de administración/);
  });

  it('todo reintento mira el chat: si el aviso ya está (mismo encabezado), no se manda de nuevo', async () => {
    chatConMensajes([{ fromMe: true, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\nEntró por…', id: { _serialized: 'true_5491125213601@c.us_3EB0CC' } }]);
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2 });
    expect(imagen).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'true_5491125213601@c.us_3EB0CC' });
  });

  it('un mensaje de pago que nombra el mismo código NO cuenta como el aviso', async () => {
    chatConMensajes([{ fromMe: true, body: '💳 Consulta de pago: quiere transferir el pedido PICKUP-5F2451C6C111', id: 'true_x_PAGO' }]);
    imagen.mockResolvedValue({ enviado: true, id: 'NUEVO' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 3, incierto: true });
    expect(imagen).toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'NUEVO' });
  });

  it('un pedido cancelado antes de avisar, o de prueba del simulador del panel, se omite', async () => {
    const cancelado = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, estado: 'cancelado' } } });
    await enviar(new AvisosPedidosService(cancelado));
    expect(ultimaActualizacion(cancelado)).toMatchObject({ estado: 'omitido', motivo: 'el pedido se canceló antes de avisar' });
    const prueba = baseFalsa({ ...TABLAS, bot_cotizaciones: { data: { telefono: '1154872210' } }, bot_entrantes: { data: [] } });
    await enviar(new AvisosPedidosService(prueba));
    expect(ultimaActualizacion(prueba)).toMatchObject({ estado: 'omitido' });
    expect(imagen).not.toHaveBeenCalled();
  });

  it('un mensaje que WhatsApp marcó con error (ack -1) no cuenta como enviado: se reenvía', async () => {
    chatConMensajes([{ fromMe: true, ack: -1, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\nEntró por…', id: 'true_x_FALLIDO' }]);
    imagen.mockResolvedValue({ enviado: true, id: 'REENVIO' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2 });
    expect(imagen).toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'REENVIO' });
  });

  it('una tarjeta que quedó a medias: el fallo anota lo que salió y el reintento completa con el texto (sin buscar ni repetir la tarjeta)', async () => {
    carteles.mockResolvedValue([Buffer.from('1'), Buffer.from('2')]);
    imagen.mockResolvedValueOnce({ enviado: true, id: 'P1' }).mockResolvedValueOnce({ enviado: false, motivo: 'WAHA sendImage 500', incierto: true });
    texto.mockResolvedValueOnce({ enviado: false, motivo: 'WAHA sendText 500', incierto: true });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(ultimaActualizacion(db)).toMatchObject({ waha_ids: ['P1'], ultimo_error: 'WAHA sendText 500' });
    imagen.mockClear();
    texto.mockResolvedValueOnce({ enviado: true, id: 'T1' });
    const db2 = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db2), { ...FILA, intentos: 2, incierto: true, waha_ids: ['P1'] });
    expect(imagen).not.toHaveBeenCalled();
    expect(texto.mock.calls.at(-1)[2]).toMatch(/• 3 × Combo Picada Box/);
    expect(ultimaActualizacion(db2)).toMatchObject({ estado: 'enviado', waha_ids: ['P1', 'T1'] });
  });

  it('si lo encontrado en el chat es la imagen de la tarjeta (puede ser solo la página 1), se completa con el texto', async () => {
    chatConMensajes([{ fromMe: true, hasMedia: true, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\nEntró por…', id: 'true_x_PAG1' }]);
    texto.mockResolvedValue({ enviado: true, id: 'T1' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2 });
    expect(imagen).not.toHaveBeenCalled();
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box/);
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_ids: ['true_x_PAG1', 'T1'] });
    expect(db.escrituras).toContainEqual(expect.objectContaining({ tabla: 'bot_envios', op: 'upsert' }));
  });

  it('un "sin cargar" cuyo pedido se cargó después no sale (llega el PEDIDO NUEVO)', async () => {
    const db = baseFalsa({ ...TABLAS, bot_cotizaciones: { data: { pedido_id: 'p9', confirmada_en: '2026-10-03T13:12:00Z', pedidos: { qr_retiro: 'PICKUP-ABC' } } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, pedido_id: null, tipo: 'pedido_sin_cargar', detalle: { telefono: '230566779732018', nota: 'x' } });
    expect(texto).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'omitido', motivo: expect.stringContaining('PICKUP-ABC') });
  });

  it('un chat sin teléfono conocido: el aviso sin cargar dice el chat como lo muestra RESPONDE', () => {
    const t = textoDeSinCargar({ telefono: '230566779732018', telefonoReal: null, nombre: 'Marta', nota: 'n', resumen: null, aviso: 'abc12345' });
    expect(t).toMatch(/^PEDIDO CONFIRMADO SIN CARGAR · chat \+230566779732018 · #ABC123\n/);
    expect(t).toMatch(/\nCliente: Marta\n/);
  });

  it('el alta de un pedido que antes llegó como "sin cargar" lo aclara', () => {
    expect(textoDelAviso(PEDIDO, { conRenglones: false, ahora: AHORA, antesSinCargar: true })).toMatch(/^PEDIDO NUEVO · PICKUP-5F2451C6C111\nEs el pedido que antes llegó como CONFIRMADO SIN CARGAR: ya quedó cargado, NO lo carguen a mano\./);
  });

  it('después de un ack -1 el reenvío va como texto (si lo que falla es la imagen, que no falle siempre igual)', async () => {
    texto.mockResolvedValue({ enviado: true, id: 'TX' });
    chatConMensajes([]);
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2, ack: -1 });
    expect(imagen).not.toHaveBeenCalled();
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box/);
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'TX' });
  });

  it('cancelado, pero el alta ya había salido sin quedar anotada: se marca enviada y la base encola la BAJA', async () => {
    chatConMensajes([{ fromMe: true, hasMedia: true, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\nEntró por…', id: 'true_x_ALTA' }]);
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, estado: 'cancelado' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2, incierto: true });
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'true_x_ALTA' });
    expect(db.rpc).toHaveBeenCalledWith('encolar_avisos_faltantes');
    expect(imagen).not.toHaveBeenCalled();
  });

  it('cancelado, con un intento anterior que pudo haber llegado y no se ve en el chat: se manda la BAJA por las dudas', async () => {
    chatConMensajes([]);
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, estado: 'cancelado' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2, incierto: true });
    expect(db.escrituras).toContainEqual(expect.objectContaining({ tabla: 'avisos_pedidos', op: 'insert', fila: { pedido_id: PEDIDO.id, tipo: 'pedido_cancelado' } }));
    expect(db.escrituras.filter((w: any) => w.op === 'update').pop().fila).toMatchObject({ estado: 'omitido' });
    expect(imagen).not.toHaveBeenCalled();
  });

  it('enviado deja en cero el reloj del escalamiento y el ack (problema nuevo, reloj nuevo)', async () => {
    imagen.mockResolvedValue({ enviado: true, id: 'Z1' });
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db));
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', ack: null, escalar_intentos: 0, escalar_proximo: null });
  });

  it('un pedido ya entregado antes de avisar no sale como PEDIDO NUEVO', async () => {
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, estado: 'entregado' } } });
    await enviar(new AvisosPedidosService(db));
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'omitido', motivo: 'el pedido ya se entregó antes de avisar' });
  });

  it('un teléfono con forma de simulador pero que escribió de verdad por WhatsApp NO se omite', async () => {
    imagen.mockResolvedValue({ enviado: true, id: 'R1' });
    const db = baseFalsa({ ...TABLAS, bot_cotizaciones: { data: { telefono: '1154872210' } }, bot_entrantes: { data: [{ waha_id: 'x' }] } });
    await enviar(new AvisosPedidosService(db));
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'R1' });
  });

  it('en el chat están la imagen y el texto del aviso: cuenta el texto (es el completo) y no se repite nada', async () => {
    chatConMensajes([
      { fromMe: true, hasMedia: true, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\n…', id: 'true_x_IMG' },
      { fromMe: true, hasMedia: false, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\n• 3 × Combo…', id: 'true_x_TXT' },
    ]);
    const db = baseFalsa(TABLAS);
    await enviar(new AvisosPedidosService(db), { ...FILA, intentos: 2, waha_ids: ['true_x_IMG'] });
    expect(texto).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_ids: ['true_x_IMG', 'true_x_TXT'] });
    expect(db.escrituras.filter((w: any) => w.tabla === 'bot_envios').map((w: any) => w.fila.waha_id)).toEqual(['true_x_IMG', 'true_x_TXT']);
  });

  it('PEDIDO PAGADO no se repite solo si el texto del alta que LLEGÓ decía "Ya está pagado."', async () => {
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, pagado_en: '2026-10-03T13:11:00Z' } }, avisos_pedidos: { data: { detalle: { dijo_pagado: true }, estado: 'entregado' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, tipo: 'pedido_pagado' });
    expect(texto).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'omitido' });
  });

  it('si el alta que lo dijo está apenas enviada (puede volver con error), el pago espera un minuto, sin contar como falla', async () => {
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, pagado_en: '2026-10-03T13:11:00Z' } }, avisos_pedidos: { data: { detalle: { dijo_pagado: true }, estado: 'enviado' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, tipo: 'pedido_pagado' });
    expect(texto).not.toHaveBeenCalled();
    const f = ultimaActualizacion(db);
    expect(f).toMatchObject({ tomado_hasta: null });
    expect(f.estado).toBeUndefined();
    expect(f.ultimo_error).toBeUndefined();
  });

  it('un alta anotada después del pago pero que decía "Se cobra al retirar": el PEDIDO PAGADO sale igual', async () => {
    texto.mockResolvedValue({ enviado: true, id: 'PG' });
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, pagado_en: '2026-10-03T13:11:00Z' } }, avisos_pedidos: { data: { detalle: null, enviado_en: '2026-10-03T13:20:00Z' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, tipo: 'pedido_pagado' });
    expect(texto.mock.calls[0][2]).toMatch(/^PEDIDO PAGADO · PICKUP-5F2451C6C111/);
  });

  it('el alta armada con el pedido ya pagado anota que lo dijo', async () => {
    imagen.mockResolvedValue({ enviado: true, id: 'A1' });
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, pagado_en: '2026-10-03T13:11:00Z' } } });
    await enviar(new AvisosPedidosService(db));
    expect(imagen.mock.calls[0][3]).toMatch(/Ya está pagado\./);
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', detalle: { dijo_pagado: true } });
  });

  it('la baja y el pago salen como texto, con su encabezado', async () => {
    texto.mockResolvedValue({ enviado: true, id: 'B1' });
    const db = baseFalsa({ ...TABLAS, pedidos: { data: { ...PEDIDO_DB, estado: 'cancelado' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, tipo: 'pedido_cancelado' });
    expect(texto.mock.calls[0][2]).toMatch(/^PEDIDO CANCELADO · PICKUP-5F2451C6C111/);
    expect(imagen).not.toHaveBeenCalled();
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'B1' });
  });

  it('el pedido confirmado SIN cargar sale con el teléfono real y lo último que se le cotizó', async () => {
    texto.mockResolvedValue({ enviado: true, id: 'S1' });
    const db = baseFalsa({ ...TABLAS, bot_cotizaciones: { data: { resumen: '• Combo Picada Box — 3 × $44.500\nTotal: $133.500\n¿Lo confirmo?' } } });
    await enviar(new AvisosPedidosService(db), { ...FILA, pedido_id: null, tipo: 'pedido_sin_cargar', detalle: { telefono: '230566779732018', nota: 'PEDIDO NO CARGADO (falló crear_pedido)' } });
    // el encabezado lleva el número propio del aviso: dos pedidos sin cargar del mismo chat no se confunden
    expect(texto.mock.calls[0][2]).toMatch(/^PEDIDO CONFIRMADO SIN CARGAR · \+54 9 11 3590-1236 · #AVISO1\n/);
    expect(texto.mock.calls[0][2]).toMatch(/Combo Picada Box/);
    expect(ultimaActualizacion(db)).toMatchObject({ estado: 'enviado', waha_id: 'S1' });
  });
});

describe('el endpoint del cartel es solo para el personal', () => {
  it('lleva @Roles sin "cliente"', () => {
    const { AvisosController } = require('./avisos.controller');
    const roles: string[] = Reflect.getMetadata('roles', AvisosController) ?? [];
    expect(roles).toEqual(expect.arrayContaining(['dueno', 'administrativo', 'cajero']));
    expect(roles).not.toContain('cliente');
  });
});

describe('AvisosPedidosService: dónde corre', () => {
  afterEach(() => { delete process.env.RAILWAY_ENVIRONMENT_NAME; delete process.env.ODB_AVISOS_PEDIDOS; jest.restoreAllMocks(); });

  it('en una máquina de desarrollo (sin Railway) o sin WhatsApp NO toma avisos: no se los roba a producción', async () => {
    process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k';
    const db = baseFalsa();
    const s = new AvisosPedidosService(db);
    await s.vueltaDeEnvio();
    await s.vueltaDeVigia();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.escrituras).toEqual([]);
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    delete process.env.WAHA_API_KEY;
    await s.vueltaDeEnvio();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('en Railway: encola los faltantes y toma de a uno; con la sesión de WhatsApp caída no toma', async () => {
    process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k'; process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ status: 'WORKING' }) } as any);
    const db = baseFalsa({ 'rpc:encolar_avisos_faltantes': { data: 0 }, 'rpc:tomar_avisos_pedidos': { data: [] } });
    const s = new AvisosPedidosService(db);
    await s.vueltaDeEnvio();
    expect(db.rpc).toHaveBeenCalledWith('encolar_avisos_faltantes');
    expect(db.rpc).toHaveBeenCalledWith('tomar_avisos_pedidos', { p_limite: 1 });
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ status: 'SCAN_QR_CODE' }) });
    db.rpc.mockClear();
    await s.vueltaDeEnvio();
    expect(db.rpc).not.toHaveBeenCalledWith('tomar_avisos_pedidos', expect.anything());
    expect(s.estadoWhatsapp).toBe('SCAN_QR_CODE');
  });
});

describe('AvisosPedidosService: que llegue y, si no, que se enteren los dueños', () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => { process.env.WAHA_URL = 'https://waha'; process.env.WAHA_API_KEY = 'k'; delete process.env.AVISOS_ESCALAR_A; });
  const NACIO = '2026-10-03T13:10:13.000Z';
  const enviado = [{ id: 'a1', pedido_id: 'p1', destino: '5491125213601', waha_id: '3EB0AA', enviado_en: new Date().toISOString(), creado_en: NACIO, pendiente_desde: NACIO, intentos: 1 }];

  it.each([[3, 'entregado'], [2, 'entregado']])('ack %s → %s', async (ack, estado) => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: enviado } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/messages/true_5491125213601%40c.us_3EB0AA'), expect.anything());
    expect(ultimaActualizacion(db)).toMatchObject({ estado, ack });
  });

  it('ack -1: se reenvía y los 3 minutos sin salir se cuentan desde ahora (no escala de inmediato)', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: enviado } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f).toMatchObject({ estado: 'pendiente', ack: -1, escalado_en: null });
    expect(Math.abs(new Date(f.pendiente_desde).getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('un segundo ack -1 no vuelve a arrancar el reloj (aunque el reenvío haya borrado el error): si sigue sin llegar, escala', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    // ya hubo un ack -1 antes: pendiente_desde quedó distinto de creado_en; el reenvío dejó ultimo_error en null
    const db = baseFalsa({ avisos_pedidos: { data: [{ ...enviado[0], intentos: 3, pendiente_desde: '2026-10-03T13:20:00.000Z', ultimo_error: null }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f).toMatchObject({ estado: 'pendiente', ack: -1 });
    expect(f.pendiente_desde).toBeUndefined();
  });

  it('ack -1 una y otra vez por más de 30 minutos: no se reenvía más (queda a la vista) y no se rearma el escalamiento', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: [{ ...enviado[0], intentos: 9, pendiente_desde: new Date(Date.now() - 40 * 60_000).toISOString() }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f).toMatchObject({ estado: 'pendiente', proximo_intento: 'infinity', ultimo_error: expect.stringMatching(/no se reenvía más/) });
    expect(f).not.toHaveProperty('escalado_en');
  });

  it('el primer ack -1 de un aviso de hace más de 48 h no lo corta: se reenvía', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    const viejo = '2026-09-30T10:00:00.000Z';
    const db = baseFalsa({ avisos_pedidos: { data: [{ ...enviado[0], creado_en: viejo, pendiente_desde: viejo }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f.proximo_intento).not.toBe('infinity');
    expect(f).toMatchObject({ estado: 'pendiente', escalado_en: null });
  });

  it('ack -1 del alta: lo que decía su texto deja de contar, y "Ya avisé al local" no corta el primer reenvío', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: [{ ...enviado[0], visto_en: new Date().toISOString(), detalle: { dijo_pagado: true } }] } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f.proximo_intento).not.toBe('infinity');
    expect(f.detalle).toEqual({ dijo_pagado: false });
  });

  it('el primer ack -1 rearma el escalamiento; los siguientes no', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: -1 }) } as any);
    const primero = baseFalsa({ avisos_pedidos: { data: enviado } });
    await (new AvisosPedidosService(primero) as any).verificarEntregas();
    expect(ultimaActualizacion(primero)).toMatchObject({ escalado_en: null, escalar_intentos: 0 });
    const segundo = baseFalsa({ avisos_pedidos: { data: [{ ...enviado[0], intentos: 3, pendiente_desde: new Date(Date.now() - 5 * 60_000).toISOString() }] } });
    await (new AvisosPedidosService(segundo) as any).verificarEntregas();
    expect(ultimaActualizacion(segundo)).not.toHaveProperty('escalado_en');
  });

  it('un tilde solo: se vuelve a preguntar en un minuto', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ ack: 1 }) } as any);
    const db = baseFalsa({ avisos_pedidos: { data: enviado } });
    await (new AvisosPedidosService(db) as any).verificarEntregas();
    const f = ultimaActualizacion(db);
    expect(f.estado).toBeUndefined();
    expect(new Date(f.proximo_intento).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('problemas: lo que no salió en 3 minutos (desde que quedó pendiente) y lo que no llegó en 15; sin cancelados ni "ya avisé"', async () => {
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const db = baseFalsa({ avisos_pedidos: { data: [
      { id: 'a', pedido_id: 'pa', tipo: 'pedido_nuevo', pendiente_desde: hace(5), estado: 'pendiente', enviado_en: null, ultimo_error: 'WAHA 500', ack: null, visto_en: null, pedidos: { qr_retiro: 'PICKUP-A', estado: 'recibido' } },
      { id: 'b', pedido_id: 'pb', tipo: 'pedido_nuevo', pendiente_desde: hace(1), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, visto_en: null, pedidos: { qr_retiro: 'PICKUP-B', estado: 'recibido' } },
      { id: 'c', pedido_id: 'pc', tipo: 'pedido_nuevo', pendiente_desde: hace(30), estado: 'enviado', enviado_en: hace(20), ultimo_error: null, ack: 1, visto_en: null, pedidos: { qr_retiro: 'DOM-C', estado: 'recibido' } },
      { id: 'd', pedido_id: 'pd', tipo: 'pedido_nuevo', pendiente_desde: hace(30), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, visto_en: null, pedidos: { qr_retiro: 'PICKUP-D', estado: 'cancelado' } },
      { id: 'e', pedido_id: 'pe', tipo: 'pedido_nuevo', pendiente_desde: hace(30), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, visto_en: hace(2), pedidos: { qr_retiro: 'PICKUP-E', estado: 'recibido' } },
      { id: 'f', pedido_id: null, tipo: 'pedido_sin_cargar', detalle: { telefono: '5491135901236' }, pendiente_desde: hace(4), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, visto_en: null, pedidos: null },
    ] } });
    const p = await new AvisosPedidosService(db).problemas();
    expect(p.map((x) => [x.codigo, x.problema])).toEqual([['PICKUP-A', 'no_salio'], ['DOM-C', 'no_llego'], ['chat +54 9 11 3590-1236', 'no_salio']]);
    expect(p[1].motivo).toMatch(/un solo tilde/);
  });

  it('si la consulta falla, problemas() tira (la franja no puede quedar vacía en silencio)', async () => {
    const db = baseFalsa({ avisos_pedidos: { data: null, error: { message: 'timeout' } } });
    await expect(new AvisosPedidosService(db).problemas()).rejects.toThrow(/timeout/);
  });

  const DUENOS = { data: [
    { id: 'u1', nombre: 'Leandro', telefono: '11 2660-0320' },
    { id: 'u2', nombre: 'Jaqueline', telefono: '5491124862295' },
    { id: 'u3', nombre: 'Admin', telefono: '5491125213601' },
  ] };
  const PROBLEMA = { avisoId: 'aviso-1', pedidoId: PEDIDO.id, tipo: 'pedido_nuevo' as const, codigo: 'PICKUP-5F2451C6C111', problema: 'no_salio' as const, minutos: 4, motivo: 'WAHA 500' };

  it('escala a los dueños (no al mismo teléfono de administración), con campanita, y lo marca porque SALIÓ', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp').mockResolvedValue({ enviado: true, id: 'Z' });
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente' } } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto.mock.calls.map((c) => c[1])).toEqual(['5491126600320', '5491124862295']);
    expect(texto.mock.calls[0][2]).toMatch(/^ATENCIÓN: El aviso del pedido PICKUP-5F2451C6C111 NO SALIÓ a administración/);
    expect(texto.mock.calls[0][2]).toMatch(/• 3 × Combo Picada Box/);
    expect(db.escrituras.filter((w: any) => w.tabla === 'alertas_internas')).toHaveLength(3);
    expect(ultimaActualizacion(db)).toMatchObject({ escalado_en: expect.any(String), escalar_proximo: null });
  });

  it('si el aviso a los dueños TAMBIÉN falla, no se da por escalado: se reintenta con espera (sin repetir la campanita)', async () => {
    jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp').mockResolvedValue({ enviado: false, motivo: 'ECONNREFUSED' });
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente' } }, 'avisos_pedidos:update': { data: [{ escalar_intentos: 2 }] } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    const f = ultimaActualizacion(db);
    expect(f.escalado_en).toBeUndefined();
    expect(f.escalar_intentos).toBe(3);
    expect(new Date(f.escalar_proximo).getTime()).toBeGreaterThan(Date.now() + 200_000);
    expect(db.escrituras.filter((w: any) => w.tabla === 'alertas_internas')).toHaveLength(0);
  });

  it('si otro proceso ya tomó el escalamiento, no se repite', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp');
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, 'avisos_pedidos:update': { data: [] } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
  });

  // 3/10/2026, en producción: el aviso pendiente salió en el segundo 36 y los
  // dueños recibieron "NO SALIÓ" en el 39
  it('si el aviso salió mientras se preparaba el escalamiento, no se les escribe a los dueños', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp');
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'enviado' } } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
    const f = ultimaActualizacion(db);
    expect(f).toEqual({ escalar_proximo: null, escalar_intentos: 0 });
  });

  it('"no salió" pero está en el chat (el proceso se cortó con el envío en vuelo): se marca enviado y no se alarma a los dueños', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp');
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [{ fromMe: true, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\n…', id: 'true_x_ENVUELO' }] } as any);
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente' } }, pedidos: { data: { id: PEDIDO.id, qr_retiro: 'PICKUP-5F2451C6C111' } } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
    expect(db.escrituras.filter((w: any) => w.tabla === 'avisos_pedidos' && w.op === 'update').map((w: any) => w.fila)).toContainEqual(expect.objectContaining({ estado: 'enviado', waha_id: 'true_x_ENVUELO' }));
  });

  it('tomado por un proceso que no terminó (un deploy lo cortó): se libera para reintentar y se escala después, no ya', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp');
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [] } as any);
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente', tomado_hasta: new Date(Date.now() + 60_000).toISOString() } }, pedidos: { data: { id: PEDIDO.id, qr_retiro: 'PICKUP-5F2451C6C111' } } });
    const s = new AvisosPedidosService(db);
    (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
    const filas = db.escrituras.filter((w: any) => w.tabla === 'avisos_pedidos' && w.op === 'update').map((w: any) => w.fila);
    expect(filas).toContainEqual(expect.objectContaining({ tomado_hasta: null }));
    expect(new Date(filas.at(-1).escalar_proximo).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('tarjeta a medias cuyo texto no sale: la primera vez se completa, la segunda se escala a los dueños', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp').mockResolvedValue({ enviado: true, id: 'D1' });
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [{ fromMe: true, hasMedia: true, ack: 3, body: 'PEDIDO NUEVO · PICKUP-5F2451C6C111\n…', id: 'true_x_PAG1' }] } as any);
    const primera = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente', tomado_hasta: null, waha_ids: [] } }, pedidos: { data: { id: PEDIDO.id, qr_retiro: 'PICKUP-5F2451C6C111' } } });
    const s1 = new AvisosPedidosService(primera); (s1 as any).arranque = 0;
    jest.spyOn(s1, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s1 as any).vigilar();
    expect(texto).not.toHaveBeenCalled();
    expect(primera.escrituras.map((w: any) => w.fila)).toContainEqual(expect.objectContaining({ waha_ids: ['true_x_PAG1'] }));
    const segunda = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente', tomado_hasta: null, waha_ids: ['true_x_PAG1'] } }, pedidos: { data: { id: PEDIDO.id, qr_retiro: 'PICKUP-5F2451C6C111' } } });
    const s2 = new AvisosPedidosService(segunda); (s2 as any).arranque = 0;
    jest.spyOn(s2, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s2 as any).vigilar();
    expect(texto).toHaveBeenCalled();
    expect(ultimaActualizacion(segunda)).toMatchObject({ escalado_en: expect.any(String) });
  });

  it('postergar por un proceso caído es una sola vez: la segunda, escala', async () => {
    const texto = jest.spyOn(require('../comun/whatsapp'), 'enviarTextoWhatsapp').mockResolvedValue({ enviado: true, id: 'D1' });
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => [] } as any);
    const db = baseFalsa({ ...TABLAS, usuarios: DUENOS, avisos_pedidos: { data: { estado: 'pendiente', tomado_hasta: new Date(Date.now() + 60_000).toISOString() } }, 'avisos_pedidos:update': { data: [{ escalar_intentos: 1 }] }, pedidos: { data: { id: PEDIDO.id, qr_retiro: 'PICKUP-5F2451C6C111' } } });
    const s = new AvisosPedidosService(db); (s as any).arranque = 0;
    jest.spyOn(s, 'problemas').mockResolvedValue([PROBLEMA]);
    await (s as any).vigilar();
    expect(texto).toHaveBeenCalled();
  });

  it('recién arrancado (un deploy) el vigía espera un minuto: primero sale lo pendiente', async () => {
    const db = baseFalsa();
    const s = new AvisosPedidosService(db);
    const problemas = jest.spyOn(s, 'problemas');
    await (s as any).vigilar();
    expect(problemas).not.toHaveBeenCalled();
  });

  it('un aviso que se está mandando ahora mismo no cuenta como "no salió"', async () => {
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const db = baseFalsa({ avisos_pedidos: { data: [
      { id: 'a', pedido_id: 'pa', tipo: 'pedido_nuevo', pendiente_desde: hace(60), estado: 'pendiente', enviado_en: null, ultimo_error: null, ack: null, visto_en: null, tomado_hasta: new Date(Date.now() + 4.5 * 60_000).toISOString(), pedidos: { qr_retiro: 'PICKUP-A', estado: 'recibido' } },
    ] } });
    expect(await new AvisosPedidosService(db).problemas()).toEqual([]);
  });
});
