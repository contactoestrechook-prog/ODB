// la tarjeta Placa roja se simula: acá se controla QUÉ se dibuja, no el PNG
const mockCartel = jest.fn(async (_r: any) => Buffer.from('png'));
jest.mock('../comun/cartel-pedido', () => ({
  ...jest.requireActual('../comun/cartel-pedido'),
  cartelPedido: (r: any) => mockCartel(r),
}));

import { BadRequestException } from '@nestjs/common';
import { VentasService } from './ventas.service';

// Mock mínimo del cliente de Supabase: cada test declara qué devuelve cada
// tabla/RPC. El objetivo es fijar el CONTRATO del servicio de ventas:
// - la cta cte se valida ANTES de registrar la venta
// - el comprobante A/B/R se emite y corrige la cola ARCA
// - un fallo del comprobante NO tira la venta ya registrada
// - el descuento autorizado viaja a la RPC

type Respuestas = {
  rpc?: Record<string, any | ((args: any) => any)>;
  tablas?: Record<string, any>;
};

function dbFalsa(r: Respuestas) {
  const llamadas: { rpc: [string, any][]; updates: [string, any][]; deletes: string[] } = {
    rpc: [],
    updates: [],
    deletes: [],
  };
  const db: any = {
    rpc: jest.fn((fn: string, args: any) => {
      llamadas.rpc.push([fn, args]);
      const def = r.rpc?.[fn];
      // clon por llamada: el servicio muta el resultado (le cuelga .comprobante)
      // y un objeto compartido contaminaría a los demás tests
      const crudo = typeof def === 'function' ? def(args) : def;
      const data = crudo && typeof crudo === 'object' ? JSON.parse(JSON.stringify(crudo)) : crudo;
      const res = { data: data ?? null, error: data === undefined ? { message: `rpc ${fn} sin mock` } : null };
      return Object.assign(Promise.resolve(res), { maybeSingle: () => Promise.resolve(res) });
    }),
    from: jest.fn((tabla: string) => {
      const data = r.tablas?.[tabla];
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: () => Promise.resolve({ data: data ?? null, error: null }),
        single: () => Promise.resolve({ data: data ?? null, error: data == null ? { message: `sin ${tabla}` } : null }),
        update: (v: any) => { llamadas.updates.push([tabla, v]); return q; },
        delete: () => { llamadas.deletes.push(tabla); return q; },
        insert: () => q,
        then: (res: any) => Promise.resolve({ data: data ?? [], error: null }).then(res),
      };
      return q;
    }),
  };
  return { db, llamadas };
}

const facturacionFalsa = () => ({
  emitir: jest.fn().mockResolvedValue({ id: 'comp-1', tipo: 'FB', punto_venta: 1, numero: 7, total: 100 }),
});

const cajaFalsa = () => ({
  consumirAutorizacion: jest.fn().mockResolvedValue({ ok: true }),
});

const mpFalso = () => ({
  pagoMPDeVenta: jest.fn().mockResolvedValue(null),
  reembolsar: jest.fn(),
});

function servicio(r: Respuestas, fact = facturacionFalsa(), mp = mpFalso()) {
  const { db, llamadas } = dbFalsa(r);
  const svc = new VentasService(db, fact as any, cajaFalsa() as any, mp as any);
  return { svc, llamadas, fact, db, mp };
}

const dtoBase = {
  sucursalId: 'suc-1',
  items: [{ sku: 'CER-1', cantidad: 2 }],
  pagos: [{ medio: 'efectivo', monto: 100 }],
};

const rpcVentaOk = {
  registrar_venta: { venta_id: 'v-1', subtotal: 100, descuento: 0, total: 100 },
};

// productoIdPorSku consulta productos y codigos_barras; devolvemos un producto
const tablasBase = {
  productos: { id: 'p-1' },
  ventas_items: [],
  ventas: { cliente_id: null },
};

