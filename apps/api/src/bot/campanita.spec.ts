import { BotService } from './bot.service';
import { NovedadesController } from '../novedades/novedades.controller';

// La campanita (1/10/2026): tenía 1.673 avisos sin leer, 1.260 de ellos
// "Consulta pendiente de atención" — uno nuevo cada 6 h por cada consulta que
// nadie cerraba citando el WhatsApp (hasta 39 por consulta). Estas pruebas fijan
// la regla nueva: un aviso al preguntar, UN recordatorio, y se cierran solos.

process.env.ANTHROPIC_API_KEY ??= 'test';

type Llamada = { tabla: string; op: string; fila?: any; filtros: any[] };

function dbFalsa(porTabla: Record<string, any> = {}) {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    rpc: jest.fn(async () => ({ data: [], error: null })),
    from(tabla: string) {
      const res = porTabla[tabla] ?? { data: null, error: null };
      const l: Llamada = { tabla, op: 'select', filtros: [] };
      const f = (nombre: string) => (...args: any[]) => (l.filtros.push([nombre, ...args]), b);
      const b: any = {
        select: () => b, range: () => b, order: () => b, limit: () => b,
        eq: f('eq'), is: f('is'), or: f('or'), filter: f('filter'), gte: f('gte'),
        insert: (fila: any) => (Object.assign(l, { op: 'insert', fila }), llamadas.push(l), b),
        update: (fila: any) => (Object.assign(l, { op: 'update', fila }), llamadas.push(l), b),
        maybeSingle: async () => res,
        then: (ok: any, err: any) => Promise.resolve(typeof res === 'function' ? res(l) : res).then(ok, err),
      };
      return b;
    },
  } as any;
}

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const consulta = (extra: any = {}) => ({
  id: 'c1', linea: 'pedidos', telefono_cliente: '5491133344455', area: 'local', consulta: '¿Hay pan integral?',
  gestion_version: 2, enviado_a: '5491125213601', creado_en: hace(30), aviso_recordatorio_en: null, ...extra,
});

describe('campanita: avisos de consultas del bot', () => {
  const recordatorios = (db: any) => db.llamadas.filter((x: Llamada) => x.tabla === 'alertas_internas' && x.op === 'insert');

  it('una consulta sin respuesta deja UN recordatorio, tomado con update condicional', async () => {
    const db = dbFalsa({
      lineas_whatsapp: { data: { bot_activo: true, derivar_pagos_a: '5491125213601' }, error: null },
      bot_consultas_internas: { data: [consulta()], error: null },
    });
    const s = new BotService(db, {} as any, {} as any, {} as any, {} as any);
    await s.seguirConsultasPendientes();
    expect(recordatorios(db)).toHaveLength(1);
    expect(recordatorios(db)[0].fila.referencia).toMatchObject({ consulta_id: 'c1', recordatorio: true });
    const toma = db.llamadas.find((x: Llamada) => x.tabla === 'bot_consultas_internas' && x.op === 'update');
    expect(toma.filtros).toContainEqual(['is', 'aviso_recordatorio_en', null]);
  });

  it('ya recordada, no vuelve a avisar nunca (antes: cada 6 h para siempre)', async () => {
    const db = dbFalsa({
      lineas_whatsapp: { data: { bot_activo: true }, error: null },
      bot_consultas_internas: { data: [consulta({ creado_en: hace(60 * 24 * 9), aviso_recordatorio_en: hace(60 * 24 * 8) })], error: null },
    });
    await new BotService(db, {} as any, {} as any, {} as any, {} as any).seguirConsultasPendientes();
    expect(recordatorios(db)).toHaveLength(0);
  });

  it('si otro proceso ya la tomó, no se duplica el aviso', async () => {
    const db = dbFalsa({
      lineas_whatsapp: { data: { bot_activo: true }, error: null },
      // la lectura trae la consulta, pero el update condicional no toma ninguna fila
      bot_consultas_internas: (l: Llamada) => ({ data: l.op === 'update' ? [] : [consulta()], error: null }),
    });
    await new BotService(db, {} as any, {} as any, {} as any, {} as any).seguirConsultasPendientes();
    expect(recordatorios(db)).toHaveLength(0);
  });

  it('las 50 viejas ya recordadas no tapan a una nueva', async () => {
    const viejas = Array.from({ length: 60 }, (_, i) => consulta({ id: `v${i}`, creado_en: hace(60 * 24 * 5), aviso_recordatorio_en: hace(60 * 24 * 4) }));
    const db = dbFalsa({
      lineas_whatsapp: { data: { bot_activo: true }, error: null },
      bot_consultas_internas: { data: [consulta({ id: 'nueva' }), ...viejas], error: null },
    });
    await new BotService(db, {} as any, {} as any, {} as any, {} as any).seguirConsultasPendientes();
    expect(recordatorios(db).map((x: Llamada) => x.fila.referencia.consulta_id)).toEqual(['nueva']);
  });

  it('el aviso del momento lleva el id de la consulta, y el banco de pruebas no avisa', async () => {
    const db = dbFalsa({
      lineas_whatsapp: { data: { derivar_pagos_a: '5491125213601', avisar_proveedores_a: 'jaqui' }, error: null },
      bot_consultas_internas: { data: { id: 'c9' }, error: null },
    });
    const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
    s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W1' }));
    s.identificarCliente = jest.fn(async () => ({ nombre: 'Laura' }));
    await s.consultarInterno('pedidos', '5491133344455', 'local', '¿Hay pan integral?');
    expect(recordatorios(db)[0].fila.referencia.consulta_id).toBe('c9');

    const banco = dbFalsa({ lineas_whatsapp: { data: {}, error: null }, bot_consultas_internas: { data: { id: 'p1' }, error: null } });
    const sb: any = new BotService(banco, {} as any, {} as any, {} as any, {} as any);
    sb.identificarCliente = jest.fn(async () => null);
    await sb.consultarInterno('pedidos', '549110000001', 'local', 'prueba');
    expect(recordatorios(banco)).toHaveLength(0);
  });
});

describe('campanita: "Listo"', () => {
  it('en un aviso de consulta despeja también el otro aviso de esa consulta', async () => {
    const db = dbFalsa({ alertas_internas: { data: [{ tipo: 'consulta', referencia: { consulta_id: 'c1' } }], error: null } });
    await new NovedadesController(db).alertaLeida('a1', { usuario: { sub: 'u1' } });
    const updates = db.llamadas.filter((x: Llamada) => x.op === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].filtros).toContainEqual(['filter', 'referencia->>consulta_id', 'eq', 'c1']);
  });

  it('en cualquier otro aviso marca solo ese', async () => {
    const db = dbFalsa({ alertas_internas: { data: [{ tipo: 'pago', referencia: { telefono: '1' } }], error: null } });
    await new NovedadesController(db).alertaLeida('a1', { usuario: { sub: 'u1' } });
    expect(db.llamadas.filter((x: Llamada) => x.op === 'update')).toHaveLength(1);
  });
});
