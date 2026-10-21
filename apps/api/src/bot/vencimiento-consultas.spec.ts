import { BotService } from './bot.service';
import * as TEXTO from './textos-fijos';
import { abiertaAhora, aunNoVence, horarioDeAtencion, type HorarioSucursal, impideVencer, MINUTOS_MAXIMOS_PARA_VENCER, MINUTOS_PARA_VENCER, minutosDeHorario } from './vencimiento-consultas';

// LA CONSULTA SIN RESPUESTA PASA SOLA A UNA PERSONA (Leandro, 21/10/2026: «si»).
// Administración contestó 2 de 94 consultas silenciosas del 15 al 21/10. Ahora, a los 30
// minutos de horario sin respuesta del área (y sin que nadie de la casa le haya escrito al
// cliente), al cliente le llega UNA vez «Te paso con una persona del local.», el bot queda en
// pausa en esa charla y al local le llega la campanita y un WhatsApp a administración. Fuera
// de horario no se le escribe a nadie: los 30 minutos corren desde que abre.

process.env.ANTHROPIC_API_KEY ??= 'test';

// las horas, en Buenos Aires: el 19/10/2026 es lunes y el 18/10, domingo
const BA = (fechaHora: string) => Date.parse(`${fechaHora}:00-03:00`);
const iso = (fechaHora: string) => new Date(BA(fechaHora)).toISOString();

// las sucursales como están en la base (19/10/2026): los domingos Santa Inés cierra a las 14 y Saint Thomas a las 20
const SAINT_THOMAS: HorarioSucursal = { nombre: 'Suc Sant Thomas', pickup: true, abre: '08:00:00', cierra: '21:00:00', dias_abierta: [0, 1, 2, 3, 4, 5, 6], horario_por_dia: { 0: { cierra: '20:00' } } };
const SANTA_INES: HorarioSucursal = { nombre: 'Suc Santa Ines', pickup: false, abre: '08:30:00', cierra: '20:30:00', dias_abierta: [0, 1, 2, 3, 4, 5, 6], horario_por_dia: { 0: { cierra: '14:00' } } };
const HORARIO = horarioDeAtencion([SANTA_INES, SAINT_THOMAS]);

describe('el horario de atención', () => {
  it('cuenta el de la sucursal de los pedidos (pickup); sin ninguna marcada, el de todas juntas', () => {
    expect(HORARIO.map((s) => s.nombre)).toEqual(['Suc Sant Thomas']);
    expect(horarioDeAtencion([{ ...SANTA_INES }, { ...SAINT_THOMAS, pickup: false }])).toHaveLength(2);
    // una sucursal sin horario no cuenta (y sin ninguna, no hay horario: nunca vence)
    expect(horarioDeAtencion([{ nombre: 'x', abre: null, cierra: null }])).toEqual([]);
  });

  it('abre a las 8 y cierra a las 21; el domingo, a las 20 (horario por día)', () => {
    expect(abiertaAhora(HORARIO, BA('2026-10-19T07:59'))).toBe(false);
    expect(abiertaAhora(HORARIO, BA('2026-10-19T08:00'))).toBe(true);
    expect(abiertaAhora(HORARIO, BA('2026-10-19T20:59'))).toBe(true);
    expect(abiertaAhora(HORARIO, BA('2026-10-19T21:00'))).toBe(false);
    expect(abiertaAhora(HORARIO, BA('2026-10-18T19:59'))).toBe(true);
    expect(abiertaAhora(HORARIO, BA('2026-10-18T20:00'))).toBe(false);
  });

  it('solo cuentan los minutos con el local abierto', () => {
    expect(minutosDeHorario(HORARIO, BA('2026-10-19T10:00'), BA('2026-10-19T10:30'))).toBe(30);
    // a las 23 del lunes: hasta las 8 del martes no corre nada
    expect(minutosDeHorario(HORARIO, BA('2026-10-19T23:00'), BA('2026-10-20T07:59'))).toBe(0);
    expect(minutosDeHorario(HORARIO, BA('2026-10-19T23:00'), BA('2026-10-20T08:30'))).toBe(30);
    // diez minutos antes de cerrar el domingo, y veinte del lunes a la mañana
    expect(minutosDeHorario(HORARIO, BA('2026-10-18T19:50'), BA('2026-10-19T08:20'))).toBe(30);
    // con las dos sucursales, el tramo es la unión (Santa Inés abre 8:30: no suma nada)
    expect(minutosDeHorario([SANTA_INES, SAINT_THOMAS], BA('2026-10-19T07:00'), BA('2026-10-19T09:00'))).toBe(60);
  });
});

