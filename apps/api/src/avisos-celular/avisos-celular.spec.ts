import { AvisosCelularService } from './avisos-celular.service';
import { avisoDe, resumenDeNoche, sinEmoji, urlDe } from './aviso-celular';

// Avisos al celular (6/11/2026). Fijan: sale solo lo de la lista, una sola vez
// (se marca antes de mandar), a quien lo ve en la campanita, y el aparato que el
// navegador da por muerto (404/410) se borra.

type Llamada = { tabla: string; op: string; fila?: any; filtros: any[] };

function dbFalsa(porTabla: Record<string, any> = {}) {
  const llamadas: Llamada[] = [];
  const consultas: Llamada[] = [];
  return {
    llamadas,
    consultas,
    rpc: jest.fn(async (fn: string) => (fn === 'celular_claves' ? { data: [{ publica: 'PUB', privada: 'PRIV' }], error: null } : { data: true, error: null })),
    from(tabla: string) {
      const res = porTabla[tabla] ?? { data: null, error: null };
      const l: Llamada = { tabla, op: 'select', filtros: [] };
      consultas.push(l);
      const f = (nombre: string) => (...args: any[]) => (l.filtros.push([nombre, ...args]), b);
      const b: any = {
        select: () => b, order: () => b, limit: () => b,
        eq: f('eq'), is: f('is'), in: f('in'), gte: f('gte'),
        insert: (fila: any) => (Object.assign(l, { op: 'insert', fila }), llamadas.push(l), b),
        update: (fila: any) => (Object.assign(l, { op: 'update', fila }), llamadas.push(l), b),
        upsert: (fila: any) => (Object.assign(l, { op: 'upsert', fila }), llamadas.push(l), b),
        delete: () => (Object.assign(l, { op: 'delete' }), llamadas.push(l), b),
        maybeSingle: async () => (typeof res === 'function' ? res(l) : res),
        then: (ok: any, err: any) => Promise.resolve(typeof res === 'function' ? res(l) : res).then(ok, err),
      };
      return b;
    },
  } as any;
}

const CONFIG = { data: { valor: { activo: true, tipos: ['pago', 'pedido_sin_tomar', 'proveedor_incompleto'] } }, error: null };
const alerta = (extra: any = {}) => ({
  id: 'a1', para_usuario: null, tipo: 'pago', titulo: 'Comprobante de $148.795 de Antonio', detalle: 'Transferencia', referencia: { telefono: '549' },
  leida_en: null, celular_en: null, ...extra,
});
const SUB_JP = { id: 7, usuario_id: 'jp', endpoint: 'https://fcm.googleapis.com/fcm/send/jp', p256dh: 'k', auth: 'a', fallos: 0 };

function servicio(db: any) {
  const s = new AvisosCelularService(db);
  const enviados: any[] = [];
  s.enviarUno = jest.fn(async (sub: any, cuerpo: string) => { enviados.push({ endpoint: sub.endpoint, ...JSON.parse(cuerpo) }); });
  return { s, enviados };
}

