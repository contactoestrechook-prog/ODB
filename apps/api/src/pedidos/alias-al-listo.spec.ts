// EL ALIAS, CON EL PEDIDO LISTO (Leandro, 21/11/2026). El caso que lo pidió:
// St (DOM-1284BEF14D1D, Saint Thomas Sur lote 614) pidió el alias al confirmar,
// transfirió $118.200, al armar faltaba la leche Cindor, canceló y hubo que
// devolverle la plata.
jest.mock('../comun/whatsapp', () => ({
  ...jest.requireActual('../comun/whatsapp'),
  enviarTextoWhatsapp: jest.fn(async () => ({ enviado: true, id: 'W1' })),
}));
jest.mock('../comun/lineas', () => {
  const real = jest.requireActual('../comun/lineas');
  return {
    ...real,
    hayWhatsapp: () => true,
    Lineas: class {
      async sesion(linea: string) { return `sesion-${linea}`; }
      async principal() { return 'general'; }
      async config() { return (global as any).__CFG_LINEA__ ?? null; }
    },
  };
});

import { enviarTextoWhatsapp } from '../comun/whatsapp';
import { PedidosService } from './pedidos.service';
import {
  aliasAlListo, avisoListoConAlias, bloqueDeAlias, datosParaTransferir, formaDePagoDeNotas, pasaAliasAlListo, totalPorTransferencia,
} from './alias-al-listo';

const CFG = { alias_pago: 'outlet.de.bebidas', cbu_pago: '0720738120000000655518', titular_pago: 'Chinvenguencha SRL', banco_pago: 'Santander' };
const DATOS = 'Alias: outlet.de.bebidas · CBU: 0720738120000000655518 · Titular: Chinvenguencha SRL (Santander)';

describe('las piezas', () => {
  it('la respuesta al «¿me pasás el alias?», con y sin código', () => {
    expect(aliasAlListo('DOM-1284BEF14D1D')).toBe('El alias te llega cuando tu pedido DOM-1284BEF14D1D esté listo, con el total final.');
    expect(aliasAlListo()).toBe('El alias te llega cuando tu pedido esté listo, con el total final.');
  });

  it('los datos de la línea, y nada si no hay alias cargado', () => {
    expect(datosParaTransferir(CFG)).toBe(DATOS);
    expect(datosParaTransferir({ alias_pago: 'x.y.z' })).toBe('Alias: x.y.z');
    expect(datosParaTransferir({ alias_pago: '  ', cbu_pago: '123' })).toBeNull();
    expect(datosParaTransferir(null)).toBeNull();
  });

  it('la forma de pago de las notas: la que aparece primero, como la base', () => {
    expect(formaDePagoDeNotas('Paga con transferencia. Factura A a TecnoIntelcom CUIT 30-70891488-2')).toBe('transferencia');
    expect(formaDePagoDeNotas('Paga en efectivo al recibir.')).toBe('efectivo');
    expect(formaDePagoDeNotas('Paga con tarjeta de débito')).toBe('tarjeta');
    expect(formaDePagoDeNotas('Paga con Mercado Pago')).toBeNull();
    expect(formaDePagoDeNotas('Timbre 2')).toBeNull();
    expect(formaDePagoDeNotas(null)).toBeNull();
  });

  it('a quién se le pasa el alias al quedar listo', () => {
    expect(pasaAliasAlListo({ forma_pago: 'transferencia', pagado_en: null, origen: 'bot', qr_retiro: 'DOM-1' })).toBe(true);
    expect(pasaAliasAlListo({ forma_pago: 'efectivo', pagado_en: null })).toBe(false);
    expect(pasaAliasAlListo({ forma_pago: 'transferencia', pagado_en: '2026-11-21T15:00:00Z' })).toBe(false);
    expect(pasaAliasAlListo({ forma_pago: 'transferencia', origen: 'pedidosya' })).toBe(false);
    expect(pasaAliasAlListo({ forma_pago: 'transferencia', qr_retiro: 'PY-123' })).toBe(false);
  });

  it('el total por transferencia descuenta solo los rubros con descuento, y al mayorista nada', () => {
    const renglones = [
      { cantidad: 2, precio_unitario: 79900, categoria: 'Vinos' },
      { cantidad: 3, precio_unitario: 1600, categoria: 'Lácteos' },
    ];
    // 159.800 de vino con 10 % = 143.820; la leche va entera
    expect(totalPorTransferencia(164600, renglones)).toBe(164600 - 15980);
    expect(totalPorTransferencia(164600, renglones, true)).toBe(164600);
    expect(totalPorTransferencia(38200, [{ cantidad: 1, precio_unitario: 38200, categoria: 'Almacén' }])).toBe(38200);
  });

  it('el aviso de listo con el alias, en vos y en renglones', () => {
    expect(avisoListoConAlias({ canal: 'domicilio', qr_retiro: 'DOM-1284BEF14D1D' }, { total: 38200, totalTransferencia: 38200, datos: DATOS })).toBe(
      'Tu pedido DOM-1284BEF14D1D ya está listo y en breve sale hacia tu domicilio.\n\n'
      + 'Total a transferir: $38.200.\n'
      + `${DATOS}.\n`
      + 'Cuando transfieras, mandame el comprobante por acá.',
    );
    const retiro = avisoListoConAlias({ canal: 'pickup', qr_retiro: 'PICKUP-1' }, { total: 317100, totalTransferencia: 285390, datos: DATOS });
    expect(retiro).toMatch(/^Tu pedido PICKUP-1 ya está listo para retirar en la sucursal Saint Thomas \(Castex 3601\)\./);
    expect(retiro).toContain('Total a transferir: $285.390 (con el descuento por transferencia).');
    expect(bloqueDeAlias({ total: 1000, totalTransferencia: 1000, datos: `${DATOS}.` })).not.toContain('..');
  });
});

