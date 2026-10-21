// Lógica de Eventos sin base de datos: etapas, nombres sugeridos, los números
// de arriba de la pantalla y las tres listas de oportunidades. Está separada
// del servicio para poder probarla con datos inventados (eventos.logica.spec.ts).
//
// 21/10/2026: la pantalla pasó de "cumpleaños de los próximos 60 días" (con 2
// clientes con fecha cargada sobre 6.749, siempre vacía) a un tablero de
// eventos por etapa con oportunidades que salen de lo que la base sí tiene:
// empresas para fin de año y compras grandes recientes.

export const ETAPAS = ['prospecto', 'propuesta', 'confirmado', 'realizado'] as const;
export const ESTADOS = [...ETAPAS, 'cancelado'] as const;
export type Estado = (typeof ESTADOS)[number];
/** Los que todavía se están trabajando (ni hechos ni caídos). */
export const ABIERTOS: readonly Estado[] = ['prospecto', 'propuesta', 'confirmado'];

export const TIPOS = ['cumpleanos', 'casamiento', 'corporativo', 'fin_de_ano', 'otro'] as const;
export type Tipo = (typeof TIPOS)[number];

/** De dónde salió el evento (columna `origen`, migración eventos-pro). */
export const ORIGENES = ['manual', 'cumpleanos', 'fin_de_ano', 'compra_grande'] as const;

/** Columnas que agrega db/migracion-eventos-pro.sql. Sin la migración, van a las notas. */
export const COLUMNAS_NUEVAS = ['lugar', 'contacto_nombre', 'contacto_telefono', 'origen'] as const;

// ------------------------------------------------------------------ fechas

/** Hoy en Buenos Aires, "AAAA-MM-DD" (el servidor corre en UTC). */
export function hoyBA(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);
}

const aDia = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** "2026-10-21" + 10 → "2026-10-31". */
export function sumarDias(iso: string, dias: number): string {
  return new Date(aDia(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Días de `desde` a `hasta` (negativo si `hasta` ya pasó). Acepta fechas con hora: toma el día. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aDia(hasta.slice(0, 10)) - aDia(desde.slice(0, 10))) / 86_400_000);
}

const esFechaISO = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(aDia(v)) && new Date(aDia(v)).toISOString().slice(0, 10) === v;

// ------------------------------------------------------------------ etapas

/** La etapa que sigue: prospecto → propuesta → confirmado → realizado. */
export function siguienteEtapa(estado: string): Estado | null {
  const i = ETAPAS.indexOf(estado as (typeof ETAPAS)[number]);
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1] : null;
}

const TIPO_TITULO: Record<Tipo, string> = {
  cumpleanos: 'Cumpleaños',
  casamiento: 'Casamiento',
  corporativo: 'Evento',
  fin_de_ano: 'Fin de año',
  otro: 'Festejo',
};
const TIPO_SOLO: Record<Tipo, string> = {
  cumpleanos: 'Cumpleaños',
  casamiento: 'Casamiento',
  corporativo: 'Evento corporativo',
  fin_de_ano: 'Fiesta de fin de año',
  otro: 'Evento',
};

/**
 * "Casamiento de Ana", "Fin de año de Estudio Pérez SRL". En los festejos de
 * una persona va el primer nombre (así lo dice la gente); en los de empresa,
 * el nombre entero (una razón social cortada no se reconoce).
 */
export function nombreSugerido(tipo: string, nombre?: string | null): string {
  const t = (TIPOS as readonly string[]).includes(tipo) ? (tipo as Tipo) : 'otro';
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio) return TIPO_SOLO[t];
  const deEmpresa = t === 'corporativo' || t === 'fin_de_ano';
  const quien = deEmpresa ? limpio : limpio.split(' ')[0];
  return `${TIPO_TITULO[t]} de ${quien}`.slice(0, 120);
}

/**
 * Solo los dígitos de un WhatsApp; null si no es un teléfono con
 * característica (10 dígitos como mínimo: 11 2281-2200). Sin característica
 * no se puede encontrar al cliente ni escribirle.
 */
