import { AbastecimientoService, filaCorta } from './abastecimiento.service';

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

function dbFalsa(t: { abastecimiento?: any[]; proveedores?: any[]; faltan?: string[]; oc?: any } = {}) {
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