describe('avisos al celular: qué sale', () => {
  it('un aviso general de la lista sale a los dueños y gerentes con aparato, marcado antes de mandar', async () => {
    const db = dbFalsa({
      configuracion: CONFIG,
      alertas_internas: (l: Llamada) => ({ data: l.op === 'update' ? [{ id: 'a1' }] : alerta(), error: null }),
      usuarios: { data: [{ id: 'jp' }, { id: 'meli' }], error: null },
      push_suscripciones: (l: Llamada) => ({ data: l.op === 'select' ? [SUB_JP] : null, error: null }),
    });
    const { s, enviados } = servicio(db);
    const r = await s.enviarAlerta('a1');
    expect(r).toMatchObject({ enviados: 1, aparatos: 1 });
    expect(enviados[0]).toMatchObject({ titulo: 'Comprobante de $148.795 de Antonio', url: '/clientes', tag: 'alerta-a1' });
    // la marca va con «celular_en is null» (si la base llama dos veces, sale una)
    const marca = db.llamadas.find((x: Llamada) => x.tabla === 'alertas_internas' && x.op === 'update');
    expect(marca.filtros).toContainEqual(['is', 'celular_en', null]);
    // general → dueños y gerentes activos (lo mismo que ven en la campanita)
    const quienes = db.consultas.find((x: Llamada) => x.tabla === 'usuarios');
    expect(quienes.filtros).toEqual([['eq', 'activo', true], ['in', 'rol', ['dueno', 'gerente']]]);
  });

  it('si la marca no toma la fila (ya salió), no se manda de nuevo', async () => {
    const db = dbFalsa({
      configuracion: CONFIG,
      alertas_internas: (l: Llamada) => ({ data: l.op === 'update' ? [] : alerta(), error: null }),
      usuarios: { data: [{ id: 'jp' }], error: null },
      push_suscripciones: { data: [SUB_JP], error: null },
    });
    const { s, enviados } = servicio(db);
    expect(await s.enviarAlerta('a1')).toEqual({ salteado: 'ya salió' });
    expect(enviados).toHaveLength(0);
  });

  it.each([
    ['un tipo que no está en la lista', { tipo: 'consulta' }],
    ['uno que ya se cerró', { leida_en: '2026-11-06T12:00:00Z' }],
    ['uno que ya salió', { celular_en: '2026-11-06T12:00:00Z' }],
  ])('no manda %s', async (_, extra) => {
    const db = dbFalsa({ configuracion: CONFIG, alertas_internas: { data: alerta(extra), error: null } });
    const { s, enviados } = servicio(db);
    expect(await s.enviarAlerta('a1')).toEqual({ salteado: true });
    expect(enviados).toHaveLength(0);
    expect(db.llamadas.filter((x: Llamada) => x.op === 'update')).toHaveLength(0);
  });

  it('con los avisos apagados en la configuración no sale nada', async () => {
    const db = dbFalsa({ configuracion: { data: { valor: { activo: false, tipos: ['pago'] } }, error: null }, alertas_internas: { data: alerta(), error: null } });
    const { s, enviados } = servicio(db);
    expect(await s.enviarAlerta('a1')).toEqual({ salteado: 'apagado' });
    expect(enviados).toHaveLength(0);
  });

  it('un aviso con destinatario va solo a esa persona', async () => {
    const db = dbFalsa({ usuarios: { data: [{ id: 'ana' }], error: null } });
    const { s } = servicio(db);
    expect(await s.destinatarios('ana')).toEqual(['ana']);
    expect(db.consultas[0].filtros).toEqual([['eq', 'activo', true], ['eq', 'id', 'ana']]);
  });
});

describe('avisos al celular: los aparatos', () => {
  it('404 o 410 borra el aparato; otro error suma un fallo; el que sale queda con su último aviso', async () => {
    const subs = [
      { ...SUB_JP, id: 1, endpoint: 'https://a/ok' },
      { ...SUB_JP, id: 2, endpoint: 'https://a/muerto' },
      { ...SUB_JP, id: 3, endpoint: 'https://a/caido', fallos: 2 },
    ];
    const db = dbFalsa({ push_suscripciones: (l: Llamada) => ({ data: l.op === 'select' ? subs : null, error: null }) });
    const s = new AvisosCelularService(db);
    s.enviarUno = jest.fn(async (sub: any) => {
      if (sub.endpoint.endsWith('muerto')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('caido')) throw Object.assign(new Error('Server'), { statusCode: 500 });
    });
    expect(await s.enviarAvisos(['jp'], { titulo: 'x' })).toEqual({ enviados: 1, aparatos: 3 });
    const ops = db.llamadas.filter((x: Llamada) => x.tabla === 'push_suscripciones' && x.op !== 'select');
    expect(ops.find((x: Llamada) => x.op === 'delete').filtros).toContainEqual(['eq', 'id', 2]);
    expect(ops.find((x: Llamada) => x.op === 'update' && x.fila.fallos === 3).filtros).toContainEqual(['eq', 'id', 3]);
    expect(ops.find((x: Llamada) => x.op === 'update' && x.fila.ultimo_ok_en).filtros).toContainEqual(['eq', 'id', 1]);
  });

  it('cada uno quita solo sus aparatos', async () => {
    const db = dbFalsa();
    await new AvisosCelularService(db).quitar('jp', { id: 9 });
    expect(db.llamadas[0]).toMatchObject({ op: 'delete', filtros: [['eq', 'usuario_id', 'jp'], ['eq', 'id', 9]] });
  });

  it('no guarda un aparato sin los datos del navegador', async () => {
    const s = new AvisosCelularService(dbFalsa());
    await expect(s.suscribir('jp', { endpoint: 'http://x', keys: {} })).rejects.toThrow('El navegador no mandó');
  });
});

