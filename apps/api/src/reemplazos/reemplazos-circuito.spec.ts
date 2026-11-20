// El circuito entero de «Tengo parecido» (20/11/2026) con una base en memoria y
// el WhatsApp simulado: consultar → el cliente pregunta otra cosa → sí → no →
// resumen al cliente y aviso a quien arma. De noche no sale nada.

const enviados: { to: string; sesion?: string | null; text?: string | null }[] = [];
jest.mock('../comun/whatsapp', () => ({
  celularWhatsapp: (n: string) => { const d = String(n ?? '').replace(/\D/g, ''); return d.length === 10 ? `549${d}` : d; },
  enviarWhatsapp: jest.fn(async (_db: any, e: any) => { enviados.push(e); return { enviado: true, id: `w${enviados.length}` }; }),
}));
jest.mock('../comun/lineas', () => ({
  hayWhatsapp: () => true,
  Lineas: class { async principal() { return 'pedidos'; } async sesion(l: string) { return l === 'local' ? 'odb-local' : 'odb'; } },
}));
const leidas: string[] = [];
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class { messages = { create: async (b: any) => { leidas.push(b.messages[0].content); return { content: [{ type: 'text', text: '{"respuesta":"otra"}' }] }; } }; },
}));

import { ReemplazosService } from './reemplazos.service';

type Fila = Record<string, any>;

