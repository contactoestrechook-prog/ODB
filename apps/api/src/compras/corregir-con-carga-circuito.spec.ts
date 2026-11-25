// Corregir una factura registrada desde la carga (20/11/2026): el recorrido del
// servicio con una base en memoria. Directo (dueño), pedido (administración),
// el resguardo de los pagos y que la remarcación de la carga llegue al precio.
import { ComprasService } from './compras.service';

type Fila = Record<string, any>;
function baseEnMemoria(tablas: Record<string, Fila[]>, rpcs: Record<string, (a: any) => any>) {
  let n = 0;
  const consulta = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = [];
    let accion: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let valores: any = null;
    let una = false;
    let tope: number | null = null;
    const filas = () => (tablas[tabla] ??= []);
    const correr = () => {
      if (accion === 'insert') {
        const nuevas = (Array.isArray(valores) ? valores : [valores]).map((v) => ({ id: `id${++n}`, ...v }));
        filas().push(...nuevas);
        return { data: una ? nuevas[0] : nuevas, error: null };
      }
      let r = filas().filter((f) => filtros.every((p) => p(f)));
      if (accion === 'delete') { tablas[tabla] = filas().filter((f) => !r.includes(f)); return { data: null, error: null }; }
      if (accion === 'update') { r.forEach((f) => Object.assign(f, valores)); return { data: null, error: null }; }
      if (tope != null) r = r.slice(0, tope);
      return { data: una ? r[0] ?? null : r.map((f) => ({ ...f })), error: null };
    };
    const q: any = {
      select: () => q, order: () => q,
      update: (v: any) => { accion = 'update'; valores = v; return q; },
      insert: (v: any) => { accion = 'insert'; valores = v; return q; },
      delete: () => { accion = 'delete'; return q; },
      eq: (c: string, v: any) => { filtros.push((f) => (c.includes('->>') ? f[c.split('->>')[0]]?.[c.split('->>')[1]] : f[c]) === v); return q; },
      neq: (c: string, v: any) => { filtros.push((f) => f[c] !== v); return q; },
      in: (c: string, v: any[]) => { filtros.push((f) => v.includes(f[c])); return q; },
      limit: (k: number) => { tope = k; return q; },
      maybeSingle: () => { una = true; return Promise.resolve(correr()); },
      single: () => { una = true; return Promise.resolve(correr()); },
      then: (ok: any, mal: any) => Promise.resolve(correr()).then(ok, mal),
    };
    return q;
  };
  return { from: (t: string) => consulta(t), rpc: async (nombre: string, args: any) => ({ data: rpcs[nombre](args), error: null }) } as any;
}

function armar(factura: Partial<Fila> = {}) {
  const tablas: Record<string, Fila[]> = {
    facturas_proveedor: [{
      id: 'F1', numero: '0006-00070233', proveedor_id: 'UMAMI', oc_id: 'OC1', estado: 'pendiente', compra_eventual: false, monto: 3829427.38, monto_pagado: 0,
      neto: 3000000, iva: 630000, percepcion_iva: 0, percepcion_iibb: 199427.38, impuestos_internos: 0, otros_impuestos: 0, letra: 'A', fecha_emision: '2026-11-18', ...factura,
    }],
    ordenes_compra: [{ id: 'OC1', origen: 'directa' }],
    ordenes_compra_items: [
      { oc_id: 'OC1', producto_id: 'P-MALBEC', cantidad_recibida: 18, costo_unitario: 13425.38, producto: { nombre: 'Las Perdices Exploracion Malbec - Chacayes x750cc' } },
      { oc_id: 'OC1', producto_id: 'P-GEWURZ', cantidad_recibida: 8, costo_unitario: 17867.96, producto: { nombre: 'Las Perdices Exploracion Gewurztraimer x750cc' } },
    ],
    productos: [
      { id: 'P-MALBEC', sku: 'L6377', nombre: 'Las Perdices Exploracion Malbec - Chacayes x750cc', categoria: { margen_sugerido: 60 } },
      { id: 'P-GEWURZ', sku: 'L7018', nombre: 'Las Perdices Exploracion Gewurztraimer x750cc', categoria: { margen_sugerido: 60 } },
    ],
    proveedor_productos: [], facturas_proveedor_items: [{ factura_id: 'F1', descripcion: 'viejo' }], facturas_proveedor_cambios: [], auditoria: [], usuarios: [{ id: 'U-JP', rol: 'dueno', activo: true, nombre: 'Juan Pablo' }], alertas_internas: [],
  };
  const llamadas: any[] = [];
  const db = baseEnMemoria(tablas, { corregir_renglones_factura: (a: any) => { llamadas.push(a); return { ok: true, sinRestar: [], costos: [] }; } });
  const s = new ComprasService(db);
  (s as any).aprenderVinculos = jest.fn(async () => undefined);
  return { s, tablas, llamadas };
}