export function telefonoLimpio(t: unknown): string | null {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// ---------------------------------------------------------- validar datos

type Datos = Record<string, unknown>;

/**
 * Lo que llega del panel, revisado y con los nombres de columna de la base.
 * Tira un Error con el motivo en castellano (el servicio lo pasa como 400).
 * Solo devuelve lo que vino: sirve para el alta y para un cambio parcial.
 */
export function limpiarDatosEvento(dto: Datos): Datos {
  const fila: Datos = {};
  const texto = (k: string, max: number) => {
    if (dto[k] === undefined) return;
    const v = dto[k] == null ? '' : String(dto[k]).trim();
    if (v.length > max) throw new Error(`El campo ${k.replace('_', ' ')} es demasiado largo (máximo ${max} letras).`);
    fila[k] = v || null;
  };
  if (dto.tipo !== undefined) {
    if (!(TIPOS as readonly string[]).includes(String(dto.tipo))) throw new Error('El tipo de evento no es válido.');
    fila.tipo = dto.tipo;
  }
  if (dto.estado !== undefined) {
    if (!(ESTADOS as readonly string[]).includes(String(dto.estado))) throw new Error('La etapa del evento no es válida.');
    fila.estado = dto.estado;
  }
  if (dto.nombre !== undefined) {
    const n = String(dto.nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Falta el nombre del evento.');
    if (n.length > 120) throw new Error('El nombre del evento es demasiado largo (máximo 120 letras).');
    fila.nombre = n;
  }
  if (dto.fecha !== undefined) {
    if (dto.fecha === null || dto.fecha === '') fila.fecha = null;
    else if (esFechaISO(dto.fecha)) fila.fecha = dto.fecha;
    else throw new Error('La fecha no es válida.');
  }
  if (dto.invitados !== undefined) {
    if (dto.invitados === null || dto.invitados === '') fila.invitados = null;
    else {
      const n = Number(dto.invitados);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error('La cantidad de invitados no es válida.');
      fila.invitados = n;
    }
  }
  texto('notas', 4000);
  texto('lugar', 200);
  texto('contacto_nombre', 120);
  if (dto.contacto_telefono !== undefined) {
    if (dto.contacto_telefono === null || dto.contacto_telefono === '') fila.contacto_telefono = null;
    else {
      const t = telefonoLimpio(dto.contacto_telefono);
      if (!t) throw new Error('El WhatsApp del contacto no parece un teléfono (poné el número con característica).');
      fila.contacto_telefono = t;
    }
  }
  if (dto.origen !== undefined) {
    fila.origen = (ORIGENES as readonly string[]).includes(String(dto.origen)) ? dto.origen : 'manual';
  }
  if (dto.clienteId !== undefined) {
    const id = dto.clienteId == null || dto.clienteId === '' ? null : String(dto.clienteId);
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('El cliente no es válido.');
    fila.cliente_id = id;
  }
  return fila;
}

// ------------------------------------------- sin la migración: a las notas

/** Error de Supabase porque la columna todavía no existe (falta correr la migración). */
export function faltaColumna(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /column/i.test(error.message ?? '') && /(schema cache|does not exist)/i.test(error.message ?? '');
}

/**
 * Saca de la fila las columnas nuevas y las deja escritas en las notas, para
 * no perder el lugar ni el contacto si la migración todavía no se aplicó.
 * `notasActuales`: las que ya tiene el evento (en un cambio parcial).
 */
export function pasarExtrasANotas(fila: Datos, notasActuales?: string | null): Datos {
  const sin: Datos = { ...fila };
  const partes: string[] = [];
  if (sin.lugar) partes.push(`Lugar: ${sin.lugar}`);
  if (sin.contacto_nombre || sin.contacto_telefono) {
    partes.push(`Contacto: ${[sin.contacto_nombre, sin.contacto_telefono].filter(Boolean).join(' · ')}`);
  }
  for (const c of COLUMNAS_NUEVAS) delete sin[c];
  if (partes.length) {
    const base = sin.notas !== undefined ? (sin.notas as string | null) : notasActuales ?? null;
    const yaEsta = (p: string) => (base ?? '').includes(p);
    const nuevas = partes.filter((p) => !yaEsta(p));
    if (nuevas.length) sin.notas = [base, ...nuevas].filter(Boolean).join('\n');
  }
  return sin;
}

// ---------------------------------------------------- los números de arriba

export type FilaResumen = { estado: string; presupuesto?: number | string | null; fecha?: string | null };

export function resumenEventos(filas: FilaResumen[], hoy: string) {
  const porEtapa = Object.fromEntries(ESTADOS.map((e) => [e, { cantidad: 0, monto: 0 }])) as Record<Estado, { cantidad: number; monto: number }>;
  let proximos = 0;
  let semana = 0;
  let pasados = 0;
  for (const f of filas) {
    const e = porEtapa[f.estado as Estado];
    if (!e) continue;
    e.cantidad += 1;
    e.monto += Number(f.presupuesto) || 0;
    if (ABIERTOS.includes(f.estado as Estado) && f.fecha) {
      const d = diasEntre(hoy, f.fecha);
      if (d >= 0 && d <= 30) proximos += 1;
      if (d >= 0 && d <= 6) semana += 1;
      if (d < 0) pasados += 1;
    }
  }
  const ganados = porEtapa.confirmado.cantidad + porEtapa.realizado.cantidad;
  const decididos = ganados + porEtapa.cancelado.cantidad;
  return {
    proximos30: { cantidad: proximos, estaSemana: semana },
    /** Abiertos con la fecha ya pasada: hay que pasarlos a Realizado o cancelarlos. */
    fechaPasada: pasados,
    propuestas: { cantidad: porEtapa.propuesta.cantidad, monto: porEtapa.propuesta.monto, prospectos: porEtapa.prospecto.cantidad },
    confirmados: { cantidad: porEtapa.confirmado.cantidad, monto: porEtapa.confirmado.monto },
    /** Confirmados y realizados sobre todo lo decidido (los cancelados cuentan como perdidos). null si no hay nada decidido. */
    cierre: { tasa: decididos ? ganados / decididos : null, ganados, decididos },
    porEtapa,
  };
}

// ------------------------------------------------------------ oportunidades

export type EventoLiviano = {
  id: string;
  cliente_id: string | null;
  tipo: string;
  estado: string;
  fecha: string | null;
  creado_en: string;
};

export type Compra = { cliente_id: string | null; total: number | string; fecha: string };

/** Un evento de cumpleaños vigente del cliente (para mostrar "Ver evento" en vez de armar otro). */
export function eventoDeCumple(clienteId: string, eventos: EventoLiviano[], hoy: string): string | null {
  const ev = eventos.find(
    (e) =>
      e.cliente_id === clienteId &&
      e.tipo === 'cumpleanos' &&
      e.estado !== 'cancelado' &&
      (e.fecha ? diasEntre(hoy, e.fecha) >= -7 : diasEntre(e.creado_en, hoy) <= 90),
  );
  return ev?.id ?? null;
}

/**
 * La temporada de fin de año: fiestas del 1/11 al 31/1. En enero todavía se
 * mira la del año anterior. Un evento sin fecha cuenta si se creó desde agosto.
 */
export function temporadaFinDeAno(hoy: string) {
  const anio = Number(hoy.slice(0, 4)) - (hoy.slice(5, 7) === '01' ? 1 : 0);
  return { anio, desde: `${anio}-11-01`, hasta: `${anio + 1}-01-31`, creadoDesde: `${anio}-08-01` };
}

export function esEventoDeTemporada(e: EventoLiviano, t: ReturnType<typeof temporadaFinDeAno>): boolean {
  if (e.estado === 'cancelado' || (e.tipo !== 'fin_de_ano' && e.tipo !== 'corporativo')) return false;
  if (e.fecha) return e.fecha.slice(0, 10) >= t.desde && e.fecha.slice(0, 10) <= t.hasta;
  return e.creado_en.slice(0, 10) >= t.creadoDesde;
}

export type ClienteEmpresa = {
  id: string;
  nombre: string | null;
  razon_social?: string | null;
  cuit?: string | null;
  condicion_iva?: string | null;
  tipo?: string | null;
  mayorista?: boolean | null;
  telefono?: string | null;
};

/**
 * Empresa = responsable inscripto, CUIT de persona jurídica (30, 33, 34),
 * razón social cargada o mayorista. Un CUIT 20/23/27 de consumidor final es
 * una persona que pidió factura con su CUIT: no es una empresa.
 */
export function esEmpresa(c: ClienteEmpresa): boolean {
  const iva = (c.condicion_iva ?? '').toLowerCase().replace(/[\s_]+/g, ' ');
  if (iva.includes('responsable inscripto')) return true;
  if (/^3[034]\d{9}$/.test((c.cuit ?? '').replace(/\D/g, ''))) return true;
  if ((c.razon_social ?? '').trim()) return true;
  return c.tipo === 'mayorista' || c.mayorista === true;
}

export function empresasFinDeAno(empresas: ClienteEmpresa[], compras: Compra[], eventos: EventoLiviano[], hoy: string, tope = 12) {
  const temporada = temporadaFinDeAno(hoy);
  const desde = sumarDias(hoy, -365);
  const conEvento = new Set(eventos.filter((e) => e.cliente_id && esEventoDeTemporada(e, temporada)).map((e) => e.cliente_id));
  const porCliente = new Map<string, { compras: number; total: number; ultima: string | null }>();
  for (const c of compras) {
    if (!c.cliente_id || c.fecha.slice(0, 10) < desde) continue;
    const acc = porCliente.get(c.cliente_id) ?? { compras: 0, total: 0, ultima: null };
    acc.compras += 1;
    acc.total += Number(c.total) || 0;
    if (!acc.ultima || c.fecha > acc.ultima) acc.ultima = c.fecha;
    porCliente.set(c.cliente_id, acc);
  }
  const candidatas = empresas.filter(esEmpresa);
  const lista = candidatas
    .filter((c) => !conEvento.has(c.id))
    .map((c) => {
      const s = porCliente.get(c.id) ?? { compras: 0, total: 0, ultima: null };
      return {
        cliente_id: c.id,
        nombre: (c.razon_social ?? '').trim() || (c.nombre ?? '').trim() || 'Empresa sin nombre',
        telefono: c.telefono ?? null,
        cuit: c.cuit ?? null,
        compras: s.compras,
        total: Math.round(s.total),
        ultima: s.ultima,
      };
    })
    .sort((a, b) => b.total - a.total || b.compras - a.compras || a.nombre.localeCompare(b.nombre, 'es'));
  return {
    temporada: temporada.anio,
    lista: lista.slice(0, tope),
    /** Cuántas empresas hay en total sin evento esta temporada (la lista muestra las primeras). */
    pendientes: lista.length,
    yaTienen: candidatas.filter((c) => conEvento.has(c.id)).length,
  };
}

export const COMPRA_GRANDE = {
  /** Ventana para listar: compras de los últimos 60 días. */
  ventana: 60,
  /** El promedio sale de los últimos 90 días. */
  diasPromedio: 90,
  /** "Muy por encima": el doble del ticket promedio… */
  factor: 2,
  /** …pero nunca menos de $100.000 (con tickets chicos, el doble sigue siendo una compra común). */
  piso: 100_000,
  /** Con menos de 5 tickets el promedio no dice nada: se usa este umbral fijo. */
  minimoTickets: 5,
  umbralSinPromedio: 150_000,
};

/**
 * El umbral de "compra grande": el doble del ticket promedio de la casa en
 * los últimos 90 días, con piso. `tickets` son todas las compras del
 * período, con o sin cliente (puede ser una muestra: las últimas mil).
 */
export function umbralCompraGrande(tickets: Compra[], hoy: string) {
  const desde = sumarDias(hoy, -COMPRA_GRANDE.diasPromedio);
  const recientes = tickets.filter((t) => t.fecha.slice(0, 10) >= desde && Number(t.total) > 0);
  const promedio = recientes.length ? recientes.reduce((s, t) => s + Number(t.total), 0) / recientes.length : 0;
  const umbral =
    recientes.length >= COMPRA_GRANDE.minimoTickets
      ? Math.max(Math.round(COMPRA_GRANDE.factor * promedio), COMPRA_GRANDE.piso)
      : COMPRA_GRANDE.umbralSinPromedio;
  return { promedio, umbral, tickets: recientes.length };
}

/**
 * Clientes con un ticket muy por encima del promedio en los últimos 60 días:
 * probablemente compraron para un festejo, y el próximo se lo podemos armar
 * nosotros. Uno por cliente (su compra más grande). Se saltean los que ya
 * tienen un evento abierto o uno creado después de esa compra.
 * `candidatas`: las compras con cliente a revisar (por defecto, los mismos
 * tickets; el servicio las trae con su propia consulta por si la muestra del
 * promedio no llega a cubrir los 60 días).
 */
export function comprasGrandes(
  tickets: Compra[],
  eventos: EventoLiviano[],
  hoy: string,
  { tope = 12, candidatas = tickets }: { tope?: number; candidatas?: Compra[] } = {},
) {
  const { promedio, umbral, tickets: cuantos } = umbralCompraGrande(tickets, hoy);
  const desde = sumarDias(hoy, -COMPRA_GRANDE.ventana);
  const mayor = new Map<string, Compra>();
  for (const t of candidatas) {
    if (!t.cliente_id || t.fecha.slice(0, 10) < desde || Number(t.total) < umbral) continue;
    const previa = mayor.get(t.cliente_id);
    if (!previa || Number(t.total) > Number(previa.total)) mayor.set(t.cliente_id, t);
  }
  const yaAtendido = (clienteId: string, fechaCompra: string) =>
    eventos.some(
      (e) =>
        e.cliente_id === clienteId &&
        e.estado !== 'cancelado' &&
        (ABIERTOS.includes(e.estado as Estado) || e.creado_en.slice(0, 10) >= fechaCompra.slice(0, 10)),
    );
  const lista = [...mayor.values()]
    .filter((t) => !yaAtendido(t.cliente_id as string, t.fecha))
    .map((t) => ({
      cliente_id: t.cliente_id as string,
      total: Math.round(Number(t.total)),
      fecha: t.fecha,
      veces: promedio > 0 ? Math.round((Number(t.total) / promedio) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);
  return { promedio: Math.round(promedio), umbral, tickets: cuantos, lista: lista.slice(0, tope) };
}