// ---------------------------------------------------------------------------
// El aviso de «listo» que sale del servicio de pedidos
// ---------------------------------------------------------------------------

function armar(o: { previo?: any; items?: any[]; mayorista?: boolean; conversacion?: any[] } = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const respuesta = (tabla: string, op: string): any => {
    if (op !== 'select') return { data: null, error: null };
    if (tabla === 'bot_cotizaciones') return { data: { linea: 'local', telefono: '209117880799232' }, error: null };
    if (tabla === 'pedidos_items') return { data: o.items ?? [{ cantidad: 1, precio_unitario: 38200, producto: { categoria: { nombre: 'Almacén' } } }], error: null };
    if (tabla === 'clientes') return { data: { mayorista: o.mayorista === true }, error: null };
    if (tabla === 'pedidos_historial') return { data: o.previo ?? null, error: null };
    if (tabla === 'bot_conversaciones') return { data: { mensajes: o.conversacion ?? [{ role: 'user', content: 'Por transferencia' }] }, error: null };
    return { data: null, error: null };
  };
  const db: any = {
    escrituras,
    from(tabla: string) {
      let op = 'select';
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, mal: any) => Promise.resolve(respuesta(tabla, op)).then(ok, mal);
          if (k === 'maybeSingle' || k === 'single') return async () => respuesta(tabla, op);
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op, fila }); return b; };
          return () => b;
        },
      });
      return b;
    },
  };
  const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
  return { svc, db, escrituras };
}

const PEDIDO_ST = {
  id: 'p-st', canal: 'domicilio', qr_retiro: 'DOM-1284BEF14D1D', total: 38200, forma_pago: 'transferencia', pagado_en: null,
  origen: 'bot', cliente_id: 'c-st', cliente: { telefono: '5491155550000' }, contacto_telefono: null,
};
const enviados = () => (enviarTextoWhatsapp as jest.Mock).mock.calls.map((c) => ({ a: c[1], texto: c[2], origen: c[3], sesion: c[4] }));

beforeEach(() => {
  (enviarTextoWhatsapp as jest.Mock).mockClear();
  (global as any).__CFG_LINEA__ = CFG;
});

