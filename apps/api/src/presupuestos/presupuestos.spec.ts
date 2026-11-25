jest.mock('../comun/whatsapp', () => ({
  ...jest.requireActual('../comun/whatsapp'),
  enviarWhatsapp: jest.fn(async () => ({ enviado: true })),
}));
jest.mock('../comun/cartel-pedido', () => ({
  ...jest.requireActual('../comun/cartel-pedido'),
  cartelPedido: jest.fn(async () => Buffer.from('png')),
}));

import { enviarWhatsapp } from '../comun/whatsapp';
import { cartelPedido } from '../comun/cartel-pedido';
import { ROLES } from '../auth/decorators';
import { PresupuestosController } from './presupuestos.controller';
import { PresupuestosService } from './presupuestos.service';
import { estadoVisible, renglonesPedidos, telefonoDelCliente, textoParaElCliente, totalDe } from './presupuestos';

// «Que todos puedan hacer presupuestos… llama alguien y dice tengo una fiesta en casa» (Juan
// Pablo, por Leandro, 25/11/2026). Todos los del local, por WhatsApp con tarjeta y PDF, 48 h.

const VINO = '11111111-1111-1111-1111-111111111111';
const PAPAS = '22222222-2222-2222-2222-222222222222';
const SUC = '229906e6-df69-48eb-b027-2b57fefb89fe';

describe('presupuestos: las cuentas', () => {
  it('el celular del cliente se normaliza; un fijo o algo corto no sirve', () => {
    expect(telefonoDelCliente('11 5375-6564')).toBe('5491153756564');
    expect(telefonoDelCliente('+54 9 11 5375 6564')).toBe('5491153756564');
    expect(telefonoDelCliente('4444')).toBeNull();
  });

  it('los renglones repetidos se suman y la cantidad tiene que ser mayor a cero', () => {
    expect(renglonesPedidos([{ productoId: VINO, cantidad: 2 }, { productoId: VINO, cantidad: 1 }, { productoId: PAPAS, cantidad: 3 }]))
      .toEqual([{ productoId: VINO, cantidad: 3 }, { productoId: PAPAS, cantidad: 3 }]);
    expect(renglonesPedidos([])).toBe('Agregá al menos un producto.');
    expect(renglonesPedidos([{ productoId: VINO, cantidad: 0 }])).toContain('cantidades');
  });

  it('el total no pierde centavos y vencido es un enviado que pasó las 48 h', () => {
    expect(totalDe([{ cantidad: 3, precio: 0.1 }, { cantidad: 1, precio: 0.2 }])).toBe(0.5);
    const ahora = Date.parse('2026-11-25T15:00:00Z');
    expect(estadoVisible({ estado: 'enviado', vence_en: '2026-11-25T14:00:00Z' }, ahora)).toBe('vencido');
    expect(estadoVisible({ estado: 'enviado', vence_en: '2026-11-27T14:00:00Z' }, ahora)).toBe('enviado');
    expect(estadoVisible({ estado: 'aceptado', vence_en: '2026-11-01T14:00:00Z' }, ahora)).toBe('aceptado');
  });

  it('el mensaje al cliente dice número, total y hasta cuándo vale', () => {
    const t = textoParaElCliente({ numero: 7, cliente_nombre: 'Debo Pérez', total: 70500, vence_en: '2026-11-27T17:30:00Z' });
    expect(t).toContain('Hola Debo');
    expect(t).toContain('N.º 7');
    expect(t).toContain('$70.500');
    expect(t).toContain('14:30');
  });
});