const carga = (malbec = { cantidad: 12, costo: 20138.07 }) => ({
  proveedorId: 'UMAMI',
  factura: { numero: '0006-00070233', total: 3829427.38 },
  items: [
    { sku: 'L6377', cantidad: malbec.cantidad, costo: malbec.costo, margenPct: 70, descripcionLeida: 'LP EXPLORACION MAL CHACAYES', precioLeido: 104072.73 },
    { sku: 'L7018', cantidad: 8, costo: 17867.96, margenPct: 70, descripcionLeida: 'LP EXPLORACION GEWURZTRAMINER CAJA X 4' },
  ],
}) as any;

describe('corregir la factura registrada desde la carga', () => {
  it('un dueño la corrige directo: solo el Malbec, con la remarcación de la carga, y el papel queda nuevo', async () => {
    const { s, tablas, llamadas } = armar();
    const r: any = await s.corregirConCarga('F1', carga(), { sub: 'U-JP', rol: 'dueno' });
    expect(r).toMatchObject({ ok: true, renglones: ['Las Perdices Exploracion Malbec - Chacayes x750cc: 18 → 12 · $13.425,38 → $20.138,07'], encabezado: [] });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].p_renglones).toEqual([{ producto_id: 'P-MALBEC', producto_nuevo_id: null, cantidad: 12, costo: 20138.07, precio: expect.any(Number) }]);
    // 70 % de la carga, no el 60 del rubro
    expect(llamadas[0].p_renglones[0].precio).toBeGreaterThan(20138.07 * 1.69);
    expect(llamadas[0].p_motivo).toContain('Corregida desde la carga');
    expect(tablas.facturas_proveedor_items.map((i) => i.descripcion)).toEqual(['LP EXPLORACION MAL CHACAYES', 'LP EXPLORACION GEWURZTRAMINER CAJA X 4']);
    expect(tablas.auditoria.some((a) => a.accion === 'corregir_factura_con_carga')).toBe(true);
    expect((s as any).aprenderVinculos).toHaveBeenCalled();
  });

  it('quien no es gerente ni dueño la pide: no cambia nada y le llega a un dueño', async () => {
    const { s, tablas, llamadas } = armar();
    const r: any = await s.corregirConCarga('F1', carga(), { sub: 'U-ANA', rol: 'administrativo', roles: ['comprador'] });
    expect(r).toMatchObject({ ok: true, pedido: true });
    expect(llamadas).toHaveLength(0);
    expect(tablas.facturas_proveedor_cambios).toHaveLength(1);
    expect(tablas.facturas_proveedor_cambios[0]).toMatchObject({ tipo: 'renglones' });
    expect(tablas.facturas_proveedor_cambios[0].cambios.renglones[0]).toMatchObject({ productoId: 'P-MALBEC', cantidad: 12 });
    expect(tablas.facturas_proveedor_items.map((i) => i.descripcion)).toEqual(['viejo']);
  });

  it('Anabella, con el permiso facturas_directo, la corrige directo como un dueño (25/11/2026)', async () => {
    const { s, tablas, llamadas } = armar();
    tablas.usuarios.push({ id: 'U-ANABELLA', rol: 'administrativo', activo: true, nombre: 'Anabella', permisos: ['facturas_directo'] });
    const r: any = await s.corregirConCarga('F1', carga(), { sub: 'U-ANABELLA', rol: 'administrativo', roles: ['administrativo', 'cajero'] });
    expect(r.pedido).toBeUndefined();
    expect(llamadas).toHaveLength(1);
    expect(tablas.facturas_proveedor_cambios).toHaveLength(0);
  });

  it('con pagos, el total no se cambia desde la carga', async () => {
    const { s } = armar({ monto_pagado: 1000000, estado: 'parcial' });
    const c = carga();
    c.factura.total = 3800000;
    await expect(s.corregirConCarga('F1', c, { rol: 'dueno' })).rejects.toThrow('ya tiene pagos');
  });

  it('solo ver no toca nada', async () => {
    const { s, tablas, llamadas } = armar();
    const r: any = await s.corregirConCarga('F1', { ...carga(), soloVer: true }, { rol: 'dueno' });
    expect(r.nada).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect(tablas.facturas_proveedor_items.map((i) => i.descripcion)).toEqual(['viejo']);
  });

  it('una factura que entró con orden de compra no se corrige desde la carga', async () => {
    const { s, tablas } = armar();
    tablas.ordenes_compra[0].origen = 'compra';
    await expect(s.corregirConCarga('F1', carga(), { rol: 'dueno' })).rejects.toThrow('Corregir renglones');
  });
});
