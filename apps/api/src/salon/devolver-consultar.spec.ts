import { SalonService } from './salon.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { ladoDe, limpiarMensaje } from './consultas';
import { esPasoAtras, motivoSinPasoAtras, pasoAtras } from '../pedidos/transiciones';
import { textoDeConsulta, textoDeDevuelto, textoDeRespuesta } from '../avisos/aviso-pedido';

// DEVOLVER, DESHACER Y CONSULTAR (Juan Pablo, 20/11/2026: «si tienen que devolver
// un pedido, si tienen que deshacer algo, si le tienen que hacer una consulta a
// la persona que se los asignó. Todo eso tiene que estar previsto desde la app»).
// Las personas son las de ese día: Alexis cobra y arma; Juan Pablo es el
// encargado que le asignó el DOM-A69053F42C96; Melina solo arma.

const ALEXIS = { sub: 'u-alexis', rol: 'cajero', roles: ['cajero', 'op_salon'] };
const JUANPI = { sub: 'u-juanpi', rol: 'gerente', roles: ['gerente'] };
const MELINA = { sub: 'u-melina', rol: 'op_salon', roles: ['op_salon'] };
const AILIN = { sub: 'u-ailin', rol: 'cajero', roles: ['cajero'] };

/** Una base en memoria con lo justo de la API de Supabase que usan estos métodos. */
function base(inicial: Record<string, any[]>) {
  const tablas: Record<string, any[]> = { pedidos: [], pedidos_mensajes: [], pedidos_historial: [], pedidos_carro: [], avisos_pedidos: [], usuarios: [], ...inicial };
  let seq = 1;
  const from = (tabla: string) => {
    const filtros: ((f: any) => boolean)[] = [];
    let cambios: any = null;
    let contar = false;
    const filas = () => (tablas[tabla] ??= []).filter((f) => filtros.every((x) => x(f)));
    const resultado = () => {
      const lista = filas();
      if (cambios) for (const f of lista) Object.assign(f, cambios);
      return { data: contar ? null : lista.map((f) => ({ ...f })), count: lista.length, error: null };
    };
    const q: any = {
      select: (_c?: string, o?: any) => { if (o?.head) contar = true; return q; },
      update: (f: any) => { cambios = f; return q; },
      insert: (f: any) => { tablas[tabla].push({ id: seq++, creado_en: new Date(Date.now() + seq).toISOString(), visto_en: null, ...f }); return Promise.resolve({ error: null }); },
      eq: (c: string, v: any) => { filtros.push((f) => f[c] === v); return q; },
      neq: (c: string, v: any) => { filtros.push((f) => f[c] !== v); return q; },
      in: (c: string, v: any[]) => { filtros.push((f) => v.includes(f[c])); return q; },
      is: (c: string, v: any) => { filtros.push((f) => (v === null ? f[c] == null : f[c] === v)); return q; },
      gte: (c: string, v: any) => { filtros.push((f) => String(f[c] ?? '') >= String(v)); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => { const r = resultado(); return { data: r.data?.[0] ?? null, error: null }; },
      then: (ok: any, mal: any) => Promise.resolve(resultado()).then(ok, mal),
    };
    return q;
  };
  return { db: { from } as any, tablas };
}

const ahora = () => new Date().toISOString();
const pedido = (extra: Record<string, unknown> = {}) => ({
  id: 'p-1', qr_retiro: 'DOM-A69053F42C96', estado: 'en_preparacion', canal: 'domicilio', sucursal_id: 's-1', creado_en: ahora(),
  asignado_a: 'u-alexis', asignado_en: ahora(), asignado_por: 'u-juanpi', tomado_por: 'u-alexis', contacto_nombre: 'Marcela', contacto_telefono: '5491155550000',
  devuelto_por: null, devuelto_en: null, devuelto_motivo: null, ...extra,
});
const USUARIOS = [
  { id: 'u-alexis', nombre: 'Alexis luna' }, { id: 'u-juanpi', nombre: 'Juan Pablo Fernandez' },
  { id: 'u-melina', nombre: 'Orsi Melina' }, { id: 'u-ailin', nombre: 'Ailin Gómez' },
];
function armar(pedidos: any[], extra: Record<string, any[]> = {}) {
  const b = base({ pedidos, usuarios: USUARIOS, ...extra });
  const servicioPedidos = new PedidosService(b.db, {} as any);
  const salon = new SalonService(b.db, {} as any, servicioPedidos, {} as any);
  return { ...b, salon, pedidos: servicioPedidos };
}

describe('devolver un pedido que no se puede armar', () => {
  it('quien lo arma lo devuelve con el motivo: queda sin armador, con el carro, y se le avisa a quien se lo asignó', async () => {
    const { salon, tablas } = armar([pedido()], { pedidos_carro: [{ id: 9, pedido_id: 'p-1', producto_id: 'x', cantidad: 3 }] });
    const r = await salon.devolver('p-1', '  estoy solo en la caja  ', ALEXIS);
    expect(r).toMatchObject({ ok: true, propio: true, avisado: 'Juan Pablo Fernandez', enCarro: 1 });
    expect(tablas.pedidos[0]).toMatchObject({ asignado_a: null, asignado_en: null, estado: 'en_preparacion', devuelto_por: 'u-alexis', devuelto_motivo: 'estoy solo en la caja', cambio_por: 'u-alexis' });
    // lo cargado no se toca: el que sigue lo ve hecho
    expect(tablas.pedidos_carro).toHaveLength(1);
    expect(tablas.pedidos_historial[0]).toMatchObject({ evento: 'devuelto', usuario_id: 'u-alexis', detalle: { motivo: 'estoy solo en la caja', de: 'Alexis luna', por_caja: false } });
    const aviso = tablas.avisos_pedidos[0];
    expect(aviso).toMatchObject({ pedido_id: 'p-1', tipo: 'armado_devuelto', detalle: { usuario_id: 'u-juanpi', nombre: 'Juan Pablo Fernandez' } });
    expect(aviso.detalle.texto).toMatch(/^DEVOLVIERON EL PEDIDO · DOM-A69053F42C96 · \d\d:\d\d\n/);
    expect(aviso.detalle.texto).toContain('Alexis no lo puede armar: «estoy solo en la caja».');
    expect(aviso.detalle.texto).toContain('Lo que ya cargó quedó en el carro');
  });

  it('sin motivo no se devuelve: la caja tiene que saber por qué', async () => {
    const { salon, tablas } = armar([pedido()]);
    await expect(salon.devolver('p-1', ' ', ALEXIS)).rejects.toThrow(/por qué no lo podés armar/);
    expect(tablas.pedidos[0].asignado_a).toBe('u-alexis');
  });

  it('el que solo arma no devuelve el pedido de otro', async () => {
    const { salon } = armar([pedido()]);
    await expect(salon.devolver('p-1', 'no es mío', MELINA)).rejects.toThrow(/no te lo asignaron/);
  });

  it('la caja le saca el armado a alguien sin motivo, y no queda como devuelto', async () => {
    const { salon, tablas } = armar([pedido()]);
    const r = await salon.devolver('p-1', undefined, JUANPI);
    expect(r).toMatchObject({ ok: true, propio: false, avisado: null });
    expect(tablas.pedidos[0]).toMatchObject({ asignado_a: null, devuelto_por: null, devuelto_en: null });
    expect(tablas.pedidos_historial[0].detalle).toMatchObject({ por_caja: true, de: 'Alexis luna' });
    // a quien lo armaba le avisa la base (YA NO LO ARMÁS), no este aviso
    expect(tablas.avisos_pedidos).toHaveLength(0);
  });

  it('un pedido que ya está listo no se devuelve', async () => {
    const { salon } = armar([pedido({ estado: 'listo' })]);
    await expect(salon.devolver('p-1', 'tarde', ALEXIS)).rejects.toThrow(/ya no se está armando/);
  });
});

describe('deshacer un paso', () => {
  it('solo vuelven atrás los pasos que no tocan stock ni plata', () => {
    expect(pasoAtras('listo')).toBe('en_preparacion');
    expect(pasoAtras('en_camino')).toBe('listo');
    for (const e of ['recibido', 'pagado', 'en_preparacion', 'entregado', 'cancelado']) expect(pasoAtras(e)).toBeNull();
    expect(esPasoAtras('listo', 'en_preparacion')).toBe(true);
    expect(esPasoAtras('en_preparacion', 'listo')).toBe(false);
    expect(motivoSinPasoAtras('entregado')).toMatch(/Devolución/);
    expect(motivoSinPasoAtras('cancelado')).toMatch(/Cargalo de nuevo/);
  });

  it('«lo finalicé sin querer»: vuelve a En preparación a nombre del mismo', async () => {
    const { salon, tablas } = armar([pedido({ estado: 'listo', listo_en: ahora(), armado_terminado_en: ahora() })]);
    const r = await salon.reabrir('p-1', ALEXIS);
    expect(r).toMatchObject({ estado: 'en_preparacion', antes: 'listo' });
    expect(tablas.pedidos[0]).toMatchObject({ estado: 'en_preparacion', asignado_a: 'u-alexis', listo_en: null, armado_terminado_en: null, cambio_por: 'u-alexis' });
  });

  it('el que solo arma no reabre el pedido de otro, y uno que ya salió lo vuelve atrás la caja', async () => {
    const a = armar([pedido({ estado: 'listo' })]);
    await expect(a.salon.reabrir('p-1', MELINA)).rejects.toThrow(/no lo armaste vos/);
    const b = armar([pedido({ estado: 'en_camino' })]);
    await expect(b.salon.reabrir('p-1', ALEXIS)).rejects.toThrow(/pedile a la caja/);
  });

  it('la caja deshace «Salió»: vuelve a Listos', async () => {
    const { pedidos, tablas } = armar([pedido({ estado: 'en_camino', en_camino_en: ahora(), repartidor_id: 'u-mati' })]);
    const r = await pedidos.deshacer('p-1', 'u-juanpi');
    expect(r).toMatchObject({ estado: 'listo', antes: 'en_camino' });
    // quién lo llevaba queda puesto: «Despachar» lo vuelve a proponer
    expect(tablas.pedidos[0]).toMatchObject({ estado: 'listo', en_camino_en: null, repartidor_id: 'u-mati' });
  });

  it('entregado y cancelado no vuelven desde acá', async () => {
    const a = armar([pedido({ estado: 'entregado' })]);
    await expect(a.pedidos.deshacer('p-1', 'u-juanpi')).rejects.toThrow(/Devolución/);
    const b = armar([pedido({ estado: 'cancelado' })]);
    await expect(b.pedidos.deshacer('p-1', 'u-juanpi')).rejects.toThrow(/no vuelve/);
  });

  it('«Soltarlo» deshace el «Lo tomo»: lo suelta quien lo tomó o un encargado, y solo si nadie lo empezó', async () => {
    const libre = () => pedido({ estado: 'recibido', asignado_a: null, tomado_por: 'u-ailin', tomado_en: ahora() });
    const a = armar([libre()]);
    await expect(a.pedidos.soltar('p-1', ALEXIS)).rejects.toThrow(/Lo tomó Ailin Gómez/);
    expect(await a.pedidos.soltar('p-1', AILIN)).toEqual({ ok: true });
    expect(a.tablas.pedidos[0]).toMatchObject({ tomado_por: null, tomado_en: null });
    expect(a.tablas.pedidos_historial[0]).toMatchObject({ evento: 'soltado', usuario_id: 'u-ailin' });
    const b = armar([libre()]);
    expect(await b.pedidos.soltar('p-1', JUANPI)).toEqual({ ok: true });
    const c = armar([pedido({ tomado_por: 'u-ailin' })]);
    await expect(c.pedidos.soltar('p-1', AILIN)).rejects.toThrow(/ya se está preparando/);
  });
});

describe('la consulta a quien se lo asignó', () => {
  it('cada uno habla de su lado', () => {
    const p = { asignado_a: 'u-alexis' };
    expect(ladoDe(p, ALEXIS)).toBe('armado'); // cobra, pero este lo arma él
    expect(ladoDe(p, JUANPI)).toBe('caja');
    expect(ladoDe(p, AILIN)).toBe('caja');
    expect(ladoDe(p, MELINA)).toBeNull(); // solo arma y no es suyo
    expect(ladoDe({ asignado_a: 'u-melina' }, ALEXIS)).toBe('caja');
    expect(ladoDe(p, null)).toBeNull();
    expect(limpiarMensaje('  no encuentro\n el   Rutini ')).toBe('no encuentro el Rutini');
    expect(limpiarMensaje('x'.repeat(900))).toHaveLength(600);
  });

  it('quien arma pregunta: queda en el pedido y le sale el WhatsApp a quien se lo asignó', async () => {
    const { salon, tablas } = armar([pedido()]);
    const r = await salon.escribir('p-1', 'No hay Rutini, ¿va Trumpeter?', ALEXIS);
    expect(r).toMatchObject({ ok: true, lado: 'armado', avisado: 'Juan Pablo Fernandez' });
    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0]).toMatchObject({ lado: 'armado', deNombre: 'Alexis luna', texto: 'No hay Rutini, ¿va Trumpeter?', vistoEn: null });
    const aviso = tablas.avisos_pedidos[0];
    expect(aviso).toMatchObject({ tipo: 'consulta_armado', detalle: { usuario_id: 'u-juanpi' } });
    expect(aviso.detalle.texto.split('\n')[0]).toBe('CONSULTA DEL ARMADO · DOM-A69053F42C96 · mensaje 1');
    expect(aviso.detalle.texto).toContain('Juan, Alexis pregunta mientras arma:');
    expect(aviso.detalle.texto).toContain('«No hay Rutini, ¿va Trumpeter?»');
  });

  it('la caja contesta: da por vista la pregunta y le sale el WhatsApp a quien arma', async () => {
    const { salon, tablas } = armar([pedido()]);
    await salon.escribir('p-1', 'No hay Rutini, ¿va Trumpeter?', ALEXIS);
    // contesta otra cajera de la sucursal, no solo quien lo asignó
    const r = await salon.escribir('p-1', 'Sí, poné Trumpeter', AILIN);
    expect(r).toMatchObject({ lado: 'caja', avisado: 'Alexis luna' });
    expect(tablas.pedidos_mensajes[0]).toMatchObject({ lado: 'armado', visto_por: 'u-ailin' });
    expect(tablas.pedidos_mensajes[0].visto_en).toBeTruthy();
    const respuesta = tablas.avisos_pedidos.find((a) => a.tipo === 'respuesta_armado');
    expect(respuesta.detalle).toMatchObject({ usuario_id: 'u-alexis' });
    expect(respuesta.detalle.texto.split('\n')[0]).toBe('TE CONTESTARON · DOM-A69053F42C96 · mensaje 2');
    expect(respuesta.detalle.texto).toContain('Alexis, Ailin te escribió:');
  });

  it('dos preguntas seguidas van en un solo WhatsApp (el aviso es uno por pedido y se rearma)', async () => {
    const { salon, tablas } = armar([pedido()]);
    await salon.escribir('p-1', 'No hay Rutini', ALEXIS);
    await salon.escribir('p-1', '¿Va con bolsa?', ALEXIS);
    const avisos = tablas.avisos_pedidos.filter((a) => a.tipo === 'consulta_armado');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ estado: 'pendiente', intentos: 0 });
    expect(avisos[0].detalle.texto).toContain('«No hay Rutini»');
    expect(avisos[0].detalle.texto).toContain('«¿Va con bolsa?»');
    expect(avisos[0].detalle.texto.split('\n')[0]).toMatch(/mensaje 2$/);
  });

  it('la ventana de la caja: preguntas sin ver y devueltos sin armador; al verlas, se van', async () => {
    const { salon } = armar([pedido(), pedido({ id: 'p-2', qr_retiro: 'PICKUP-2', asignado_a: null, devuelto_por: 'u-melina', devuelto_en: ahora(), devuelto_motivo: 'me voy' })]);
    await salon.escribir('p-1', '¿Va con bolsa?', ALEXIS);
    const lista = await salon.consultas(JUANPI);
    expect(lista.map((c: any) => c.pedidoId).sort()).toEqual(['p-1', 'p-2']);
    expect(lista.find((c: any) => c.pedidoId === 'p-1')).toMatchObject({ sinVer: 1, armaNombre: 'Alexis luna', devuelto: null });
    expect(lista.find((c: any) => c.pedidoId === 'p-2')).toMatchObject({ sinVer: 0, devuelto: { porNombre: 'Orsi Melina', motivo: 'me voy' } });
    // el que solo arma no ve la ventana de la caja
    expect(await salon.consultas(MELINA)).toEqual([]);
    await salon.marcarVistos('p-1', JUANPI);
    expect((await salon.consultas(JUANPI)).map((c: any) => c.pedidoId)).toEqual(['p-2']);
  });

  it('no se escribe en un pedido cerrado, ni vacío, ni la caja a un pedido sin armador', async () => {
    const a = armar([pedido({ estado: 'entregado' })]);
    await expect(a.salon.escribir('p-1', 'hola', JUANPI)).rejects.toThrow(/ya está cerrado/);
    const b = armar([pedido()]);
    await expect(b.salon.escribir('p-1', '   ', ALEXIS)).rejects.toThrow(/Escribí el mensaje/);
    await expect(b.salon.escribir('p-1', 'hola', MELINA)).rejects.toThrow(/no te lo asignaron/);
    const c = armar([pedido({ asignado_a: null })]);
    await expect(c.salon.escribir('p-1', 'hola', JUANPI)).rejects.toThrow(/no tiene quién lo arme/);
  });

  it('los textos de WhatsApp dicen quién, qué y dónde contestar', () => {
    process.env.ADMIN_URL = 'https://sistema.odbpremiummarket.com.ar';
    const p = { id: 'p-1', qr_retiro: 'DOM-A69053F42C96' };
    expect(textoDeDevuelto(p, { para: 'Juan Pablo Fernandez', de: 'Alexis luna', motivo: 'me voy', enCarro: 0 }).split('\n')).toEqual([
      'DEVOLVIERON EL PEDIDO · DOM-A69053F42C96',
      'Juan, Alexis no lo puede armar: «me voy».',
      'Asignáselo a otra persona: https://sistema.odbpremiummarket.com.ar/pedidos?pedido=p-1',
    ]);
    expect(textoDeConsulta(p, { para: null, de: null, mensajes: ['¿Va con bolsa?'] })).toContain('Quien lo arma pregunta mientras arma:\n«¿Va con bolsa?»\nContestale acá: https://sistema.odbpremiummarket.com.ar/pedidos?pedido=p-1');
    expect(textoDeRespuesta(p, { para: 'Alexis luna', de: 'Juan Pablo Fernandez', mensajes: ['Sí'] })).toContain('Alexis, Juan te escribió:\n«Sí»\nSeguí armando acá: https://sistema.odbpremiummarket.com.ar/salon');
  });
});
