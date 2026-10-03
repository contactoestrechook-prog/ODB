// El Analista ODB sobre el motor de abastecimiento (2/10/2026). Antes calculaba
// el ritmo solo con la caja de ODB y decía "no hay nada que comprar".
const crear = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create: crear } })) }));

import { AnalistaService } from './analista.service';
import { olvidarLecturas } from '../abastecimiento/motor';

process.env.ANTHROPIC_API_KEY ??= 'test';

const fila = (i: number, x: any = {}) => ({
  producto_id: `p${i}`, sku: `L${i}`, nombre: `Producto ${i}`, sucursal_id: 'st', sucursal: 'Suc Sant Thomas',
  stock: 0, en_camino: 0, ritmo_dia: 2, ritmo_fuente: 'sistema viejo', ritmo_hasta: '2026-07-21', cobertura_dias: 0,
  proveedor_id: 'pv1', proveedor: 'LUVIK S.A.', proveedor_faltan: [], plazo_dias: 7, plazo_fuente: 'sin confirmar: 7 días por defecto',
  alerta: 'sin_stock', urgencia: 1000 - i, cantidad_sugerida: 10, ultimo_costo: 1000, ...x,
});

function dbFalsa(filas: any[]) {
  const llamadas: any[] = [];
  const db: any = {
    llamadas,
    rpc: jest.fn((nombre: string, args: any) => {
      if (nombre === 'abastecimiento') {
        const b: any = {
          range: (d: number, h: number) => { llamadas.push({ args, d, h }); return Promise.resolve({ data: filas.slice(d, h + 1), error: null }); },
        };
        return b;
      }
      return Promise.resolve({ data: [], error: null }); // catalogo_precios
    }),
    from() {
      const b: any = {
        select: () => b, eq: () => b, gt: () => b, gte: () => b, order: () => b, limit: () => b,
        range: () => Promise.resolve({ data: [], error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err),
      };
      return b;
    },
  };
  return db;
}

beforeEach(() => { olvidarLecturas(); crear.mockReset(); });

describe('metricas() sobre el motor de abastecimiento', () => {
  it('lee TODAS las filas en páginas, con p_limite alto y sin filtrar alertas', async () => {
    const filas = Array.from({ length: 2500 }, (_, i) => fila(i));
    const db = dbFalsa(filas);
    const r = await new AnalistaService(db).metricas();
    expect(r).toHaveLength(2500);
    expect(db.llamadas[0].args).toMatchObject({ p_solo_alertas: false, p_limite: 20000 });
    expect(db.llamadas.length).toBe(3);
  });

  it('mapea los estados y deja la sucursal cruda', async () => {
    const db = dbFalsa([
      fila(1),
      fila(2, { alerta: 'menos_de_12', ritmo_dia: 0, cantidad_sugerida: 12 }),
      fila(3, { alerta: null, cantidad_sugerida: 0, stock: 5, ritmo_dia: 0 }),
      fila(4, { alerta: null, cantidad_sugerida: 0, stock: 200, ritmo_dia: 1, cobertura_dias: 200 }),
    ]);
    const r = await new AnalistaService(db).metricas();
    const por = new Map(r.map((f) => [f.sku, f]));
    expect(por.get('L1')).toMatchObject({ estado: 'quiebre_inminente', sucursal: 'Suc Sant Thomas', sugerido: 10, ventasDia30: 2 });
    expect(por.get('L2')?.estado).toBe('reponer');
    expect(por.get('L3')?.estado).toBe('muerto');
    expect(por.get('L4')?.estado).toBe('sobrestock');
  });

  it('dos lecturas seguidas (aunque sean de instancias distintas) van a la base una sola vez', async () => {
    const db = dbFalsa([fila(1)]);
    await new AnalistaService(db).metricas();
    await new AnalistaService(db).metricas();
    expect(db.llamadas.length).toBe(1);
  });

  it('si el motor llega a su tope (20.000), avisa en vez de analizar a medias', async () => {
    const db = dbFalsa(Array.from({ length: 20000 }, (_, i) => fila(i)));
    await expect(new AnalistaService(db).metricas()).rejects.toThrow(/tope/);
  });
});

describe('charlar(): veredicto del modelo + cifras del sistema, por proveedor', () => {
  const responder = (salida: any) => crear.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(salida) }] });

  it('devuelve el tablero por proveedor y resuelve los nombres del modelo', async () => {
    const db = dbFalsa([fila(1), fila(2, { proveedor_id: 'pv2', proveedor: 'Codorníu', alerta: 'menos_de_12' })]);
    responder({
      respuesta: 'Lo urgente es Luvik: pedí hoy.',
      mostrar: ['compras', 'notas'],
      proveedores: [
        { proveedor: 'P01', accion: 'comprar', comentario: 'Sin stock de lo que más se vende.' },
        { proveedor: 'P99', accion: 'comprar', comentario: 'x' }, // no existe: se descarta
        { proveedor: 'SIN_PROVEEDOR', accion: 'completar_datos', comentario: 'Asignalos.' },
      ],
    });
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro esta semana?' }]);
    expect(r.respuesta).toBe('Lo urgente es Luvik: pedí hoy.');
    expect(r.mostrar).toEqual(['compras', 'notas']);
    expect(r.tablero.compras.proveedores.map((p: any) => p.proveedor)).toEqual(['LUVIK S.A.', 'Codorníu']);
    expect(r.tablero.compras.proveedores[0].top3).toBeUndefined(); // eso es solo para el modelo
    expect(r.comentarios).toEqual([
      { proveedorId: 'pv1', proveedor: 'LUVIK S.A.', accion: 'comprar', comentario: 'Sin stock de lo que más se vende.' },
      { proveedorId: null, proveedor: 'Sin proveedor habitual', accion: 'completar_datos', comentario: 'Asignalos.' },
    ]);
    expect(r.notas).toEqual({ sucursal: 'Saint Thomas', proveedorIds: ['pv1'] });
    // al modelo no le viajan miles de filas: lo fijo con caché y la foto del día aparte
    const pedido = crear.mock.calls[0][0];
    expect(pedido.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(pedido.system[1].text).toContain('LUVIK S.A.');
    expect(pedido.thinking).toEqual({ type: 'adaptive' });
    // el modelo responde con las claves de ESTA foto, no con nombres
    expect(pedido.output_config.format.schema.properties.proveedores.items.properties.proveedor.enum).toEqual(['P01', 'P02', 'SIN_PROVEEDOR']);
    expect(pedido.system[1].text).toContain('[P01] LUVIK S.A.');
  });

  it('sin ventas cargadas nunca dice que no hay nada que comprar', async () => {
    const db = dbFalsa([fila(1, { ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, stock: 3 })]);
    responder({ respuesta: 'Esta semana no hay nada que comprar. Revise la plata parada.', mostrar: ['parado'], proveedores: [] });
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro?' }]);
    expect(r.respuesta).toMatch(/^No tengo ventas cargadas/);
    expect(r.respuesta).not.toMatch(/nada que comprar/i);
  });
});