describe('¿llegó su momento? (aunNoVence)', () => {
  const consulta = (creado: string, extra: any = {}) => ({ id: 'c1', creado_en: iso(creado), gestion_version: 2, enviado_a: '5491125213601', ...extra });

  it(`vence a los ${MINUTOS_PARA_VENCER} min de horario, no antes`, () => {
    expect(aunNoVence(consulta('2026-10-19T10:00'), HORARIO, BA('2026-10-19T10:29'))).toMatch(/29 min/);
    expect(aunNoVence(consulta('2026-10-19T10:00'), HORARIO, BA('2026-10-19T10:30'))).toBeNull();
  });

  it('fuera de horario no vence; la de la noche vence a la media hora de abrir', () => {
    expect(aunNoVence(consulta('2026-10-19T22:00'), HORARIO, BA('2026-10-20T07:50'))).toBe('fuera de horario');
    expect(aunNoVence(consulta('2026-10-19T22:00'), HORARIO, BA('2026-10-20T08:20'))).toMatch(/20 min/);
    expect(aunNoVence(consulta('2026-10-19T22:00'), HORARIO, BA('2026-10-20T08:30'))).toBeNull();
    // la que llegó media hora antes de cerrar y no se contestó: vence apenas abre (sus 30 min ya corrieron)
    expect(aunNoVence(consulta('2026-10-19T20:30'), HORARIO, BA('2026-10-19T21:05'))).toBe('fuera de horario');
    expect(aunNoVence(consulta('2026-10-19T20:30'), HORARIO, BA('2026-10-20T08:05'))).toBeNull();
  });

  it(`pasados los ${MINUTOS_MAXIMOS_PARA_VENCER} min de horario ya es tarde: las consultas viejas no le escriben a nadie al publicar`, () => {
    expect(aunNoVence(consulta('2026-10-17T10:00'), HORARIO, BA('2026-10-19T11:00'))).toMatch(/tarde/);
    expect(aunNoVence(consulta('2026-10-19T08:00'), HORARIO, BA('2026-10-19T10:01'))).toMatch(/tarde/);
  });

  it('no vence la que respondió el área, la cerrada, la ya vencida, la del banco de pruebas, ni sin horario', () => {
    const ahora = BA('2026-10-19T11:00');
    expect(aunNoVence(consulta('2026-10-19T10:00', { respuesta_admin: 'Sí, hay estacionamiento.' }), HORARIO, ahora)).toBe('el área ya respondió');
    expect(aunNoVence(consulta('2026-10-19T10:00', { respondido_en: iso('2026-10-19T10:40') }), HORARIO, ahora)).toBe('la consulta está cerrada');
    expect(aunNoVence(consulta('2026-10-19T10:00', { vencida_en: iso('2026-10-19T10:30') }), HORARIO, ahora)).toBe('ya pasó a una persona');
    expect(aunNoVence(consulta('2026-10-19T10:00', { enviado_a: 'banco-de-pruebas' }), HORARIO, ahora)).toBe('banco de pruebas');
    expect(aunNoVence(consulta('2026-10-19T10:00'), [], ahora)).toMatch(/sin horario/);
  });
});