/** Base en memoria con lo que usa el servicio. */
function base() {
  const tablas: Record<string, any[]> = {
    listas_precios: [{ id: 'L-MIN', nombre: 'Minorista' }],
    productos: [{ id: VINO, sku: 'L1', nombre: 'Malbec Reserva', activo: true }, { id: PAPAS, sku: 'L2', nombre: 'Papas Lays 250 g', activo: true }],
    precios: [
      { producto_id: VINO, lista_id: 'L-MIN', precio: 9000, vigente_desde: '2026-11-01T00:00:00Z' },
      { producto_id: VINO, lista_id: 'L-MIN', precio: 10500, vigente_desde: '2026-11-20T00:00:00Z' },
      { producto_id: PAPAS, lista_id: 'L-MIN', precio: 3200, vigente_desde: '2026-11-10T00:00:00Z' },
    ],
    stock: [{ producto_id: VINO, sucursal_id: SUC, cantidad: 12 }],
    presupuestos: [],
    bot_contactos: [{ telefono: '159747047178283', telefono_real: '5491153756564' }],
    bot_conversaciones: [],
    pedidos: [],
  };
  let n = 0;
  const q = (t: string) => {
    const filtros: ((f: any) => boolean)[] = [];
    let accion: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let valores: any = null;
    let orden: { c: string; asc: boolean } | null = null;
    let una = false;
    let tope: number | null = null;
    const filas = () => (tablas[t] ??= []);
    const correr = () => {
      if (accion === 'insert') {
        const nuevas = (Array.isArray(valores) ? valores : [valores]).map((v) => ({ id: `id-${++n}`, numero: n, estado: 'borrador', creado_en: new Date().toISOString(), ...v }));
        filas().push(...nuevas);
        return { data: una ? nuevas[0] : nuevas, error: null };
      }
      if (accion === 'upsert') { filas().push(valores); return { data: null, error: null }; }
      let r = filas().filter((f) => filtros.every((p) => p(f)));
      if (accion === 'update') { r.forEach((f) => Object.assign(f, valores)); return { data: r, error: null }; }
      if (orden) r = [...r].sort((a, b) => (a[orden!.c] < b[orden!.c] ? -1 : 1) * (orden!.asc ? 1 : -1));
      if (tope != null) r = r.slice(0, tope);
      const conJoins = r.map((f) => (t === 'presupuestos' ? { ...f, sucursal: { nombre: 'Suc Sant Thomas' }, autor: { nombre: 'Jaqueline Cuadrado' }, pedido: null } : { ...f }));
      return { data: una ? conJoins[0] ?? null : conJoins, error: null };
    };
    const c: any = {
      select: () => c, order: (col: string, o?: any) => { orden = { c: col, asc: o?.ascending !== false }; return c; },
      eq: (k: string, v: any) => { filtros.push((f) => f[k] === v); return c; },
      in: (k: string, v: any[]) => { filtros.push((f) => v.includes(f[k])); return c; },
      lte: (k: string, v: any) => { filtros.push((f) => f[k] <= v); return c; },
      limit: (k: number) => { tope = k; return c; },
      insert: (v: any) => { accion = 'insert'; valores = v; return c; },
      update: (v: any) => { accion = 'update'; valores = v; return c; },
      upsert: (v: any) => { accion = 'upsert'; valores = v; return Promise.resolve(correr()); },
      maybeSingle: () => { una = true; return Promise.resolve(correr()); },
      single: () => { una = true; return Promise.resolve(correr()); },
      then: (ok: any, mal: any) => Promise.resolve(correr()).then(ok, mal),
    };
    return c;
  };
  const subidas: string[] = [];
  const db: any = {
    from: q,
    rpc: async () => ({ data: [], error: null }),
    storage: { from: (b: string) => ({
      upload: async (ruta: string) => { subidas.push(`${b}/${ruta}`); return { error: null }; },
      getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://x/${ruta}` } }),
      createSignedUrl: async (ruta: string) => ({ data: { signedUrl: `https://x/firmado/${ruta}` }, error: null }),
    }) },
  };
  const charla = { crear: jest.fn(async () => ({ pedidoId: 'P-1', codigo: 'DOM-123', sinReserva: false, sinStock: [] })) };
  const s = new PresupuestosService(db, charla as any);
  // el PDF real necesita las letras del sistema: en la prueba, un PDF cualquiera
  jest.spyOn(s, 'pdf').mockResolvedValue({ numero: 1, pdf: Buffer.from('%PDF') });
  return { s, tablas, subidas, charla };
}

const JAQUI = { sub: 'U-JAQUI', nombre: 'Jaqueline Cuadrado', sucursalId: SUC };