describe('VentasService.registrar', () => {
  it('registra la venta y devuelve los datos de la RPC', async () => {
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase });
    const r = await svc.registrar(dtoBase as any);
    expect(r.venta_id).toBe('v-1');
    expect(r.total).toBe(100);
  });

  it('cta cte: rechaza ANTES de registrar si el cliente no existe', async () => {
    const { svc, llamadas } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, clientes: null },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/no está registrado/);
    // la venta NUNCA llegó a la base
    expect(llamadas.rpc.find(([fn]) => fn === 'registrar_venta')).toBeUndefined();
  });

  it('cta cte: rechaza si no está habilitada', async () => {
    const { svc } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, clientes: { id: 'c-1', nombre: 'Juan', cta_cte_habilitada: false } },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/cuenta corriente habilitada/);
  });

  it('cta cte: rechaza si supera el límite de crédito', async () => {
    const { svc } = servicio({
      rpc: { ...rpcVentaOk, saldo_cuenta: 900 },
      tablas: { ...tablasBase, clientes: { id: 'c-1', cta_cte_habilitada: true, limite_credito: 950 } },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/límite de crédito/);
  });

  it('comprobante B: emite FB ligada a la venta', async () => {
    const fact = facturacionFalsa();
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B' } as any);
    expect(fact.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'FB', ventaId: 'v-1', condicionPago: 'contado', moverStock: false }),
      undefined,
    );
    expect(r.comprobante.tipo).toBe('FB');
  });

  it('comprobante A: emite FA y corrige la cola ARCA (que nace como FB)', async () => {
    const fact = facturacionFalsa();
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    await svc.registrar({ ...dtoBase, comprobante: 'A', receptor: { docNumero: '20-1-9' } } as any);
    expect(fact.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'FA' }), undefined);
    expect(llamadas.updates).toContainEqual(['comprobantes_arca', { tipo: 'FA' }]);
  });

  it('comprobante R: emite remito y saca la venta de la cola ARCA (no es fiscal)', async () => {
    const fact = facturacionFalsa();
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    await svc.registrar({ ...dtoBase, comprobante: 'R' } as any);
    expect(fact.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'REM' }), undefined);
    expect(llamadas.deletes).toContain('comprobantes_arca');
  });

  it('si el comprobante falla, la venta NO se pierde (vuelve con comprobanteError)', async () => {
    const fact = facturacionFalsa();
    fact.emitir.mockRejectedValue(new BadRequestException('numerador roto'));
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B' } as any);
    expect(r.venta_id).toBe('v-1');
    expect(r.comprobante).toBeUndefined();
    expect(r.comprobanteError).toMatch(/numerador/);
  });

  it('reintento offline (duplicada): no vuelve a emitir comprobante', async () => {
    const fact = facturacionFalsa();
    const { svc } = servicio(
      { rpc: { registrar_venta: { venta_id: 'v-1', duplicada: true } }, tablas: tablasBase },
      fact,
    );
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B', ventaId: 'v-1' } as any);
    expect(r.duplicada).toBe(true);
    expect(fact.emitir).not.toHaveBeenCalled();
  });

  it('descuento autorizado: viaja a la RPC con el autorizante', async () => {
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase });
    await svc.registrar({ ...dtoBase, descuentoExtra: 10, autorizadoPor: 'sup-1' } as any);
    const [, args] = llamadas.rpc.find(([fn]) => fn === 'registrar_venta')!;
    expect(args.p_descuento_extra).toBe(10);
    expect(args.p_autorizado_por).toBe('sup-1');
  });

  // P0-05: si la venta entra por una caja abierta, la sucursal SIEMPRE se deriva
  // de la sesión (no del sucursalId del cliente): no se puede cobrar en la caja
  // de una sucursal y descontar stock de la otra.
  it('con sesión de caja: la sucursal se deriva de la sesión, no del dto', async () => {
    const { svc, llamadas } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, sesiones_caja: { cerrada_en: null, caja: { sucursal_id: 'suc-REAL' } } },
    });
    await svc.registrar({ ...dtoBase, sucursalId: 'suc-REAL', sesionCajaId: 'ses-1' } as any);
    const [, args] = llamadas.rpc.find(([fn]) => fn === 'registrar_venta')!;
    expect(args.p_sucursal).toBe('suc-REAL');
  });

  it('rechaza si la caja abierta es de otra sucursal (cobro cruzado)', async () => {
    const { svc } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, sesiones_caja: { cerrada_en: null, caja: { sucursal_id: 'suc-A' } } },
    });
    await expect(
      svc.registrar({ ...dtoBase, sucursalId: 'suc-B', sesionCajaId: 'ses-1' } as any),
    ).rejects.toThrow(/otra sucursal/);
  });

  it('rechaza si la sesión de caja está cerrada', async () => {
    const { svc } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, sesiones_caja: { cerrada_en: '2026-07-01', caja: { sucursal_id: 'suc-1' } } },
    });
    await expect(
      svc.registrar({ ...dtoBase, sesionCajaId: 'ses-1' } as any),
    ).rejects.toThrow(/cerrada/);
  });
});