describe('¿algo impide pasarla a una persona? (impideVencer)', () => {
  const ahora = BA('2026-10-19T10:31');
  const consulta = { id: 'c1', creado_en: iso('2026-10-19T10:00'), consulta: '¿Tienen estacionamiento para el Wine Fest?' };
  const charla = (extra: any = {}) => ({ bot_activo: true, mensajes: [{ role: 'user', content: '¿Tienen estacionamiento?' }], ...extra });
  const decide = (o: any = {}) => impideVencer({ consulta, charla: charla(), contacto: null, ahora, ...o });

  it('una consulta de un cliente, sin nadie de la casa en el medio, vence', () => {
    expect(decide()).toBeNull();
  });

  it('no vence con el bot en pausa ni si la charla se derivó (o se pausó) después de la consulta', () => {
    expect(decide({ charla: charla({ bot_activo: false }) })).toMatch(/pausa/);
    expect(decide({ charla: charla({ derivada_en: iso('2026-10-19T10:10'), resuelta_en: iso('2026-10-19T10:20') }) })).toMatch(/derivó/);
    // una derivación de ANTES de la consulta, ya devuelta al bot, no la frena
    expect(decide({ charla: charla({ derivada_en: iso('2026-10-19T09:00'), resuelta_en: iso('2026-10-19T09:30') }) })).toBeNull();
  });

  it('no vence si una persona de la casa le escribió después de la consulta (teléfono o panel)', () => {
    const delTelefono = { role: 'assistant', content: 'Hola! Sí, hay estacionamiento.', de: 'telefono', en: iso('2026-10-19T10:12') };
    // el bot ya volvió solo y siguió hablando: igual alguien de la casa le contestó
    expect(decide({ charla: charla({ mensajes: [{ role: 'user', content: '¿Tienen estacionamiento?' }, delTelefono, { role: 'assistant', content: 'Te paso el total.' }] }) })).toMatch(/una persona de la casa le escribió/);
    const delPanel = { role: 'assistant', content: 'Te averiguo y te digo.', de: 'persona', en: iso('2026-10-19T10:05') };
    expect(decide({ charla: charla({ mensajes: [delPanel], resuelta_en: iso('2026-10-19T10:06') }) })).toMatch(/una persona de la casa le escribió/);
    // lo que escribió una persona ANTES de la consulta y sigue siendo lo último de la casa: la charla la lleva ella
    const antes = { role: 'assistant', content: 'Dale, te lo guardo.', de: 'telefono', en: iso('2026-10-19T09:40') };
    expect(decide({ charla: charla({ mensajes: [antes, { role: 'user', content: '¿Y el estacionamiento?' }] }) })).toMatch(/la lleva una persona/);
  });

  it('no vence con un proveedor, alguien de la casa, un contacto silenciado ni un mensaje para alguien de la casa', () => {
    expect(decide({ contacto: { tipo: 'proveedor' } })).toMatch(/proveedor/);
    expect(decide({ contacto: { es_equipo: true } })).toMatch(/de la casa/);
    expect(decide({ deLaCasa: true })).toMatch(/de la casa/);
    expect(decide({ contacto: { etiquetas: ['Silenciado'] } })).toMatch(/silenciado/);
    // las consultas falsas de la semana del 15/10: eran mensajes para Jaqueline o de proveedores
    expect(impideVencer({ consulta: { ...consulta, consulta: 'Buenas tardes jacquelin! cómo estas?' }, charla: charla(), contacto: null, ahora })).toMatch(/para alguien de la casa/);
    expect(impideVencer({ consulta: { ...consulta, consulta: 'El proveedor MUGE (carnes) pregunta si recibimos bien el último pedido' }, charla: charla(), contacto: null, ahora })).toMatch(/proveedor/);
    // pero un cliente que le pide algo a Jackie es un cliente: vence
    expect(impideVencer({ consulta: { ...consulta, consulta: 'Jackie, ¿cuánto sale la picada XL para el sábado?' }, charla: charla(), contacto: null, ahora })).toBeNull();
  });

  it('no vence si alguien la dio por resuelta con «Listo» en la campanita', () => {
    expect(decide({ cerradaEnLaCampanita: true })).toMatch(/Listo/);
  });
});

