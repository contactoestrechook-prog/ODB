import { AbastecimientoService, filaCorta } from './abastecimiento.service';
import { armarPropuestas, cantidadPedible } from './propuesta';

// El agente de compras (1/10/2026): las cuentas las hace la base; acá se prueba
// que las herramientas filtren, resuelvan nombres y armen la orden con el aviso
// correcto cuando el proveedor está incompleto.

const fila = (x: any = {}) => ({
  producto_id: 'p1', sku: 'L1', nombre: 'Leche Zero 1L', categoria: 'lacteos', sucursal_id: 'st', sucursal: 'Suc Sant Thomas',
  stock: 0, en_camino: 0, ritmo_dia: 5.48, ritmo_fuente: 'sistema viejo', ritmo_hasta: '2026-07-21', tendencia_pct: null,
  cobertura_dias: 0, proveedor_id: 'pv1', proveedor: 'La Serenísima', proveedor_faltan: ['teléfono / WhatsApp'],
  plazo_dias: 7, plazo_fuente: 'sin confirmar: 7 días por defecto', punto_pedido: 52, alerta: 'sin_stock', urgencia: 1054.8,
  cantidad_sugerida: 132, ultimo_costo: 1500.4, ultima_compra: null, ultima_cantidad: null, ...x,
});

function dbFalsa(t: { abastecimiento?: any[]; proveedores?: any[]; faltan?: string[]; oc?: any; conFoto?: { id: string }[] } = {}) {
  const rpcs: any[] = [];
  const db: any = {
    rpcs,
    rpc: jest.fn(async (nombre: string, args: any) => {
      rpcs.push({ nombre, args });
      if (nombre === 'abastecimiento') return { data: t.abastecimiento ?? [], error: null };
      if (nombre === 'proveedor_faltantes') return { data: t.faltan ?? [], error: null };
      return { data: null, error: null };
    }),
    from(tabla: string) {
      const res =
        tabla === 'sucursales' ? { data: [{ id: 'st', nombre: 'Suc Sant Thomas' }, { id: 'si', nombre: 'Suc Santa Ines' }], error: null }
        : tabla === 'proveedores' ? { data: t.proveedores ?? [], error: null }
        : tabla === 'ordenes_compra' ? { data: t.oc ?? null, error: null }
        : tabla === 'productos' ? { data: t.conFoto ?? [], error: null }
        : { data: null, error: null };
      const b: any = {
        select: () => b, eq: () => b, ilike: () => b, in: () => b, order: () => b, limit: () => b, is: () => b,
        maybeSingle: async () => res,
        then: (ok: any, err: any) => Promise.resolve(res).then(ok, err),
      };
      return b;
    },
  };
  return db;
}