describe('avisos al celular: lo de la noche sale a las 8, uno por persona', () => {
  it('junta lo de cada persona en un solo aviso y marca todo', async () => {
    const noche = [
      alerta({ id: 'n1', titulo: '🔴 Pedido sin tomar: DOM-1', tipo: 'pedido_sin_tomar', referencia: { link: '/pedidos?pedido=1' } }),
      alerta({ id: 'n2' }),
      alerta({ id: 'n3', para_usuario: 'ana', tipo: 'proveedor_incompleto', titulo: 'Completá el proveedor Agostina', referencia: { link: '/compras?proveedor=9' } }),
    ];
    const db = dbFalsa({
      configuracion: CONFIG,
      push_suscripciones: (l: Llamada) => ({
        data: l.op !== 'select' ? null
          : l.filtros.some((x) => x[0] === 'in') ? [{ ...SUB_JP }, { ...SUB_JP, id: 8, usuario_id: 'ana', endpoint: 'https://a/ana' }].filter((x) => l.filtros.find((y) => y[0] === 'in')[2].includes(x.usuario_id))
            : [{ usuario_id: 'jp' }, { usuario_id: 'ana' }],
        error: null,
      }),
      alertas_internas: { data: noche, error: null },
      usuarios: { data: [{ id: 'jp' }, { id: 'leandro' }], error: null },
    });
    const { s, enviados } = servicio(db);
    expect(await s.manana()).toEqual({ personas: 2, enviados: 2 });
    const jp = enviados.find((e) => e.endpoint.endsWith('/jp'));
    expect(jp).toMatchObject({ titulo: 'Te llegaron 2 avisos a la noche', url: '/inicio#avisos', cuerpo: 'Pedido sin tomar: DOM-1 · Comprobante de $148.795 de Antonio' });
    const ana = enviados.find((e) => e.endpoint.endsWith('/ana'));
    expect(ana).toMatchObject({ titulo: 'Completá el proveedor Agostina', url: '/compras?proveedor=9' });
    const marca = db.llamadas.find((x: Llamada) => x.tabla === 'alertas_internas' && x.op === 'update');
    expect(marca.filtros).toContainEqual(['in', 'id', ['n1', 'n2', 'n3']]);
  });
});

describe('avisos al celular: el texto y a dónde lleva', () => {
  it('abre la pantalla del aviso, o donde se resuelve', () => {
    expect(urlDe('pedido_sin_tomar', { link: '/pedidos?pedido=abc' })).toBe('/pedidos?pedido=abc');
    expect(urlDe('pago', { telefono: '549' })).toBe('/clientes');
    expect(urlDe('whatsapp_caido', {})).toBe('/responde');
    expect(urlDe('bot_caido', null)).toBe('/responde');
    expect(urlDe('otro', {})).toBe('/inicio#avisos');
    // nunca a otro sitio
    expect(urlDe('otro', { link: '//otro.com/x' })).toBe('/inicio#avisos');
    expect(urlDe('otro', { link: 'https://otro.com' })).toBe('/inicio#avisos');
  });

  it('saca el emoji del principio pero no el signo de pesos', () => {
    expect(sinEmoji('🔴 Proveedor por WhatsApp: Berardi')).toBe('Proveedor por WhatsApp: Berardi');
    expect(sinEmoji('$ 1.000 a cobrar')).toBe('$ 1.000 a cobrar');
    expect(avisoDe({ id: 'x', para_usuario: null, tipo: 'pago', titulo: '💳 Pago', detalle: 'a'.repeat(300), referencia: {} }).cuerpo).toHaveLength(180);
  });

  it('un solo aviso de noche sale como él mismo', () => {
    expect(resumenDeNoche([{ id: 'z', para_usuario: null, tipo: 'bot_caido', titulo: 'El bot de WhatsApp no puede responder', detalle: null, referencia: {} }]))
      .toMatchObject({ titulo: 'El bot de WhatsApp no puede responder', url: '/responde', tag: 'alerta-z' });
  });
});