// ---------------------------------------------------------------------------
// El vigía entero (seguirConsultasPendientes) con una base en memoria: filtra, ordena,
// inserta, actualiza y hace upsert como la de verdad, y el update condicionado es atómico.
// `sinColumnas` simula la base sin db/migracion-vencimiento-consultas.sql aplicada.
// ---------------------------------------------------------------------------
type Fila = Record<string, any>;
function valorDe(f: Fila, col: string): any {
  if (col.includes('->>')) {
    const [a, b] = col.split('->>');
    return f[a]?.[b];
  }
  return f[col];
}
function baseEnMemoria(inicial: Record<string, Fila[]>, o: { sinColumnas?: string[] } = {}) {
  const tablas: Record<string, Fila[]> = {};
  for (const [k, v] of Object.entries(inicial)) tablas[k] = v.map((f) => ({ ...f }));
  const faltan = new Set(o.sinColumnas ?? []);
  let secuencia = 0;
  const db: any = {
    tablas,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      const filas = (tablas[tabla] ??= []);
      let op = 'select';
      let valor: any = null;
      let conflicto: string[] = [];
      let limite = Infinity;
      let desde = 0;
      let orden: { col: string; asc: boolean } | null = null;
      const columnas: string[] = [];
      const filtros: ((f: Fila) => boolean)[] = [];
      let hecho: any = null;
      const cumple = (f: Fila) => filtros.every((fn) => fn(f));
      const ejecutar = () => {
        if (hecho) return hecho;
        // la columna que todavía no está en la base: PostgREST contesta con un error
        const usadas = [...columnas, ...(op === 'update' || op === 'insert' ? Object.keys(valor ?? {}) : [])];
        if (tabla === 'bot_consultas_internas' && usadas.some((c) => faltan.has(c))) return (hecho = { data: null, error: { message: 'column does not exist' } });
        if (op === 'insert') {
          const nuevas = (Array.isArray(valor) ? valor : [valor]).map((v: Fila) => ({ id: v.id ?? `${tabla}-${++secuencia}`, creado_en: new Date().toISOString(), ...v }));
          filas.push(...nuevas);
          return (hecho = { data: nuevas, error: null });
        }
        if (op === 'upsert') {
          const v: Fila = valor;
          const previa = conflicto.length ? filas.find((f) => conflicto.every((c) => String(f[c]) === String(v[c]))) : null;
          if (previa) Object.assign(previa, v);
          else filas.push({ ...v });
          return (hecho = { data: [previa ?? v], error: null });
        }
        if (op === 'update') {
          const tocadas = filas.filter(cumple);
          for (const f of tocadas) Object.assign(f, valor);
          return (hecho = { data: tocadas.map((f) => ({ ...f })), error: null });
        }
        let r = filas.filter(cumple);
        if (orden) {
          const { col, asc } = orden;
          r = [...r].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        }
        r = r.slice(desde, limite === Infinity ? undefined : desde + limite);
        // sin la columna, select('*') no la trae
        return (hecho = { data: r.map((f) => { const c = { ...f }; if (tabla === 'bot_consultas_internas') for (const k of faltan) delete c[k]; return c; }), error: null });
      };
      const usa = (c: string) => columnas.push(c.split('->>')[0]);
      const b: any = {
        select: () => b,
        insert: (v: any) => { op = 'insert'; valor = v; return b; },
        upsert: (v: any, o2?: any) => { op = 'upsert'; valor = v; conflicto = String(o2?.onConflict ?? '').split(',').filter(Boolean); return b; },
        update: (v: any) => { op = 'update'; valor = v; return b; },
        eq: (c: string, v: any) => { usa(c); filtros.push((f) => valorDe(f, c) !== undefined && String(valorDe(f, c)) === String(v)); return b; },
        filter: (c: string, o2: string, v: any) => { usa(c); if (o2 === 'eq') filtros.push((f) => String(valorDe(f, c)) === String(v)); return b; },
        in: (c: string, vs: any[]) => { usa(c); filtros.push((f) => vs.map(String).includes(String(valorDe(f, c)))); return b; },
        is: (c: string, v: any) => { usa(c); filtros.push((f) => (valorDe(f, c) ?? null) === v); return b; },
        not: (c: string, o2: string, v: any) => { usa(c); if (o2 === 'is') filtros.push((f) => (valorDe(f, c) ?? null) !== v); return b; },
        gte: (c: string, v: any) => { usa(c); filtros.push((f) => String(valorDe(f, c) ?? '') >= String(v)); return b; },
        lte: (c: string, v: any) => { usa(c); filtros.push((f) => String(valorDe(f, c) ?? '') <= String(v)); return b; },
        contains: (c: string, vs: any[]) => { filtros.push((f) => Array.isArray(f[c]) && vs.every((x) => f[c].includes(x))); return b; },
        or: () => b,
        order: (c: string, o2?: any) => { orden = { col: c, asc: o2?.ascending !== false }; return b; },
        limit: (n: number) => { limite = n; return b; },
        range: (a: number, z: number) => { desde = a; limite = z - a + 1; return b; },
        maybeSingle: async () => { const r = ejecutar(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; },
        then: (ok: any, err: any) => Promise.resolve().then(ejecutar).then(ok, err),
      };
      return b;
    },
  };
  return db;
}