describe('abastecimiento: herramientas del agente', () => {
  it('filaCorta deja lo que el agente necesita, con la sucursal legible', () => {
    const c = filaCorta(fila());
    expect(c).toMatchObject({ sku: 'L1', sucursal: 'Saint Thomas', ritmo_dia: 5.48, alerta: 'sin stock', sugerido: 132, costo: 1500, proveedor: 'La Serenísima' });
  });

  it('entiende la sucursal como la escribe la gente', async () => {
    const s = new AbastecimientoService(dbFalsa(), {} as any);
    expect(await s.sucursalId('Saint Thomas')).toBe('st');
    expect(await s.sucursalId('santa inés')).toBe('si');
    expect(await s.sucursalId('todas')).toBeNull();
    await expect(s.sucursalId('Palermo')).rejects.toThrow(/No conozco la sucursal/);
  });

  it('ver_faltantes filtra por alerta y rubro, cuenta el total y respeta el límite', async () => {
    const filas = [fila(), fila({ sku: 'L2', alerta: 'no_llega' }), fila({ sku: 'L3', categoria: 'Vinos', alerta: 'sin_stock' })];
    const s = new AbastecimientoService(dbFalsa({ abastecimiento: filas }), {} as any);
    const r: any = await s.verFaltantes({ alerta: 'sin_stock', rubro: 'lact', limite: 1 });
    expect(r.de).toBe(1);
    expect(r.renglones.map((x: any) => x.sku)).toEqual(['L1']);
    expect(r.totales).toEqual({ 'sin stock': 1 });
  });

  it('armar_orden crea la orden y avisa que queda FRENADA si al proveedor le falta algo', async () => {
    const crear = jest.fn(async () => ({ ordenCompraId: 'oc1' }));
    const db = dbFalsa({ proveedores: [{ id: 'pv1', razon_social: 'La Serenísima', activo: true }], faltan: ['teléfono / WhatsApp'], oc: { numero: 31, total: 198000, estado: 'pendiente_aprobacion' } });
    const s = new AbastecimientoService(db, { crear } as any);
    const r: any = await s.armarOrden({ proveedor: 'La Serenísima', sucursal: 'Saint Thomas', items: [{ sku: 'L1', cantidad: 131.2 }, { sku: 'L9', cantidad: 0 }] }, 'u1');
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ proveedorId: 'pv1', sucursalId: 'st', usuarioId: 'u1', items: [{ sku: 'L1', cantidad: 132 }] }));
    expect(r.orden).toBe(31);
    expect(r.proveedor_completo).toBe(false);
    expect(r.aviso).toMatch(/FRENADA.*teléfono/);
  });

  it('armar_orden no adivina: con dos proveedores parecidos pide cuál', async () => {
    const crear = jest.fn();
    const db = dbFalsa({ proveedores: [{ id: 'a', razon_social: 'Distri Sur' }, { id: 'b', razon_social: 'Distri Sur Bebidas' }] });
    const r: any = await new AbastecimientoService(db, { crear } as any).armarOrden({ proveedor: 'Distri', sucursal: 'Saint Thomas', items: [{ sku: 'L1', cantidad: 1 }] });
    expect(r.error).toMatch(/varios proveedores/);
    expect(crear).not.toHaveBeenCalled();
  });

  it('armar_orden pide una sucursal concreta', async () => {
    const db = dbFalsa({ proveedores: [{ id: 'pv1', razon_social: 'La Serenísima' }] });
    const r: any = await new AbastecimientoService(db, { crear: jest.fn() } as any).armarOrden({ proveedor: 'La Serenísima', sucursal: 'todas', items: [{ sku: 'L1', cantidad: 1 }] });
    expect(r.error).toMatch(/una sucursal/);
  });
});