// ============================================================
// CAMBIO DE MEDIO DE PAGO (el cliente se arrepintió después de cobrar)
// El contrato que importa: sin supervisor no se toca nada, los pagos tienen
// que sumar el total del ticket, y si sale Mercado Pago la plata se devuelve
// ANTES de cambiar los pagos (si el reembolso falla, el arqueo no miente).
// ============================================================
describe('VentasService.cambiarMedioPago', () => {
  const tablasVenta = {
    ventas: { id: 'v-1', total: 1400, estado: 'completada' },
    pagos: [{ medio: 'mercadopago', monto: 1400 }],
  };
  const rpcOk = { cambiar_medio_pago_venta: { ok: true } };

  it('sin autorización de supervisor no cambia nada', async () => {
    const { svc, llamadas } = servicio({ rpc: rpcOk, tablas: tablasVenta });
    await expect(
      svc.cambiarMedioPago('v-1', { pagos: [{ medio: 'efectivo', monto: 1400 }] }),
    ).rejects.toThrow(/supervisor/);
    expect(llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta')).toBeUndefined();
  });

  it('rechaza si los pagos no suman el total del ticket', async () => {
    const { svc, llamadas } = servicio({ rpc: rpcOk, tablas: tablasVenta });
    await expect(
      svc.cambiarMedioPago('v-1', { pagos: [{ medio: 'efectivo', monto: 999 }], autorizadoPor: 'sup-1' }),
    ).rejects.toThrow(/suman/);
    expect(llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta')).toBeUndefined();
  });

  it('si sale Mercado Pago, devuelve la plata ANTES de cambiar los pagos', async () => {
    const mp = {
      pagoMPDeVenta: jest.fn().mockResolvedValue({ paymentId: '123', cuenta: 'principal', monto: 1400 }),
      reembolsar: jest.fn().mockResolvedValue({ refundId: 'r-1', estado: 'approved', monto: 1400 }),
    };
    const { svc, llamadas } = servicio({ rpc: rpcOk, tablas: tablasVenta }, facturacionFalsa(), mp);
    await svc.cambiarMedioPago('v-1', {
      pagos: [{ medio: 'efectivo', monto: 1400 }],
      autorizadoPor: 'sup-1',
    });
    expect(mp.reembolsar).toHaveBeenCalledWith('123', undefined, 'principal');
    const rpc = llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta');
    expect(rpc).toBeDefined();
    expect(rpc![1].p_mp).toEqual({ paymentId: '123', refundId: 'r-1', estado: 'approved' });
  });

  it('si el reembolso de Mercado Pago falla, los pagos quedan como estaban', async () => {
    const mp = {
      pagoMPDeVenta: jest.fn().mockResolvedValue({ paymentId: '123', cuenta: 'principal', monto: 1400 }),
      reembolsar: jest.fn().mockRejectedValue(new BadRequestException('MP no pudo devolver')),
    };
    const { svc, llamadas } = servicio({ rpc: rpcOk, tablas: tablasVenta }, facturacionFalsa(), mp);
    await expect(
      svc.cambiarMedioPago('v-1', { pagos: [{ medio: 'efectivo', monto: 1400 }], autorizadoPor: 'sup-1' }),
    ).rejects.toThrow(/devolver/);
    expect(llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta')).toBeUndefined();
  });

  it('sin operación de MP identificada avisa en vez de cambiar a ciegas', async () => {
    const { svc, llamadas } = servicio({ rpc: rpcOk, tablas: tablasVenta });
    await expect(
      svc.cambiarMedioPago('v-1', { pagos: [{ medio: 'efectivo', monto: 1400 }], autorizadoPor: 'sup-1' }),
    ).rejects.toThrow(/Mercado Pago/);
    expect(llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta')).toBeUndefined();
  });

  it('sin Mercado Pago de por medio, cambia sin pedirle nada a MP', async () => {
    const mp = { pagoMPDeVenta: jest.fn(), reembolsar: jest.fn() };
    const { svc, llamadas } = servicio(
      { rpc: rpcOk, tablas: { ...tablasVenta, pagos: [{ medio: 'efectivo', monto: 1400 }] } },
      facturacionFalsa(),
      mp,
    );
    await svc.cambiarMedioPago('v-1', {
      pagos: [{ medio: 'tarjeta', monto: 1400, terminal: 'getnet' }],
      autorizadoPor: 'sup-1',
      motivo: 'el cliente pagó con tarjeta',
    });
    expect(mp.reembolsar).not.toHaveBeenCalled();
    const rpc = llamadas.rpc.find(([fn]) => fn === 'cambiar_medio_pago_venta');
    expect(rpc![1].p_pagos).toEqual([{ medio: 'tarjeta', monto: 1400, terminal: 'getnet' }]);
    expect(rpc![1].p_motivo).toBe('el cliente pagó con tarjeta');
  });
});


// ============================================================
// DEVOLUCIÓN PEDIDA A DISTANCIA: EL AVISO POR WHATSAPP (2/10/2026)
// Sale como tarjeta Placa roja "DEVOLUCIÓN" con el texto de siempre como
// epígrafe. Si la tarjeta no se arma o WhatsApp no la acepta, va el texto
// solo, como antes: el aviso al supervisor no se pierde nunca. WAHA va
// simulado: acá no sale ningún mensaje.
// ============================================================
describe('VentasService.pedirDevolucion: el aviso por WhatsApp', () => {
  const venta = {
    id: 'v-1', sucursal_id: 'suc-1', estado: 'completada',
    items: [
      { cantidad: 3, precio_unitario: 20500, producto: { sku: 'FER-1', nombre: 'Fernet Branca x750cc' } },
      { cantidad: 2, precio_unitario: 4700, producto: { sku: 'COC-1', nombre: 'Coca-Cola 1,5 L' } },
    ],
  };

  function dbDevolucion(o: { supervisores?: any[]; errorSubida?: { message: string } } = {}) {
    const log: any[] = [];
    const db: any = {
      from(tabla: string) {
        const ops: any[] = [];
        const q: any = {};
        for (const m of ['select', 'eq', 'in', 'insert', 'update']) q[m] = (...a: any[]) => { ops.push([m, ...a]); return q; };
        const uno = () => {
          if (tabla === 'ventas') return venta;
          // no hay otra esperando; el insert devuelve el pedido nuevo
          if (tabla === 'devoluciones_pendientes') return ops.some(([m]) => m === 'insert') ? { id: 'dev-1' } : null;
          if (tabla === 'sesiones_caja') return { caja: { nombre: 'Caja 1' } };
          if (tabla === 'usuarios') return { nombre: 'Ana Gómez' };
          if (tabla === 'sucursales') return { nombre: 'Saint Thomas' };
          return null;
        };
        const lista = () => {
          const upd = ops.find(([m]) => m === 'update');
          if (upd) log.push({ update: tabla, datos: upd[1] });
          const ins = ops.find(([m]) => m === 'insert');
          if (ins) log.push({ insert: tabla, datos: ins[1] });
          if (tabla === 'usuarios') return o.supervisores ?? [{ id: 'u-1', nombre: 'Juan Pablo', telefono: '11 2281-2200' }];
          return null;
        };
        q.maybeSingle = async () => ({ data: uno(), error: null });
        q.single = async () => ({ data: uno(), error: null });
        q.then = (ok: any, err: any) => Promise.resolve({ data: lista(), error: null }).then(ok, err);
        return q;
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (ruta: string) => { log.push({ subido: `${bucket}/${ruta}` }); return { error: o.errorSubida ?? null }; },
          getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://x.supabase.co/${bucket}/${ruta}` } }),
        }),
      },
    };
    return { db, log };
  }

  const pedir = (db: any) =>
    new VentasService(db, facturacionFalsa() as any, cajaFalsa() as any, mpFalso() as any).pedirDevolucion('v-1', {
      items: [{ sku: 'FER-1', cantidad: 2 }, { sku: 'COC-1', cantidad: 1 }],
      reintegro: 'efectivo', sesionCajaId: 'ses-1', usuarioId: 'u-cajera',
    });

  // lo que le llega a WAHA, en orden
  const waha: { ruta: string; cuerpo: any }[] = [];
  let rechazaImagen = false;
  const fetchOriginal = (global as any).fetch;
  const ENTORNO = ['WAHA_URL', 'WAHA_API_KEY', 'ADMIN_URL'] as const;
  const entornoOriginal = Object.fromEntries(ENTORNO.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    waha.length = 0;
    rechazaImagen = false;
    mockCartel.mockReset();
    mockCartel.mockImplementation(async () => Buffer.from('png'));
    process.env.WAHA_URL = 'https://waha.prueba';
    process.env.WAHA_API_KEY = 'k';
    process.env.ADMIN_URL = 'https://panel.prueba';
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      const ruta = new URL(url).pathname;
      waha.push({ ruta, cuerpo: JSON.parse(init.body) });
      if (ruta === '/api/sendImage' && rechazaImagen) return { ok: false, status: 422, json: async () => ({}) };
      return { ok: true, status: 201, json: async () => ({ id: { _serialized: `true_5491122812200@c.us_${waha.length}` } }) };
    });
  });

  afterAll(() => {
    (global as any).fetch = fetchOriginal;
    for (const k of ENTORNO) {
      if (entornoOriginal[k] === undefined) delete process.env[k];
      else process.env[k] = entornoOriginal[k];
    }
  });

  it('sale la tarjeta DEVOLUCIÓN, renglón por renglón, con el texto de siempre como epígrafe', async () => {
    const { db, log } = dbDevolucion();
    const r = await pedir(db);
    expect(r.monto).toBe(45700);

    expect(mockCartel).toHaveBeenCalledTimes(1);
    expect(mockCartel.mock.calls[0][0]).toEqual({
      titulo: 'DEVOLUCIÓN',
      subtitulo: 'Caja 1 · Saint Thomas',
      renglones: [
        { nombre: 'Fernet Branca 750 cc', cantidad: 2, unitario: 20500, subtotal: 41000 },
        { nombre: 'Coca-Cola 1,5 L', cantidad: 1, unitario: 4700, subtotal: 4700 },
      ],
      total: 45700,
      entrega: { titulo: 'Pide Ana Gómez', detalle: 'Reintegro en efectivo' },
      confirmar: false,
      pie: '',
      nota: 'Autorizala en Aprobaciones',
    });
    expect(log.find((x) => x.subido)?.subido).toMatch(/^publico\/carteles\/\d{4}-\d{2}\/devolucion-dev-1\.png$/);

    expect(waha.map((w) => w.ruta)).toEqual(['/api/sendImage']);
    const { cuerpo } = waha[0];
    expect(cuerpo.chatId).toBe('5491122812200@c.us');
    expect(cuerpo.file.url).toMatch(/^https:\/\/x\.supabase\.co\/publico\/carteles\/.+\/devolucion-dev-1\.png$/);
    expect(cuerpo.caption).toContain('Devolución en caja: $45.700 esperando tu autorización');
    expect(cuerpo.caption).toContain('pide devolver 2× Fernet Branca x750cc, 1× Coca-Cola 1,5 L, con reintegro en efectivo');
    expect(cuerpo.caption).toContain('https://panel.prueba/aprobaciones');
    expect(log).toContainEqual({ update: 'devoluciones_pendientes', datos: { avisos: [{ usuario: 'Juan Pablo', campanita: true, whatsapp: true }] } });
  });

  it('si WhatsApp no acepta la tarjeta, va el texto como antes', async () => {
    rechazaImagen = true;
    const { db, log } = dbDevolucion();
    await pedir(db);
    expect(waha.map((w) => w.ruta)).toEqual(['/api/sendImage', '/api/sendText']);
    expect(waha[1].cuerpo.text).toBe(waha[0].cuerpo.caption);
    expect(waha[1].cuerpo.text).toContain('pide devolver 2× Fernet Branca x750cc, 1× Coca-Cola 1,5 L');
    expect(log).toContainEqual({ update: 'devoluciones_pendientes', datos: { avisos: [{ usuario: 'Juan Pablo', campanita: true, whatsapp: true }] } });
  });

  it('si la tarjeta no se puede dibujar, va el texto (y no se sube nada)', async () => {
    mockCartel.mockRejectedValue(new Error('sin tipografías'));
    const { db, log } = dbDevolucion();
    await pedir(db);
    expect(log.some((x) => x.subido)).toBe(false);
    expect(waha.map((w) => w.ruta)).toEqual(['/api/sendText']);
    expect(waha[0].cuerpo.text).toContain('Aprobala o rechazala acá: https://panel.prueba/aprobaciones');
  });

  it('si la tarjeta no se puede subir, va el texto', async () => {
    const { db } = dbDevolucion({ errorSubida: { message: 'bucket lleno' } });
    await pedir(db);
    expect(waha.map((w) => w.ruta)).toEqual(['/api/sendText']);
  });

  it('si ningún supervisor tiene teléfono no se dibuja la tarjeta, pero la campanita sale igual', async () => {
    const { db, log } = dbDevolucion({ supervisores: [{ id: 'u-1', nombre: 'Juan Pablo', telefono: null }] });
    await pedir(db);
    expect(mockCartel).not.toHaveBeenCalled();
    expect(waha).toHaveLength(0);
    expect(log).toContainEqual(expect.objectContaining({ insert: 'alertas_internas' }));
    expect(log).toContainEqual({ update: 'devoluciones_pendientes', datos: { avisos: [{ usuario: 'Juan Pablo', campanita: true, whatsapp: false }] } });
  });
});