const ADMIN = '5491125213601';
const CLIENTE = '5491133344455';
const LINEA = {
  id: 'l1', linea: 'pedidos', tipo: 'pedidos', nombre: 'Línea general', numero_legible: '11 2281-2200', numero_e164: '5491122812200',
  waha_sesion: null, activa: true, bot_activo: true, comparte_config_de: null, derivar_pagos_a: ADMIN, avisar_proveedores_a: 'jaqui',
};
const fila = (creado: string, extra: Fila = {}): Fila => ({
  id: 'c1', linea: 'pedidos', telefono_cliente: CLIENTE, nombre: 'Laura', area: 'administracion', tema: 'el estacionamiento',
  consulta: '¿Tienen estacionamiento para el Wine Fest?', gestion_version: 2, enviado_a: ADMIN, waha_msg_id: 'W-consulta',
  respuesta_admin: null, respondido_en: null, envio_iniciado_en: null, intentos: 0, creado_en: iso(creado),
  // el recordatorio de los 20 min ya salió
  aviso_recordatorio_en: iso(creado), vencida_en: null, vencida_aviso_en: null, ...extra,
});
const base = (o: { consultas?: Fila[]; charla?: Fila | null; contactos?: Fila[]; linea?: Fila; sinColumnas?: string[] } = {}) => baseEnMemoria({
  lineas_whatsapp: [o.linea ?? LINEA],
  sucursales: [{ ...SANTA_INES, activa: true }, { ...SAINT_THOMAS, activa: true }],
  bot_consultas_internas: o.consultas ?? [fila('2026-10-19T10:00')],
  bot_conversaciones: o.charla === null ? [] : [{ linea: 'pedidos', telefono: CLIENTE, bot_activo: true, mensajes: [{ role: 'user', content: '¿Tienen estacionamiento para el Wine Fest?' }], ...(o.charla ?? {}) }],
  bot_contactos: o.contactos ?? [],
  usuarios: [],
  alertas_internas: [],
}, { sinColumnas: o.sinColumnas });

function servicio(db: any, envio: (p: any) => any = () => ({ enviado: true, id: 'W1' })) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  const wsp = jest.fn(async (p: any) => envio(p));
  s.enviarPorWhatsapp = wsp;
  s.respondeRegistrar = jest.fn(async () => null);
  s.respondePausar = jest.fn(async () => null);
  s.respondeModoHumano = jest.fn(async () => false);
  return { s, wsp };
}
const alCliente = (wsp: jest.Mock) => wsp.mock.calls.map((c) => c[0]).filter((p) => p.text === TEXTO.PASA_A_UNA_PERSONA);
const aAdministracion = (wsp: jest.Mock) => wsp.mock.calls.map((c) => c[0]).filter((p) => p.to === ADMIN && /pasó a una persona/.test(p.text));
const consultaDe = (db: any, id = 'c1') => db.tablas.bot_consultas_internas.find((c: Fila) => c.id === id);
const charlaDe = (db: any) => db.tablas.bot_conversaciones.find((c: Fila) => c.telefono === CLIENTE);

