// El Analista ODB sobre el motor de abastecimiento (2/10/2026). Antes calculaba
// el ritmo solo con la caja de ODB y decía "no hay nada que comprar".
const crear = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create: crear } })) }));

import { AnalistaService } from './analista.service';
import { invalidarAbastecimiento, leerAbastecimiento, olvidarLecturas } from '../abastecimiento/motor';

process.env.ANTHROPIC_API_KEY ??= 'test';

const fila = (i: number, x: any = {}) => ({
  producto_id: `p${i}`, sku: `L${i}`, nombre: `Producto ${i}`, sucursal_id: 'st', sucursal: 'Suc Sant Thomas',
  stock: 0, en_camino: 0, ritmo_dia: 2, ritmo_fuente: 'sistema viejo', ritmo_hasta: '2026-07-21', cobertura_dias: 0,
  proveedor_id: 'pv1', proveedor: 'LUVIK S.A.', proveedor_faltan: [], plazo_dias: 7, plazo_fuente: 'sin confirmar: 7 días por defecto',
  alerta: 'sin_stock', urgencia: 1000 - i, cantidad_sugerida: 10, ultimo_costo: 1000, ...x,
});

function dbFalsa(filas: any[], tablas: Record<string, any[]> = {}) {
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
    from(tabla: string) {
      const b: any = {
        select: () => b, eq: () => b, gt: () => b, gte: () => b, order: () => b, limit: () => b,
        range: (d: number, h: number) => Promise.resolve({ data: (tablas[tabla] ?? []).slice(d, h + 1), error: null }),
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

  it('invalidar después de crear una orden hace que la próxima lectura vaya a la base', async () => {
    const db = dbFalsa([fila(1)]);
    await leerAbastecimiento(db);
    invalidarAbastecimiento();
    await leerAbastecimiento(db);
    expect(db.llamadas.length).toBe(2);
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

  // 6/10/2026: el reintento SIN razonamiento iba contra la regla del 9/9 y en
  // Opus 5.5 apagarlo es otro 400. Ahora no se reintenta: salen las cifras con el
  // veredicto de respaldo
  it('si la API rechaza el pedido (400), no reintenta sin razonamiento: las cifras salen con el veredicto de respaldo', async () => {
    const db = dbFalsa([fila(1)]);
    crear.mockRejectedValueOnce(Object.assign(new Error('invalid'), { status: 400 }));
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro?' }]);
    expect(crear).toHaveBeenCalledTimes(1);
    expect(r.respuesta).toMatch(/No llegué a escribir el análisis/);
    expect(r.tablero.compras.proveedores).toHaveLength(1);
  });

  it('va a Opus 5.5 con razonamiento, esfuerzo explícito y lugar para pensar', async () => {
    const db = dbFalsa([fila(1)]);
    crear.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ respuesta: 'Pedí a Luvik.', mostrar: ['compras'], proveedores: [] }) }] });
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro?' }]);
    expect(r.respuesta).toBe('Pedí a Luvik.');
    const pedido = crear.mock.calls[0][0];
    expect(pedido.model).toBe('claude-opus-5-5');
    expect(pedido.thinking).toEqual({ type: 'adaptive' });
    expect(pedido.output_config.effort).toBe('medium');
    expect(pedido.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it('si el modelo se corta, las cifras igual salen con un veredicto de respaldo', async () => {
    const db = dbFalsa([fila(1)]);
    crear.mockResolvedValue({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"respuesta":"Lo urg' }] });
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro?' }]);
    expect(r.respuesta).toMatch(/No llegué a escribir el análisis/);
    expect(r.tablero.compras.proveedores).toHaveLength(1);
  });

  it('los aumentos de costo se leen enteros (más de 1.000 filas) y solo los reales', async () => {
    const hoy = new Date().toISOString();
    const viejo = new Date(Date.now() - 100 * 86400_000).toISOString();
    const historial = [
      ...Array.from({ length: 1200 }, (_, i) => ({ id: i, costo: 100, creado_en: viejo, producto_id: `x${i}`, proveedor_id: 'pv', producto: { sku: `X${i}`, nombre: 'Relleno' } })),
      { id: 5000, costo: 1000, creado_en: viejo, producto_id: 'malbec', proveedor_id: 'pv', producto: { sku: 'L9', nombre: 'Malbec' }, proveedor: { razon_social: 'Cepas' } },
      { id: 5001, costo: 1000, creado_en: hoy, producto_id: 'malbec2', proveedor_id: 'pv', producto: { sku: 'L8', nombre: 'Sin cambio' } },
      { id: 5002, costo: 1200, creado_en: hoy, producto_id: 'malbec', proveedor_id: 'pv', producto: { sku: 'L9', nombre: 'Malbec' }, proveedor: { razon_social: 'Cepas' } },
    ];
    const db = dbFalsa([fila(1)], { costos_historial: historial });
    crear.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ respuesta: 'ok', mostrar: ['compras'], proveedores: [] }) }] });
    await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Hubo aumentos?' }]);
    const foto = crear.mock.calls[0][0].system[1].text;
    expect(foto).toContain('L9 Malbec: +20%');
    expect(foto).not.toContain('Sin cambio');
  });

  it('sin ventas cargadas nunca dice que no hay nada que comprar', async () => {
    const db = dbFalsa([fila(1, { ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, stock: 3 })]);
    responder({ respuesta: 'Esta semana no hay nada que comprar. Revise la plata parada.', mostrar: ['parado'], proveedores: [] });
    const r: any = await new AnalistaService(db).charlar([{ rol: 'usuario', texto: '¿Qué compro?' }]);
    expect(r.respuesta).toMatch(/^No tengo ventas cargadas/);
    expect(r.respuesta).not.toMatch(/nada que comprar/i);
  });
});