describe('el «listo» del que paga por transferencia lleva el alias', () => {
  it('St: domicilio, paga por transferencia, $38.200 → el alias con el total final, por su línea', async () => {
    const { svc, escrituras } = armar();
    await (svc as any).notificarWhatsApp(PEDIDO_ST, 'listo');
    const [e] = enviados();
    expect(e.sesion).toBe('sesion-local');
    expect(e.origen).toBe('aviso-cliente-pedido');
    expect(e.texto).toBe(avisoListoConAlias(PEDIDO_ST, { total: 38200, totalTransferencia: 38200, datos: DATOS }));
    // queda en el historial del pedido y en la charla del bot
    const hist = escrituras.find((w) => w.tabla === 'pedidos_historial' && w.op === 'insert');
    expect(hist?.fila).toMatchObject({ pedido_id: 'p-st', evento: 'alias', detalle: { total: 38200, total_transferencia: 38200 } });
    const charla = escrituras.find((w) => w.tabla === 'bot_conversaciones' && w.op === 'upsert');
    expect(charla?.fila.telefono).toBe('209117880799232');
    expect(charla?.fila.mensajes.at(-1)).toMatchObject({ role: 'assistant', content: e.texto });
  });

  it('con vinos, el total a transferir trae el descuento', async () => {
    const { svc } = armar({ items: [{ cantidad: 2, precio_unitario: 79900, producto: { categoria: { nombre: 'Vinos' } } }] });
    await (svc as any).notificarWhatsApp({ ...PEDIDO_ST, total: 159800 }, 'listo');
    expect(enviados()[0].texto).toContain('Total a transferir: $143.820 (con el descuento por transferencia).');
  });

  it('el que paga en efectivo recibe el «listo» de siempre, sin alias', async () => {
    const { svc, escrituras } = armar();
    await (svc as any).notificarWhatsApp({ ...PEDIDO_ST, forma_pago: 'efectivo' }, 'listo');
    expect(enviados()[0].texto).toBe('Su pedido de O.D.B (DOM-1284BEF14D1D) ya está preparado. En breve sale hacia su domicilio.');
    expect(escrituras.some((w) => w.tabla === 'pedidos_historial')).toBe(false);
  });

  it('pagado por Mercado Pago: sin alias', async () => {
    const { svc } = armar();
    await (svc as any).notificarWhatsApp({ ...PEDIDO_ST, pagado_en: '2026-11-21T14:00:00Z' }, 'listo');
    expect(enviados()[0].texto).not.toContain('Alias');
  });

  it('«en camino» no repite el alias', async () => {
    const { svc } = armar();
    await (svc as any).notificarWhatsApp(PEDIDO_ST, 'en_camino');
    expect(enviados()[0].texto).toBe('Su pedido de O.D.B (DOM-1284BEF14D1D) salió y está en camino a su domicilio.');
  });

  it('un «listo» deshecho y vuelto a marcar: con el mismo total no se repite; si cambió, sale el nuevo', async () => {
    const mismo = armar({ previo: { detalle: { total: 38200 } } });
    await (mismo.svc as any).notificarWhatsApp(PEDIDO_ST, 'listo');
    expect(enviados()[0].texto).not.toContain('Alias');
    (enviarTextoWhatsapp as jest.Mock).mockClear();
    const otro = armar({ previo: { detalle: { total: 118200 } } });
    await (otro.svc as any).notificarWhatsApp(PEDIDO_ST, 'listo');
    expect(enviados()[0].texto).toContain('Total a transferir: $38.200.');
  });

  it('la línea sin alias cargado: sale el «listo» de siempre', async () => {
    (global as any).__CFG_LINEA__ = { alias_pago: null };
    const { svc } = armar();
    await (svc as any).notificarWhatsApp(PEDIDO_ST, 'listo');
    expect(enviados()[0].texto).toBe('Su pedido de O.D.B (DOM-1284BEF14D1D) ya está preparado. En breve sale hacia su domicilio.');
  });

  it('si el WhatsApp no sale, no queda anotado como pasado', async () => {
    (enviarTextoWhatsapp as jest.Mock).mockResolvedValueOnce({ enviado: false, motivo: 'WAHA caído' });
    const { svc, escrituras } = armar();
    await (svc as any).notificarWhatsApp(PEDIDO_ST, 'listo');
    expect(escrituras.some((w) => w.tabla === 'pedidos_historial' || w.tabla === 'bot_conversaciones')).toBe(false);
  });
});