describe('el vigía de consultas pasa a una persona la consulta sin respuesta', () => {
  const enHora = (fechaHora: string) => jest.setSystemTime(BA(fechaHora));
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('a los 30 min en horario: UNA vez «Te paso con una persona del local.», pausa, campanita y WhatsApp a administración', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();

    expect(alCliente(wsp)).toEqual([expect.objectContaining({ to: CLIENTE, linea: 'pedidos' })]);
    const aviso = aAdministracion(wsp);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]).toMatchObject({ kind: 'aviso-interno' });
    expect(aviso[0].text).toMatch(/Laura · \+5491133344455/);
    expect(aviso[0].text).toMatch(/estacionamiento para el Wine Fest/);
    // las dos marcas quedaron puestas
    expect(consultaDe(db).vencida_en).toBeTruthy();
    expect(consultaDe(db).vencida_aviso_en).toBeTruthy();
    // la derivación de siempre: el bot en pausa en esa charla, la espera y la campanita
    const ch = charlaDe(db);
    expect(ch.bot_activo).toBe(false);
    expect(ch.derivada_motivo).toMatch(/sin respuesta del área/);
    expect(ch.esperando_texto).toMatch(/no tuvo respuesta/);
    expect(ch.mensajes[ch.mensajes.length - 1]).toEqual({ role: 'assistant', content: TEXTO.PASA_A_UNA_PERSONA });
    expect(db.tablas.alertas_internas.filter((a: Fila) => a.tipo === 'derivacion')).toHaveLength(1);
    expect(s.respondePausar).toHaveBeenCalled();
    // la consulta sigue abierta: si el área contesta después, le llega a quien atiende (retenerRespuestaDeConsulta)
    expect(consultaDe(db).respondido_en).toBeNull();

    // la vuelta siguiente no repite nada
    wsp.mockClear();
    enHora('2026-10-19T10:36');
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(0);
    expect(aAdministracion(wsp)).toHaveLength(0);
  });

  it('antes de los 30 min no pasa nada', async () => {
    enHora('2026-10-19T10:29');
    const db = base();
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect(wsp).not.toHaveBeenCalled();
    expect(consultaDe(db).vencida_en).toBeNull();
    expect(charlaDe(db).bot_activo).toBe(true);
  });

  it('fuera de horario no le escribe a nadie; la de la noche vence a la media hora de abrir', async () => {
    const db = base({ consultas: [fila('2026-10-19T22:00', { aviso_recordatorio_en: iso('2026-10-19T22:20') })] });
    const { s, wsp } = servicio(db);
    for (const hora of ['2026-10-19T23:30', '2026-10-20T03:00', '2026-10-20T07:55', '2026-10-20T08:25']) {
      enHora(hora);
      await s.seguirConsultasPendientes();
    }
    expect(alCliente(wsp)).toHaveLength(0);
    expect(consultaDe(db).vencida_en).toBeNull();

    enHora('2026-10-20T08:31');
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1);
    expect(aAdministracion(wsp)).toHaveLength(1);
  });

  it('no vence si el área ya respondió', async () => {
    enHora('2026-10-19T10:40');
    // la respuesta está guardada y su entrega en curso
    const db = base({ consultas: [fila('2026-10-19T10:00', { respuesta_admin: 'Sí, hay estacionamiento en el predio.', envio_iniciado_en: iso('2026-10-19T10:35') })] });
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(0);
    expect(consultaDe(db).vencida_en).toBeNull();
    expect(charlaDe(db).bot_activo).toBe(true);
  });

  it('no vence si una persona de la casa le escribió al cliente después de la consulta', async () => {
    enHora('2026-10-19T10:40');
    // escribió desde el teléfono a las 10:05: la pausa de 30 min ya terminó y el bot volvió solo
    const db = base({ charla: {
      bot_activo: true, derivada_en: iso('2026-10-19T10:05'), derivada_motivo: 'Atendida desde el teléfono · el bot volvió solo', resuelta_en: iso('2026-10-19T10:35'),
      mensajes: [{ role: 'user', content: '¿Tienen estacionamiento para el Wine Fest?' }, { role: 'assistant', content: 'Sí! Hay estacionamiento.', de: 'telefono', en: iso('2026-10-19T10:05') }],
    } });
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect(wsp).not.toHaveBeenCalled();
    expect(consultaDe(db).vencida_en).toBeNull();

    // desde el panel (no toca derivada_en) y ya devuelta al bot: tampoco
    const db2 = base({ charla: {
      bot_activo: true, resuelta_en: iso('2026-10-19T10:20'),
      mensajes: [{ role: 'user', content: '¿Tienen estacionamiento?' }, { role: 'assistant', content: 'Te averiguo y te digo.', de: 'persona', en: iso('2026-10-19T10:15') }],
    } });
    const r2 = servicio(db2);
    await r2.s.seguirConsultasPendientes();
    expect(alCliente(r2.wsp)).toHaveLength(0);
  });

  it('no vence con el bot en pausa en esa charla, con un proveedor ni con el bot apagado en la línea', async () => {
    enHora('2026-10-19T10:40');
    const pausada = base({ charla: { bot_activo: false, derivada_en: iso('2026-10-19T09:00'), derivada_motivo: 'Pausado desde la bandeja' } });
    const r1 = servicio(pausada);
    await r1.s.seguirConsultasPendientes();
    expect(alCliente(r1.wsp)).toHaveLength(0);

    const proveedor = base({ contactos: [{ telefono: CLIENTE, tipo: 'proveedor', etiquetas: [] }] });
    const r2 = servicio(proveedor);
    await r2.s.seguirConsultasPendientes();
    expect(alCliente(r2.wsp)).toHaveLength(0);

    const apagada = base({ linea: { ...LINEA, bot_activo: false } });
    const r3 = servicio(apagada);
    await r3.s.seguirConsultasPendientes();
    expect(r3.wsp).not.toHaveBeenCalled();
  });

  it('una sola vez aunque corran dos procesos a la vez', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    const a = servicio(db);
    const b = servicio(db);
    await Promise.all([a.s.seguirConsultasPendientes(), b.s.seguirConsultasPendientes()]);
    enHora('2026-10-19T10:36');
    await Promise.all([a.s.seguirConsultasPendientes(), b.s.seguirConsultasPendientes()]);
    expect(alCliente(a.wsp).length + alCliente(b.wsp).length).toBe(1);
    expect(aAdministracion(a.wsp).length + aAdministracion(b.wsp).length).toBe(1);
    expect(db.tablas.alertas_internas.filter((x: Fila) => x.tipo === 'derivacion')).toHaveLength(1);
  });

  it('dos consultas de la misma charla: el cliente recibe el pase una sola vez', async () => {
    enHora('2026-10-19T10:45');
    const db = base({ consultas: [fila('2026-10-19T10:00'), fila('2026-10-19T10:10', { id: 'c2', consulta: '¿Y se puede ir con chicos?', tema: 'los menores' })] });
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    enHora('2026-10-19T10:50');
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1);
    expect(consultaDe(db, 'c1').vencida_en).toBeTruthy();
    expect(consultaDe(db, 'c2').vencida_en).toBeNull();
  });

  it('una consulta vieja que era para alguien de la casa no frena la del cliente que vino después', async () => {
    enHora('2026-10-19T10:45');
    const db = base({ consultas: [
      fila('2026-10-19T10:00', { id: 'jackie', consulta: 'Hola Jackie! cómo estás?', tema: null }),
      fila('2026-10-19T10:10', { id: 'c2', consulta: '¿Se puede ir con chicos al Wine Fest?', tema: 'los menores' }),
    ] });
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1);
    expect(consultaDe(db, 'jackie').vencida_en).toBeNull();
    expect(consultaDe(db, 'c2').vencida_en).toBeTruthy();
    expect(aAdministracion(wsp)[0].text).toMatch(/los menores/);
  });

  it('si el WhatsApp al cliente seguro no salió (reintentable), no marca nada (ni pausa) y lo reintenta en la vuelta siguiente', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    let anda = false;
    const { s, wsp } = servicio(db, (p) => (anda || p.to === ADMIN ? { enviado: true, id: 'W1' } : { enviado: false, reintentable: true, motivo: 'WhatsApp no conectado' }));
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1); // se intentó
    expect(consultaDe(db).vencida_en).toBeNull();
    expect(consultaDe(db).vencida_aviso_en).toBeNull();
    expect(charlaDe(db).bot_activo).toBe(true);
    expect(aAdministracion(wsp)).toHaveLength(0);
    expect(db.tablas.alertas_internas.filter((x: Fila) => x.tipo === 'derivacion')).toHaveLength(0);

    anda = true;
    enHora('2026-10-19T10:36');
    await s.seguirConsultasPendientes();
    expect(consultaDe(db).vencida_en).toBeTruthy();
    expect(charlaDe(db).bot_activo).toBe(false);
    expect(aAdministracion(wsp)).toHaveLength(1);
  });

  it('si el que no sale es el WhatsApp a administración, el cliente no recibe dos veces y el aviso se reintenta', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    let adminAnda = false;
    const { s, wsp } = servicio(db, (p) => (p.to !== ADMIN || adminAnda ? { enviado: true, id: 'W1' } : { enviado: false, reintentable: true, motivo: 'WhatsApp no conectado' }));
    await s.seguirConsultasPendientes();
    expect(consultaDe(db).vencida_en).toBeTruthy();
    expect(consultaDe(db).vencida_aviso_en).toBeNull();

    adminAnda = true;
    enHora('2026-10-19T10:36');
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1);
    expect(aAdministracion(wsp)).toHaveLength(2); // el que falló y el reintento
    expect(consultaDe(db).vencida_aviso_en).toBeTruthy();
  });

  it('envío incierto al cliente (WAHA tardó o dio 5xx): no se repite nunca y la charla pasa igual a una persona', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    const { s, wsp } = servicio(db, (p) => (p.to === ADMIN ? { enviado: true, id: 'W1' } : { enviado: false, motivo: 'WAHA inalcanzable: aborted' }));
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(1);
    expect(consultaDe(db).vencida_en).toBeTruthy(); // la marca queda: no se vuelve a mandar
    expect(String(consultaDe(db).ultimo_error)).toMatch(/incierto/);
    expect(charlaDe(db).bot_activo).toBe(false); // pasó igual a una persona
    expect(aAdministracion(wsp)).toHaveLength(1);
    for (const h of ['2026-10-19T10:36', '2026-10-19T10:41', '2026-10-19T11:30']) {
      enHora(h);
      await s.seguirConsultasPendientes();
    }
    expect(alCliente(wsp)).toHaveLength(1);
    expect(aAdministracion(wsp)).toHaveLength(1);
  });

  it('envío incierto del aviso a administración: no se repite (queda la campanita)', async () => {
    enHora('2026-10-19T10:31');
    const db = base();
    const { s, wsp } = servicio(db, (p) => (p.to !== ADMIN ? { enviado: true, id: 'W1' } : { enviado: false, motivo: 'WAHA respondió 500' }));
    await s.seguirConsultasPendientes();
    for (const h of ['2026-10-19T10:36', '2026-10-19T10:41']) {
      enHora(h);
      await s.seguirConsultasPendientes();
    }
    expect(alCliente(wsp)).toHaveLength(1);
    expect(aAdministracion(wsp)).toHaveLength(1);
    expect(consultaDe(db).vencida_aviso_en).toBeTruthy();
  });

  it('sin la columna en la base (migración sin aplicar) no se rompe ni le escribe a nadie', async () => {
    enHora('2026-10-19T10:31');
    const db = base({ sinColumnas: ['vencida_en', 'vencida_aviso_en'] });
    const { s, wsp } = servicio(db);
    await expect(s.seguirConsultasPendientes()).resolves.toBeUndefined();
    expect(alCliente(wsp)).toHaveLength(0);
    expect(charlaDe(db).bot_activo).toBe(true);
  });

  it('al publicar, las consultas viejas sin respuesta no le escriben a nadie', async () => {
    enHora('2026-10-19T10:31');
    const viejas = ['2026-10-15T10:00', '2026-10-17T18:00', '2026-10-19T08:00'].map((h, i) => fila(h, { id: `v${i}`, telefono_cliente: `54911333444${50 + i}` }));
    const db = base({ consultas: viejas });
    const { s, wsp } = servicio(db);
    await s.seguirConsultasPendientes();
    expect(alCliente(wsp)).toHaveLength(0);
  });
});
