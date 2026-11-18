// CAMBIAR EL PROVEEDOR DE UN PRODUCTO DESDE CUALQUIER PANTALLA (18/11/2026).
// Leandro: «tenemos que poder cambiar un producto de proveedor desde cualquier
// lado, tiene que ser muy fácil reasignarlo».
// El cambio en sí es una transacción de la base (reasignar_proveedor,
// db/migracion-reasignar-proveedor.sql, probada contra datos reales con la
// vuelta atrás: el Figacita pasó de La Farina a Marquisse en Qué comprar, salió
// Crusto al Paso —sin compras— y quedó La Farina —con compras—). Acá se prueba
// lo que hace la API alrededor.
jest.mock('../abastecimiento/motor', () => ({ invalidarAbastecimiento: jest.fn() }));
import { invalidarAbastecimiento } from '../abastecimiento/motor';
import { ProveedorDeProductoService } from './proveedor-de-producto.service';
import { mensajeReasignado, puedeCambiar, refValida, separarRefs, type ResultadoReasignar } from './proveedor-de-producto';

const P1 = '003a5b09-7fbb-4bf5-815f-90852cb2c257';
const P2 = '00d6047b-0408-4bca-aaa7-743f36ec4a81';
const MARQUISSE = 'aff3c3fc-ddaf-4a18-8eeb-e34d7a360c9a';
const FARINA = '4706659a-70ef-472f-b04f-63e3933ff103';

const resultado = (o: Partial<ResultadoReasignar> = {}): ResultadoReasignar => ({
  producto: { id: P1, sku: 'L10430', nombre: 'Figacita Envasada x9UN' },
  antes: { id: FARINA, razonSocial: 'La Farina', decidido: false },
  ahora: { id: MARQUISSE, razonSocial: 'Marquisse S.A.' },
  yaEstaba: false,
  vinculoNuevo: true,
  sacados: [{ id: 'c', razonSocial: 'Crusto al Paso' }],
  quedan: [{ id: FARINA, razonSocial: 'La Farina', motivo: 'compras' }],
  ...o,
});

function dbFalsa(o: { productos?: any[]; actual?: any[]; rpc?: { data?: any; error?: any } } = {}) {
  const rpcs: { nombre: string; args: any }[] = [];
  const filtros: { tabla: string; col: string; v: any }[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q,
        in: (col: string, v: any[]) => { filtros.push({ tabla, col, v }); q._in = { col, v }; return q; },
        eq: (col: string, v: any) => { filtros.push({ tabla, col, v }); q._eq = { col, v }; return q; },
        order: () => q, range: () => q,
        maybeSingle: () => Promise.resolve({ data: (o.productos ?? []).find((p) => p[q._eq.col] === q._eq.v) ?? null, error: null }),
        then: (ok: any, mal: any) => Promise.resolve({
          data: q._in ? (o.productos ?? []).filter((p) => q._in.v.includes(p[q._in.col])) : [],
          error: null,
        }).then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      rpcs.push({ nombre, args });
      if (nombre === 'proveedor_actual') return Promise.resolve({ data: (o.actual ?? []).filter((a) => args.p_ids.includes(a.producto_id)), error: null });
      return Promise.resolve({ data: o.rpc?.data ?? null, error: o.rpc?.error ?? null });
    }),
  };
  return { db, rpcs, filtros };
}

beforeEach(() => (invalidarAbastecimiento as jest.Mock).mockClear());

describe('qué producto y quién lo puede cambiar', () => {
  it('separa ids de SKU, sin repetidos, y descarta lo que no es nada', () => {
    expect(separarRefs([P1, P1.toUpperCase(), 'L10430', ' L10430 ', '', null, 'x'.repeat(61)])).toEqual({ ids: [P1], skus: ['L10430'] });
    expect(separarRefs('L1')).toEqual({ ids: [], skus: [] });
    expect(separarRefs(Array.from({ length: 900 }, (_, i) => `L${i}`)).skus).toHaveLength(500);
    expect(refValida('  ')).toBeNull();
  });

  it('lo cambian los que compran; depósito y caja solo lo ven', () => {
    for (const r of ['dueno', 'gerente', 'comprador', 'administrativo']) expect(puedeCambiar(r)).toBe(true);
    for (const r of ['deposito', 'cajero', 'repartidor', 'op_salon', undefined]) expect(puedeCambiar(r)).toBe(false);
  });
});

describe('lo que se le dice a la persona', () => {
  it('dice a quién pasó, de quién venía, qué salió y qué queda como historia', () => {
    expect(mensajeReasignado(resultado())).toBe(
      'Listo: Figacita Envasada x9UN ahora se le compra a Marquisse S.A. Antes era de La Farina. '
      + 'Salió de la lista de Crusto al Paso: nunca se le compró. '
      + 'Sigue en la lista de La Farina porque ya se le compró: queda como historia, pero Qué comprar y los pedidos van a Marquisse S.A.',
    );
  });

  it('si ya era de ese proveedor, lo dice y nada más', () => {
    expect(mensajeReasignado(resultado({ yaEstaba: true }))).toBe('Figacita Envasada x9UN ya se le compraba a Marquisse S.A.');
  });

  it('un producto sin proveedor: no inventa un «antes»', () => {
    expect(mensajeReasignado(resultado({ antes: null, sacados: [], quedan: [] }))).toBe('Listo: Figacita Envasada x9UN ahora se le compra a Marquisse S.A.');
  });

  it('lo que queda por el código del proveedor se explica distinto', () => {
    const m = mensajeReasignado(resultado({ sacados: [], quedan: [{ id: 'a', razonSocial: 'A', motivo: 'codigo' }, { id: 'b', razonSocial: 'B', motivo: 'alias' }] }));
    expect(m).toContain('Sigue en la lista de A y B porque tiene su código de proveedor');
  });
});