/** Lo justo de supabase-js para el servicio: filtros, orden, update con select, upsert y rpc. */
function baseEnMemoria(tablas: Record<string, Fila[]>, rpcs: Record<string, (a: any) => any>) {
  let n = 0;
  const consulta = (tabla: string) => {
    const filtros: ((f: Fila) => boolean)[] = [];
    let accion: 'select' | 'update' | 'insert' | 'upsert' = 'select';
    let valores: any = null;
    let conSelect = false;
    let orden: { col: string; asc: boolean } | null = null;
    let tope: number | null = null;
    let una = false;
    const filas = () => (tablas[tabla] ??= []);
    const correr = () => {
      if (accion === 'insert') {
        const nuevas = (Array.isArray(valores) ? valores : [valores]).map((v) => ({ id: `id${++n}`, ...v }));
        filas().push(...nuevas);
        return { data: nuevas, error: null };
      }
      if (accion === 'upsert') {
        const v = valores;
        const ya = filas().find((f) => f.linea === v.linea && f.telefono === v.telefono);
        if (ya) Object.assign(ya, v); else filas().push({ ...v });
        return { data: null, error: null };
      }
      let r = filas().filter((f) => filtros.every((p) => p(f)));
      if (accion === 'update') { r.forEach((f) => Object.assign(f, valores)); if (!conSelect) return { data: null, error: null }; }
      if (orden) { const { col, asc } = orden; r = [...r].sort((a, b) => (a[col] ?? 0) > (b[col] ?? 0) ? (asc ? 1 : -1) : (a[col] ?? 0) < (b[col] ?? 0) ? (asc ? -1 : 1) : 0); }
      if (tope != null) r = r.slice(0, tope);
      const copia = r.map((f) => ({ ...f }));
      return { data: una ? copia[0] ?? null : copia, error: null };
    };
    const q: any = {
      select: () => { if (accion !== 'select') conSelect = true; return q; },
      update: (v: any) => { accion = 'update'; valores = v; return q; },
      insert: (v: any) => { accion = 'insert'; valores = v; return q; },
      upsert: (v: any) => { accion = 'upsert'; valores = v; return q; },
      eq: (c: string, v: any) => { filtros.push((f) => f[c] === v); return q; },
      neq: (c: string, v: any) => { filtros.push((f) => f[c] !== v); return q; },
      in: (c: string, v: any[]) => { filtros.push((f) => v.includes(f[c])); return q; },
      is: (c: string, v: any) => { filtros.push((f) => (f[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: any) => { filtros.push((f) => (f[c] ?? null) !== v); return q; },
      gte: (c: string, v: any) => { filtros.push((f) => f[c] >= v); return q; },
      order: (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return q; },
      limit: (k: number) => { tope = k; return q; },
      maybeSingle: () => { una = true; return Promise.resolve(correr()); },
      single: () => { una = true; return Promise.resolve(correr()); },
      then: (ok: any, mal: any) => Promise.resolve(correr()).then(ok, mal),
    };
    return q;
  };
  return {
    from: (t: string) => consulta(t),
    rpc: async (nombre: string, args: any) => ({ data: rpcs[nombre](args), error: null }),
  } as any;
}

const LID = '262598712885399';
function armar() {
  enviados.length = 0;
  leidas.length = 0;
  const tablas: Record<string, Fila[]> = {
    pedidos: [{ id: 'P1', estado: 'en_preparacion', qr_retiro: 'DOM-87B017B4EA14', contacto_nombre: null, contacto_telefono: '5491157239794', origen: 'charla',
      cliente: { nombre: 'Andrea Chagas', telefono: '1157239794' }, total: 30000, pagado_en: null, asignado_a: 'U-PABLO' }],
    bot_cotizaciones: [{ pedido_id: 'P1', telefono: LID, linea: 'pedidos', creada_en: '2026-11-19T17:00:00Z' }],
    usuarios: [{ id: 'U-PABLO', nombre: 'Pablo Avalos' }],
    pedidos_reemplazos: [],
    avisos_pedidos: [],
    bot_conversaciones: [{ linea: 'pedidos', telefono: LID, mensajes: [{ role: 'user', content: 'te paso el pedido' }, { role: 'assistant', content: 'Listo, confirmado' }] }],
  };
  let total = 30000;
  const rpcs = {
    proponer_reemplazo: (a: any) => {
      const nombres: Record<string, string> = { MANTECA: 'Manteca La Serenisima 200 gr', ADLER: 'Queso Adler Jamon x 100g', LS100: 'Manteca La Serenisima x 100 gr', HOLANDA: 'Queso Holanda x 100g' };
      const fila = { id: `R-${a.p_producto}`, pedido_id: a.p_pedido, producto_id: a.p_producto, nombre_falta: nombres[a.p_producto], pide: a.p_producto === 'ADLER' ? 4 : 1, hay: a.p_hay,
        reemplazo_id: a.p_reemplazo, nombre_reemplazo: nombres[a.p_reemplazo], cantidad: a.p_cantidad ?? 1, precio: 3000, estado: 'propuesto', creado_en: `2026-11-20T12:0${tablas.pedidos_reemplazos.length}:00Z`,
        consultado_en: null, cerrado_en: null, intentos: 0 };
      tablas.pedidos_reemplazos.push(fila);
      return { id: fila.id };
    },
    decidir_reemplazo: (a: any) => {
      const f = tablas.pedidos_reemplazos.find((x) => x.id === a.p_id)!;
      if (!['propuesto', 'en_cola', 'preguntado'].includes(f.estado)) return { estado: f.estado, yaEstaba: true };
      const antes = total;
      total = a.p_acepta ? total + 3000 : total - 3900;
      Object.assign(f, { estado: a.p_acepta ? 'aceptado' : 'rechazado', respondido_en: new Date().toISOString(), respuesta: a.p_respuesta, decidido_por: a.p_usuario, resultado: { totalAntes: antes, total } });
      tablas.pedidos[0].total = total;
      return { estado: f.estado, resultado: f.resultado, error: null };
    },
  };
  const db = baseEnMemoria(tablas, rpcs);
  const s = new ReemplazosService(db);
  const responde: string[] = [];
  s.registrarEnResponde = async (waId, cli, bot) => { responde.push(`${waId}|${cli}|${bot ?? ''}`); };
  return { s, tablas, responde };
}

describe('consultar al cliente los cambios', () => {
  const antes = process.env.ODB_AVISOS_PEDIDOS;
  beforeEach(() => { process.env.ODB_AVISOS_PEDIDOS = '1'; jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-11-20T12:00:00-03:00')); });
  afterEach(() => { process.env.ODB_AVISOS_PEDIDOS = antes; jest.useRealTimers(); });

  it('de a uno, por el mismo chat; otra cosa no decide; sí, no y el cierre', async () => {
    const { s, tablas, responde } = armar();
    await s.proponer('P1', { productoId: 'MANTECA', hay: 0, reemplazoId: 'LS100', cantidad: 2 }, 'U-PABLO');
    await s.proponer('P1', { productoId: 'ADLER', hay: 1, reemplazoId: 'HOLANDA', cantidad: 3 }, 'U-PABLO');

    const r = await s.consultar('P1', 'U-PABLO');
    expect(r).toMatchObject({ ok: true, cambios: 2, enviado: true });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ to: `${LID}@lid`, sesion: 'odb' });
    expect(enviados[0].text).toContain('Hola Andrea, te escribimos de ODB por tu pedido DOM-87B017B4EA14. Nos faltan 2 productos');
    expect(enviados[0].text).toContain('(1 de 2) *Manteca La Serenisima 200 gr* no hay. En su lugar va *2 × Manteca La Serenisima x 100 gr* ($6.000).');
    expect(tablas.pedidos_reemplazos.map((f) => f.estado)).toEqual(['preguntado', 'en_cola']);

    // un «sí» escrito antes de que saliera la pregunta no la contesta
    expect(await s.respuestaDelCliente({ linea: 'pedidos', clave: LID, candidatos: [], texto: 'si', escritoEn: Date.now() - 60_000 })).toBeNull();
    // otro chat: no es la respuesta
    expect(await s.respuestaDelCliente({ linea: 'pedidos', clave: '999999999999999', candidatos: ['1199998888'], texto: 'si' })).toBeNull();
    // la otra línea tampoco
    expect(await s.respuestaDelCliente({ linea: 'local', clave: LID, candidatos: [], texto: 'si' })).toBeNull();

    // pregunta algo: no decide, lo atiende el bot y queda para quien arma
    const otra = await s.respuestaDelCliente({ linea: 'pedidos', clave: LID, candidatos: [], texto: '¿y es igual de rica?' });
    expect(otra).toMatchObject({ otra: true });
    expect(leidas).toHaveLength(1);
    expect(tablas.pedidos_reemplazos[0]).toMatchObject({ estado: 'preguntado', otra_respuesta: '¿y es igual de rica?' });
    expect(enviados).toHaveLength(1);

    // SÍ (por su teléfono, aunque escriba desde el @lid ya aprendido): entra y sale la segunda
    const si = await s.respuestaDelCliente({ linea: 'pedidos', clave: '111', candidatos: ['1157239794'], texto: 'Siii dale gracias' });
    expect(si).toMatchObject({ respondido: true, acepta: true });
    expect(tablas.pedidos_reemplazos.map((f) => f.estado)).toEqual(['aceptado', 'preguntado']);
    expect(enviados).toHaveLength(2);
    expect(enviados[1].text!.startsWith('Anotado ✔\n\n(2 de 2) De *Queso Adler Jamon x 100g* pediste 4 y hay 1. Por las que faltan va *3 × Queso Holanda x 100g* ($9.000).')).toBe(true);

    // NO: sale, y como era la última, el resumen al cliente y el aviso a quien arma
    const no = await s.respuestaDelCliente({ linea: 'pedidos', clave: LID, candidatos: [], texto: 'no gracias' });
    expect(no).toMatchObject({ respondido: true, acepta: false });
    expect(enviados).toHaveLength(3);
    expect(enviados[2].text).toBe('Anotado ✔ ¡Gracias, Andrea! Tu pedido DOM-87B017B4EA14 queda así:\n✔ 2 × Manteca La Serenisima x 100 gr (en lugar de Manteca La Serenisima 200 gr)\n✖ Queso Adler Jamon x 100g: va solo 1\nTotal: $29.100.');
    expect(tablas.pedidos_reemplazos.every((f) => f.cerrado_en)).toBe(true);
    expect(tablas.avisos_pedidos).toHaveLength(1);
    expect(tablas.avisos_pedidos[0]).toMatchObject({ pedido_id: 'P1', tipo: 'cambios_respondidos', detalle: { usuario_id: 'U-PABLO', nombre: 'Pablo Avalos' } });
    expect(tablas.avisos_pedidos[0].detalle.texto.split('\n').slice(0, 5)).toEqual([
      'CAMBIOS CONFIRMADOS · DOM-87B017B4EA14',
      'Andrea Chagas contestó:',
      '✔ SÍ: 2 × Manteca La Serenisima x 100 gr (por Manteca La Serenisima 200 gr)',
      '✖ NO: Queso Adler Jamon x 100g: va solo 1 (lo que hay)',
      'Total ahora: $29.100 (antes $30.000).',
    ]);

    // la charla del bot sabe qué se le preguntó y qué contestó (sin dos del mismo lado seguidos)
    const hilo = tablas.bot_conversaciones[0].mensajes.map((m: any) => m.role);
    expect(hilo).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(responde).toHaveLength(5);
    expect(responde[1]).toBe(`${LID}@lid|Siii dale gracias|`);

    // otra vuelta de la cola no repite nada
    await s.vuelta();
    expect(enviados).toHaveLength(3);
  });

  it('de noche queda en cola y sale a las 8', async () => {
    jest.setSystemTime(new Date('2026-11-20T23:10:00-03:00'));
    const { s, tablas } = armar();
    await s.proponer('P1', { productoId: 'MANTECA', hay: 0, reemplazoId: 'LS100', cantidad: 2 }, 'U-PABLO');
    const r = await s.consultar('P1', 'U-PABLO');
    expect(r).toMatchObject({ enviado: false, motivo: 'Son más de las 22: le sale a las 8.' });
    expect(enviados).toHaveLength(0);
    expect(tablas.pedidos_reemplazos[0].estado).toBe('en_cola');
    await s.vuelta();
    expect(enviados).toHaveLength(0);
    jest.setSystemTime(new Date('2026-11-21T08:00:30-03:00'));
    await s.vuelta();
    expect(enviados).toHaveLength(1);
    expect(tablas.pedidos_reemplazos[0].estado).toBe('preguntado');
  });

  it('lo que anota quien arma sin haber consultado no le manda nada al cliente', async () => {
    const { s, tablas } = armar();
    await s.proponer('P1', { productoId: 'MANTECA', hay: 0, reemplazoId: 'LS100', cantidad: 2 }, 'U-PABLO');
    const r = await s.decidir('R-MANTECA', true, { usuarioId: 'U-PABLO', pedidoId: 'P1' });
    expect(r).toMatchObject({ estado: 'aceptado', siguiente: null });
    expect(enviados).toHaveLength(0);
    expect(tablas.avisos_pedidos).toHaveLength(0);
  });

  it('sin WhatsApp del cliente, avisa que lo llame', async () => {
    const { s, tablas } = armar();
    tablas.bot_cotizaciones.length = 0;
    tablas.pedidos[0].cliente = { nombre: 'Juan', telefono: null };
    tablas.pedidos[0].contacto_telefono = null;
    await s.proponer('P1', { productoId: 'MANTECA', hay: 0, reemplazoId: 'LS100', cantidad: 2 }, 'U-PABLO');
    await expect(s.consultar('P1', 'U-PABLO')).rejects.toThrow('No tengo el WhatsApp del cliente');
    expect(tablas.pedidos_reemplazos[0].estado).toBe('propuesto');
  });
});