// La propuesta para tildar (1/10/2026): el dueño la vio como una lista con
// guiones en el chat y pidió otra cosa. Ahora sale como nota de pedido por
// proveedor; estas pruebas cuidan que los números sigan saliendo de la base.
describe('abastecimiento: la propuesta para tildar', () => {
  const filas = [
    fila({ sku: 'L1', nombre: 'Leche Zero 1L', alerta: 'menos_de_12', stock: 8, cobertura_dias: 1.5, cantidad_sugerida: 40.2 }),
    fila({ sku: 'L2', producto_id: 'p2', nombre: 'Yogur', alerta: 'sin_stock', cantidad_sugerida: 12, ultimo_costo: 900 }),
    fila({ sku: 'L3', producto_id: 'p3', nombre: 'Manteca', alerta: 'no_llega', stock: 3, cobertura_dias: 2, cantidad_sugerida: 6, ultimo_costo: 2000 }),
    fila({ sku: 'V1', producto_id: 'p4', proveedor_id: 'pv2', proveedor: 'Bodega', proveedor_faltan: [], alerta: 'sin_stock', cantidad_sugerida: 6, ultimo_costo: 10000 }),
    fila({ sku: 'X1', producto_id: 'p5', proveedor_id: null, proveedor: null, cantidad_sugerida: 10 }),
    fila({ sku: 'Z1', producto_id: 'p6', alerta: null, cantidad_sugerida: 0 }),
  ];

  it('agrupa por proveedor y sucursal, deja afuera lo que no tiene proveedor ni sugerido', () => {
    const ps = armarPropuestas(filas);
    expect(ps.map((p) => p.proveedor)).toEqual(['La Serenísima', 'Bodega']);
    const ls = ps[0];
    expect(ls.sucursal).toBe('Saint Thomas');
    expect(ls.items.map((i) => i.sku)).toEqual(['L2', 'L3', 'L1']); // sin stock, no llega, menos de 12
    expect(ls.faltan).toEqual(['teléfono / WhatsApp']);
  });

  it('en la vista directa vienen tildados solo los urgentes y el total cuenta solo lo tildado', () => {
    const [ls] = armarPropuestas(filas);
    expect(ls.items.filter((i) => i.tildado).map((i) => i.sku)).toEqual(['L2', 'L3']);
    expect(ls.urgentes).toBe(2);
    expect(ls.total).toBe(12 * 900 + 6 * 2000);
    // el sugerido no entero se redondea para arriba: se piden unidades
    expect(ls.items.find((i) => i.sku === 'L1')!.cantidad).toBe(41);
  });

  it('lo que propone el agente: solo esos productos, con su cantidad y tildados', () => {
    const pedidos = new Map([['L1', { cantidad: 24, motivo: 'caja de 12' }], ['L3', { cantidad: 6 }]]);
    const [p] = armarPropuestas(filas, { pedidos });
    expect(p.items.map((i) => [i.sku, i.cantidad, i.tildado])).toEqual([['L3', 6, true], ['L1', 24, true]]);
    expect(p.items.find((i) => i.sku === 'L1')!.motivo).toBe('caja de 12');
  });

  it('foto solo si el producto la tiene (una foto rota se ve peor que ninguna)', () => {
    const [p] = armarPropuestas(filas, { conFoto: new Set(['p2']), urlFoto: (sku) => `foto/${sku}` });
    expect(p.items.find((i) => i.sku === 'L2')!.foto).toBe('foto/L2');
    expect(p.items.find((i) => i.sku === 'L3')!.foto).toBeNull();
  });

  it('lo que no se vende no tiene días de cobertura (no es "0 días")', () => {
    const [p] = armarPropuestas([fila({ ritmo_dia: 0, cobertura_dias: null, cantidad_sugerida: 3 })]);
    expect(p.items[0].coberturaDias).toBeNull();
  });

  it('cantidadPedible: enteros positivos, nada de ceros ni negativos', () => {
    expect(cantidadPedible(2.1)).toBe(3);
    expect(cantidadPedible(0)).toBe(0);
    expect(cantidadPedible(-4)).toBe(0);
    expect(cantidadPedible('abc')).toBe(0);
  });

  it('proponer_compra: a la pantalla la nota completa, al modelo un resumen corto', async () => {
    const db = dbFalsa({ abastecimiento: filas, proveedores: [{ id: 'pv1', razon_social: 'La Serenísima', activo: true }], faltan: ['teléfono / WhatsApp'], conFoto: [{ id: 'p2' }] });
    const s = new AbastecimientoService(db, {} as any);
    const r = await s.proponerCompra({ proveedor: 'La Serenísima', sucursal: 'Saint Thomas', items: [{ sku: 'L2', cantidad: 12 }, { sku: 'NOEXISTE', cantidad: 3 }] });
    expect(r.propuesta!.items.map((i) => i.sku)).toEqual(['L2']);
    expect(r.propuesta!.items[0].foto).toMatch(/productos\/L2\.jpg/);
    expect(r.resultado).toEqual({
      mostrada: true, proveedor: 'La Serenísima', sucursal: 'Saint Thomas', renglones: 1, total_estimado: 10800,
      no_encontrados: ['NOEXISTE'], para_comprarle_falta: ['teléfono / WhatsApp'],
    });
    expect(JSON.stringify(r.resultado)).not.toMatch(/foto|stock|ritmo/);
  });

  it('crearOrden desde la nota tildada: redondea, saca ceros y devuelve el número y lo que falta', async () => {
    const crear = jest.fn(async () => ({ ordenCompraId: 'oc9' }));
    const db = dbFalsa({ faltan: ['plazo de entrega'], oc: { numero: 57, total: 412000.4, estado: 'pendiente_aprobacion' } });
    const s = new AbastecimientoService(db, { crear } as any);
    const r = await s.crearOrden({ proveedorId: 'pv1', sucursalId: 'st', items: [{ sku: 'L1', cantidad: 2.5 }, { sku: 'L2', cantidad: 0 }], usuarioId: 'u1' });
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ items: [{ sku: 'L1', cantidad: 3 }], usuarioId: 'u1' }));
    expect(r).toEqual({ id: 'oc9', numero: 57, total: 412000, renglones: 1, faltan: ['plazo de entrega'] });
    await expect(s.crearOrden({ proveedorId: 'pv1', sucursalId: 'st', items: [] })).rejects.toThrow(/Tildá al menos/);
  });
});