describe('reasignar', () => {
  it('lo hace la base, con la pantalla y el usuario, y Qué comprar lo toma enseguida', async () => {
    const { db, rpcs } = dbFalsa({ rpc: { data: resultado() } });
    const r = await new ProveedorDeProductoService(db).reasignar({ producto: P1, proveedorId: MARQUISSE, pantalla: 'stock' }, 'u-1');
    expect(rpcs).toEqual([{ nombre: 'reasignar_proveedor', args: { p_producto: P1, p_proveedor: MARQUISSE, p_usuario: 'u-1', p_pantalla: 'Stock' } }]);
    expect(invalidarAbastecimiento).toHaveBeenCalledTimes(1);
    expect(r.mensaje).toMatch(/^Listo: Figacita/);
    expect(r.sacados).toEqual([{ id: 'c', razonSocial: 'Crusto al Paso' }]);
  });

  it('desde una lista que solo trae el SKU, busca el producto', async () => {
    const { db, rpcs } = dbFalsa({ productos: [{ id: P1, sku: 'L10430' }], rpc: { data: resultado() } });
    await new ProveedorDeProductoService(db).reasignar({ producto: 'L10430', proveedorId: MARQUISSE, pantalla: 'pedido' }, 'u-1');
    expect(rpcs[0].args).toMatchObject({ p_producto: P1, p_pantalla: 'Armar pedido' });
  });

  it('si ya era de ese proveedor no invalida nada', async () => {
    const { db } = dbFalsa({ rpc: { data: resultado({ yaEstaba: true }) } });
    await new ProveedorDeProductoService(db).reasignar({ producto: P1, proveedorId: MARQUISSE }, 'u-1');
    expect(invalidarAbastecimiento).not.toHaveBeenCalled();
  });

  it('frena sin producto, sin proveedor o con un SKU que no existe, y pasa el error de la base', async () => {
    const s = new ProveedorDeProductoService(dbFalsa().db);
    await expect(s.reasignar({ proveedorId: MARQUISSE })).rejects.toThrow('Falta el producto');
    await expect(s.reasignar({ producto: P1, proveedorId: 'marquisse' })).rejects.toThrow('Elegí el proveedor');
    await expect(s.reasignar({ producto: 'NOEXISTE', proveedorId: MARQUISSE })).rejects.toThrow('No existe el producto NOEXISTE');
    const conError = new ProveedorDeProductoService(dbFalsa({ rpc: { error: { message: 'CLAUDIO RAMA está dado de baja: no se le puede asignar un producto' } } }).db);
    await expect(conError.reasignar({ producto: P1, proveedorId: MARQUISSE })).rejects.toThrow('dado de baja');
    expect(invalidarAbastecimiento).not.toHaveBeenCalled();
  });
});

describe('el proveedor de hoy de cada producto', () => {
  it('contesta con la misma clave con la que se pidió (id o SKU), y sin proveedor cuando no tiene', async () => {
    const { db } = dbFalsa({
      productos: [{ id: P1, sku: 'L10430', nombre: 'Figacita' }, { id: P2, sku: 'L9510', nombre: 'Brie' }],
      actual: [{ producto_id: P1, proveedor_id: MARQUISSE, razon_social: 'Marquisse S.A.', decidido: true }],
    });
    const r = await new ProveedorDeProductoService(db).actuales([P1, 'L9510']);
    expect(r[P1]).toEqual({ productoId: P1, sku: 'L10430', nombre: 'Figacita', proveedor: { id: MARQUISSE, razonSocial: 'Marquisse S.A.', decidido: true } });
    expect(r.L9510).toEqual({ productoId: P2, sku: 'L9510', nombre: 'Brie', proveedor: null });
    expect(Object.keys(r).sort()).toEqual([P1, 'L9510'].sort());
  });

  it('pide de a 500 a la base (PostgREST corta en 1.000 filas)', async () => {
    const productos = Array.from({ length: 1200 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, sku: `L${i}`, nombre: `P${i}` }));
    const { db, rpcs } = dbFalsa({ productos });
    await new ProveedorDeProductoService(db).actuales(productos.slice(0, 500).map((p) => p.sku));
    expect(rpcs.filter((x) => x.nombre === 'proveedor_actual').map((x) => x.args.p_ids.length)).toEqual([500]);
  });

  it('sin nada que buscar no va a la base', async () => {
    const { db } = dbFalsa();
    expect(await new ProveedorDeProductoService(db).actuales([])).toEqual({});
    expect(db.from).not.toHaveBeenCalled();
  });
});