describe('presupuestos: armar, mandar y pasar a pedido', () => {
  beforeEach(() => jest.clearAllMocks());

  it('los precios los pone el servidor (el vigente de la lista Minorista), no la pantalla', async () => {
    const { s } = base();
    const p = await s.guardar({ clienteNombre: 'Debo', clienteTelefono: '11 5375-6564', items: [{ productoId: VINO, cantidad: 6, precio: 1 }, { productoId: PAPAS, cantidad: 4 }] }, JAQUI);
    expect(p.items.map((r: any) => [r.nombre, r.cantidad, r.precio])).toEqual([['Malbec Reserva', 6, 10500], ['Papas Lays 250 g', 4, 3200]]);
    expect(p.total).toBe(75800);
    expect(p.clienteTelefono).toBe('5491153756564');
    expect(p.sucursalId).toBe(SUC);
  });

  it('sin celular o sin productos no se guarda', async () => {
    const { s } = base();
    await expect(s.guardar({ clienteTelefono: '', items: [{ productoId: VINO, cantidad: 1 }] }, JAQUI)).rejects.toThrow('celular');
    await expect(s.guardar({ clienteTelefono: '1153756564', items: [] }, JAQUI)).rejects.toThrow('al menos un producto');
  });

  it('mandar: la tarjeta y el PDF por WhatsApp, queda en la charla del cliente y vale 48 h', async () => {
    const { s, tablas, subidas } = base();
    const p = await s.guardar({ clienteNombre: 'Debo', clienteTelefono: '1153756564', items: [{ productoId: VINO, cantidad: 6 }] }, JAQUI);
    const r = await s.enviar(p.id, JAQUI);
    expect(r.estado).toBe('enviado');
    expect(cartelPedido).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'PRESUPUESTO', total: 63000 }));
    const envios = (enviarWhatsapp as jest.Mock).mock.calls.map((c) => c[1]);
    expect(envios[0]).toMatchObject({ to: '5491153756564', imagenUrl: expect.stringContaining('presupuesto-'), origen: 'presupuesto' });
    expect(envios[0].text).toContain('Hola Debo');
    expect(envios[1]).toMatchObject({ documentoUrl: expect.stringContaining('firmado/presupuestos/') });
    expect(subidas.some((x) => x.startsWith('bot-adjuntos/presupuestos/'))).toBe(true);
    // la charla es la de su @lid, en la línea de ODB
    expect(tablas.bot_conversaciones[0]).toMatchObject({ linea: 'pedidos', telefono: '159747047178283' });
    expect(tablas.bot_conversaciones[0].mensajes[0].content).toContain('Malbec Reserva');
    const horas = (Date.parse(r.venceEn) - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(47.9);
  });

  it('si el WhatsApp no sale, queda el error y no se marca como enviado', async () => {
    const { s, tablas } = base();
    (enviarWhatsapp as jest.Mock).mockResolvedValueOnce({ enviado: false, motivo: 'Número inválido' });
    const p = await s.guardar({ clienteTelefono: '1153756564', items: [{ productoId: PAPAS, cantidad: 2 }] }, JAQUI);
    await expect(s.enviar(p.id, JAQUI)).rejects.toThrow('no salió');
    expect(tablas.presupuestos[0]).toMatchObject({ estado: 'borrador', envio_error: 'Número inválido' });
  });

  it('pasar a pedido: por el camino de «Pasar a pedido» de las charlas, con el precio que se le dio', async () => {
    const { s, tablas, charla } = base();
    const p = await s.guardar({ clienteNombre: 'Debo', clienteTelefono: '1153756564', items: [{ productoId: VINO, cantidad: 6 }] }, JAQUI);
    const r: any = await s.pasarAPedido(p.id, { tipo: 'envio', direccion: 'Saint Thomas lote 258', formaPago: 'transferencia' }, JAQUI);
    expect(charla.crear).toHaveBeenCalledWith(expect.objectContaining({
      linea: 'pedidos', telefono: '159747047178283', telefonoReal: '5491153756564', tipo: 'envio', direccion: 'Saint Thomas lote 258', formaPago: 'transferencia',
      items: [expect.objectContaining({ producto_id: VINO, cantidad: 6, precio: 10500, precioDicho: 10500 })],
      notas: expect.stringContaining(`Presupuesto N.º ${p.numero}`),
    }), expect.objectContaining({ sub: 'U-JAQUI' }));
    expect(r.pedidoCodigo).toBe('DOM-123');
    expect(tablas.presupuestos[0]).toMatchObject({ estado: 'aceptado', pedido_id: 'P-1' });
    await expect(s.pasarAPedido(p.id, {}, JAQUI)).rejects.toThrow('Ya se pasó a pedido');
  });

  it('un anulado no se manda ni se pasa a pedido', async () => {
    const { s } = base();
    const p = await s.guardar({ clienteTelefono: '1153756564', items: [{ productoId: PAPAS, cantidad: 1 }] }, JAQUI);
    await s.anular(p.id, JAQUI);
    await expect(s.enviar(p.id, JAQUI)).rejects.toThrow('anulado');
    await expect(s.pasarAPedido(p.id, {}, JAQUI)).rejects.toThrow('anulado');
  });

  it('lo arman todos los del local (también salón y fiambrería); el repartidor no', () => {
    const roles: string[] = Reflect.getMetadata(ROLES, PresupuestosController);
    expect(roles).toEqual(expect.arrayContaining(['cajero', 'op_salon', 'fiambreria', 'deposito', 'administrativo', 'gerente', 'dueno']));
    expect(roles).not.toContain('repartidor');
  });
});
