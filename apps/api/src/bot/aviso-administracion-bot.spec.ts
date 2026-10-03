import { BotService } from './bot.service';

// Los avisos de pedidos al teléfono de administración (regla del 3/10/2026),
// del lado del bot: el pedido confirmado SIN cargar sale a administración, y lo
// que administración contesta a un aviso de pedido no se le lleva a ningún cliente.

function baseFalsa(r: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const b: any = {};
      for (const k of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'range', 'ilike', 'not', 'or']) b[k] = () => b;
      b.update = (f: any) => { op = 'update'; escrituras.push({ tabla, op, fila: f }); return b; };
      b.insert = (f: any) => { op = 'insert'; escrituras.push({ tabla, op, fila: f }); return b; };
      b.upsert = (f: any) => { op = 'upsert'; escrituras.push({ tabla, op, fila: f }); return b; };
      const res = () => (op === 'select' ? r[tabla] : r[`${tabla}:${op}`]) ?? { data: null, error: null };
      b.maybeSingle = b.single = async () => res();
      b.then = (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
      return b;
    },
  };
  return db;
}
const servicio = (db: any) => new BotService(db, {} as any, {} as any, {} as any, {} as any);

describe('el pedido confirmado SIN cargar sale a administración', () => {
  it('se encola una vez por chat cada 10 minutos, con el teléfono y la nota', async () => {
    const db = baseFalsa();
    await (servicio(db) as any).encolarPedidoSinCargar('pedidos', '230566779732018', 'PEDIDO NO CARGADO (falló crear_pedido)');
    expect(db.escrituras).toEqual([{ tabla: 'avisos_pedidos', op: 'insert', fila: { tipo: 'pedido_sin_cargar', detalle: { linea: 'pedidos', telefono: '230566779732018', nota: 'PEDIDO NO CARGADO (falló crear_pedido)' } } }]);
    const conPrevio = baseFalsa({ avisos_pedidos: { data: { id: 'ya' } } });
    await (servicio(conPrevio) as any).encolarPedidoSinCargar('pedidos', '230566779732018', 'otra vez');
    expect(conPrevio.escrituras).toEqual([]);
  });

  it('por la frase (no por el freno), si el chat ya tiene un pedido confirmado reciente, no se avisa: preguntaba por ese', async () => {
    const db = baseFalsa({ bot_cotizaciones: { data: { id: 'cot-confirmada' } } });
    await (servicio(db) as any).encolarPedidoSinCargar('pedidos', '230566779732018', 'frase', { salvoPedidoReciente: true });
    expect(db.escrituras).toEqual([]);
    await (servicio(db) as any).encolarPedidoSinCargar('pedidos', '230566779732018', 'freno');
    expect(db.escrituras).toHaveLength(1);
  });

  it('el banco de pruebas y "Probar el bot" del panel no le escriben a administración', async () => {
    const db = baseFalsa();
    await (servicio(db) as any).encolarPedidoSinCargar('pedidos', '54911000000101', 'banco');
    await (servicio(db) as any).encolarPedidoSinCargar('pedidos', '1154872210', 'simulador');
    expect(db.escrituras).toEqual([]);
  });
});

describe('lo que administración contesta a un aviso de pedido no va a ningún cliente', () => {
  const CFG = { lineas_whatsapp: { data: { bot_activo: true, derivar_pagos_a: '5491125213601', whatsapp_reparto: null, whatsapp_compras: null } } };
  const PAGO = { id: 'pago-1', linea: 'pedidos', telefono_cliente: '5491133344455', monto: 85000, waha_msg_id: 'true_5491125213601@c.us_3EBPAGO', confirmado_en: null };
  const armar = (tablas: Record<string, any>) => {
    const db = baseFalsa({ ...CFG, ...tablas });
    const s: any = servicio(db);
    s.pendientesPaginados = jest.fn(async (tabla: string) => (tabla === 'bot_pagos_en_confirmacion' ? [PAGO] : []));
    s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'X' }));
    s.llevarRespuestaDeConsulta = jest.fn();
    return { s, db };
  };

  it('citando un aviso de pedido (cualquier página, cualquier día): es un acuse, no se toca ningún pago ni consulta', async () => {
    const { s } = armar({ bot_envios: { data: [{ waha_id: '3EB0AVISO' }] } });
    const r = await s.respuestaDeAdministracion('5491125213601', { body: 'ok, recibido', replyTo: 'true_5491125213601@c.us_3EB0AVISO' });
    expect(r).toEqual({ contestado: false, motivo: 'acuse de un aviso de pedido' });
    expect(s.enviarPorWhatsapp).not.toHaveBeenCalled();
    expect(s.llevarRespuestaDeConsulta).not.toHaveBeenCalled();
  });

  it('sin cita, con un aviso de pedido del día y un pago pendiente: se pide citar (el "ok" no le llega al cliente del pago)', async () => {
    const { s } = armar({ avisos_pedidos: { data: null, count: 1 } });
    const r = await s.respuestaDeAdministracion('5491125213601', { body: 'ok' });
    expect(r).toEqual({ contestado: false, motivo: 'falta referencia inequívoca' });
    expect(s.enviarPorWhatsapp).toHaveBeenCalledTimes(1);
    // con avisos de pedidos del día, el texto aclara que un "ok" a un pedido no necesita respuesta
    expect(s.enviarPorWhatsapp.mock.calls[0][0]).toMatchObject({ to: '5491125213601', text: expect.stringMatching(/^Si es por un PEDIDO, no hace falta responder\. Si es por un pago o una consulta, respondé CITANDO ese aviso\.$/) });
  });
});
