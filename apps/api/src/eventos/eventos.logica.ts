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

// Cerca de 900 clientes están cargados por lote o por barrio ("St Thomas 118
// Jimena", "Campos 147 Hector", "Lauquen Fr 18 Lote 10", "Cliente Trivento"):
// la primera palabra no es un nombre de pila. Sin tildes y en minúscula.
const NO_ES_NOMBRE = new Set([
  'st', 'sr', 'santa', 'san', 'campos', 'cliente', 'clientes', 'lauquen', 'los', 'las', 'la', 'el', 'solar',
  'lagos', 'ombu', 'venado', 'don', 'horqueta', 'evento', 'eventos', 'chopera', 'barrio', 'lote', 'rodal',
  'cruz', 'alameda', 'terralago', 'rocio', 'country', 'club', 'fr', 'ex', 'thomas', 'este', 'oeste', 'lista',
  'degustacion', 'nuevo', 'nueva', 'consumidor', 'final', 'mostrador', 'casa', 'l', 'y', 'o', 'de', 'del',
]);
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pareceNombre = (palabra: string) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}$/.test(palabra) && !NO_ES_NOMBRE.has(sinTildes(palabra));

/**
 * El nombre de pila de un cliente para el nombre del evento, o null si no se
 * puede saber. "Ana Pérez" → "Ana"; "St Thomas 118 Jimena" → "Jimena" (lo que
 * va después del lote); "Don Joaquin 196 (Martin)" → "Martin"; "Campos 51" o
 * "Cliente Trivento" → null.
 */
export function nombreDePila(nombre?: string | null): string | null {
  const palabras = (nombre ?? '').replace(/[()*"«»]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!palabras.length) return null;
  if (pareceNombre(palabras[0])) return palabras[0];
  // cargado por lote: el nombre, si está, va después del último número
  let ultimoNumero = -1;
  palabras.forEach((p, i) => {
    if (/\d/.test(p)) ultimoNumero = i;
  });
  const despues = ultimoNumero >= 0 ? palabras.slice(ultimoNumero + 1).find(pareceNombre) : undefined;
  return despues ? despues.charAt(0).toUpperCase() + despues.slice(1) : null;
}

/**
 * "Casamiento de Ana", "Fin de año de Estudio Pérez SRL". En los festejos de
 * una persona va el nombre de pila (así lo dice la gente); en los de empresa,
 * el nombre entero (una razón social cortada no se reconoce). Si el cliente
 * está cargado por lote y no hay un nombre de pila, solo el tipo.
 */
export function nombreSugerido(tipo: string, nombre?: string | null): string {
  const t = (TIPOS as readonly string[]).includes(tipo) ? (tipo as Tipo) : 'otro';
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim();
  const deEmpresa = t === 'corporativo' || t === 'fin_de_ano';
  const quien = deEmpresa ? limpio : nombreDePila(limpio);
  if (!quien) return TIPO_SOLO[t];
  return `${TIPO_TITULO[t]} de ${quien}`.slice(0, 120);
}

/**
 * Los diez dígitos de un teléfono argentino (característica + número), con la
 * misma regla que tel_diez() en la base: saca el 54, el 9, el 0 y el 15 de
 * después de la característica. null si no tiene largo de teléfono.
 */
export function telDiez(t: unknown): string | null {
  let d = String(t ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (d.startsWith('549')) d = d.slice(3);
  else if (d.startsWith('54')) d = d.slice(2).replace(/^0/, '');
  else d = d.replace(/^0/, '');
  if (d.length === 12) d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return d.length >= 10 && d.length <= 13 ? d.slice(-10) : null;
}

/** Una característica argentina empieza con 11, 2 o 3: "15 2281-2200" no tiene. */
const conCaracteristica = (diez: string) => /^(11\d{8}|[23]\d{9})$/.test(diez);

/**
 * El WhatsApp listo para buscar al cliente y escribirle: los diez dígitos
 * ("1122812200") de un número argentino con característica, o los dígitos tal
 * cual de uno de otro país ("+598…"). null si no se le puede escribir: sin
 * característica ("2281-2200") o con el 15 en su lugar ("15 2281-2200", como
 * se anota un celular en el AMBA: daría un cliente duplicado y un wa.me a un
 * número que no existe).
 */
export function telefonoLimpio(t: unknown): string | null {
  const crudo = String(t ?? '').trim();
  const d = crudo.replace(/\D/g, '');
  if (/^\+/.test(crudo) && !d.startsWith('54')) return d.length >= 8 && d.length <= 15 ? d : null;
  const diez = telDiez(d);
  return diez && conCaracteristica(diez) ? diez : null;
}

/** Por qué no sirve un WhatsApp (para el mensaje de error). */
export function motivoTelefono(t: unknown): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (/^15\d{8}$/.test(d)) {
    const numero = `${d.slice(2, 6)}-${d.slice(6)}`;
    return `Falta la característica: poné la del lugar en vez del 15 (en el AMBA, 11 ${numero} y no 15 ${numero}).`;
  }
  return 'El WhatsApp del contacto no parece un teléfono: poné el número con característica (por ejemplo 11 2281-2200).';
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
      if (!t) throw new Error(motivoTelefono(dto.contacto_telefono));
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

// ------------------------------------------------- renglones de la propuesta

export type ItemLimpio = { producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number };

/**
 * Los renglones de la propuesta, revisados. Un renglón puede ser un producto
 * del catálogo o uno libre (servicio de barra, hielo, envío: sin producto), y
 * el precio se puede cambiar (el acordado con el cliente, con descuento). Los
 * renglones sin descripción o sin cantidad se descartan (quedaron a medio
 * cargar); un precio negativo o un número que no es número es un error.
 */
export function limpiarItems(items: unknown): ItemLimpio[] {
  if (items != null && !Array.isArray(items)) throw new Error('La propuesta no es válida.');
  const salida: ItemLimpio[] = [];
  for (const crudo of (items ?? []) as any[]) {
    const descripcion = String(crudo?.descripcion ?? '').replace(/\s+/g, ' ').trim();
    const cantidad = Number(crudo?.cantidad);
    if (!descripcion || !(cantidad > 0)) continue;
    if (descripcion.length > 200) throw new Error(`«${descripcion.slice(0, 40)}…» es demasiado largo (máximo 200 letras).`);
    if (!Number.isFinite(cantidad) || cantidad > 100_000) throw new Error(`La cantidad de «${descripcion}» no es válida.`);
    const precio = crudo?.precio_unitario == null || crudo.precio_unitario === '' ? 0 : Number(crudo.precio_unitario);
    if (!Number.isFinite(precio) || precio < 0 || precio > 1e10) throw new Error(`El precio de «${descripcion}» no es válido.`);
    const id = crudo?.producto_id ? String(crudo.producto_id) : null;
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`El producto de «${descripcion}» no es válido.`);
    salida.push({ producto_id: id, descripcion, cantidad, precio_unitario: Math.round(precio * 100) / 100 });
  }
  return salida;
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
//
// 21/10/2026, revisión: un "no" también cuenta como trabajado. Cancelar con
// motivo es la forma de cerrar una oportunidad que no prosperó; si el evento
// cancelado no la tapaba, la empresa o el cliente que dijo que no volvía a la
// lista con "Armar propuesta" toda la temporada.

export type EventoLiviano = {
  id: string;
  cliente_id: string | null;
  tipo: string;
  estado: string;
  fecha: string | null;
  creado_en: string;
};

/** Una compra: pedido (con su estado) o venta del local. */
export type Compra = { cliente_id: string | null; total: number | string; fecha: string; estado?: string | null };

// ----------------------------------------------------------------- cumpleaños

const esBisiesto = (anio: number) => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/**
 * El próximo cumpleaños desde hoy (incluido hoy) y cuántos días faltan. El que
 * nació un 29/2 lo festeja el 28/2 los años que no son bisiestos.
 * Hasta el 21/10/2026 la cuenta la hacía cumpleanos_proximos() con age(), que
 * usa el día de Londres: el día del cumpleaños ya daba el del año que viene
 * (nadie "cumplía hoy") y desde las 21 h tampoco salía el de mañana.
 */
export function proximoCumple(nacimiento: string | null | undefined, hoy: string): { fecha: string; dias: number } | null {
  if (!nacimiento || !esFechaISO(nacimiento.slice(0, 10))) return null;
  const mes = Number(nacimiento.slice(5, 7));
  const dia = Number(nacimiento.slice(8, 10));
  const enAnio = (anio: number) => {
    const d = mes === 2 && dia === 29 && !esBisiesto(anio) ? 28 : dia;
    return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const anio = Number(hoy.slice(0, 4));
  const fecha = enAnio(anio) >= hoy ? enAnio(anio) : enAnio(anio + 1);
  return { fecha, dias: diasEntre(hoy, fecha) };
}

export type ClienteConNacimiento = { id: string; nombre: string | null; dni: string | null; fecha_nacimiento: string | null };

/** Los que cumplen entre hoy y dentro de `dias` días, los más cercanos primero. */
export function cumpleanosProximos(clientes: ClienteConNacimiento[], hoy: string, dias: number) {
  return clientes
    .map((c) => ({ c, prox: proximoCumple(c.fecha_nacimiento, hoy) }))
    .filter((x): x is { c: ClienteConNacimiento; prox: { fecha: string; dias: number } } => !!x.prox && x.prox.dias >= 0 && x.prox.dias <= dias)
    .sort((a, b) => a.prox.dias - b.prox.dias || (a.c.nombre ?? '').localeCompare(b.c.nombre ?? '', 'es'))
    .map(({ c, prox }) => ({ cliente_id: c.id, nombre: c.nombre, dni: c.dni, dias: prox.dias, fecha: prox.fecha }));
}

/**
 * El evento de este cumpleaños del cliente, abierto, hecho o cancelado (un
 * "no" también cierra la oportunidad). Con fecha: desde una semana antes de hoy
 * en adelante; sin fecha: creado en los últimos 90 días.
 */
export function eventoDeCumple(clienteId: string, eventos: EventoLiviano[], hoy: string): { id: string; estado: string } | null {
  const vigentes = eventos.filter(
    (e) =>
      e.cliente_id === clienteId &&
      e.tipo === 'cumpleanos' &&
      (e.fecha ? diasEntre(hoy, e.fecha) >= -7 : diasEntre(e.creado_en, hoy) <= 90),
  );
  // si hay uno en curso y otro cancelado, manda el que sigue vivo
  const ev = vigentes.find((e) => e.estado !== 'cancelado') ?? vigentes[0];
  return ev ? { id: ev.id, estado: ev.estado } : null;
}

// ------------------------------------------------------------- fin de año

/**
 * La temporada de fin de año: fiestas del 1/11 al 31/1. En enero todavía se
 * mira la del año anterior. Un evento sin fecha cuenta si se creó desde agosto.
 */
export function temporadaFinDeAno(hoy: string) {
  const anio = Number(hoy.slice(0, 4)) - (hoy.slice(5, 7) === '01' ? 1 : 0);
  return { anio, desde: `${anio}-11-01`, hasta: `${anio + 1}-01-31`, creadoDesde: `${anio}-08-01` };
}

/** Un evento de empresa de esta temporada, en cualquier etapa (también cancelado). */
export function esEventoDeTemporada(e: EventoLiviano, t: ReturnType<typeof temporadaFinDeAno>): boolean {
  if (e.tipo !== 'fin_de_ano' && e.tipo !== 'corporativo') return false;
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

/**
 * Las empresas para ofrecerles la fiesta de fin de año.
 *
 * 21/10/2026, revisión con la base: con solo "tiene CUIT de empresa" la lista
 * salía 100% ruido — 13 casas de barrio con un CUIT para facturar, cargadas
 * desde el sistema viejo, sin una sola compra ni charla, 5 con el teléfono
 * "15" y un dato de prueba. Ahora entra solo la empresa con alguna relación
 * real en los últimos 12 meses: una compra (pedido no cancelado o venta) o una
 * charla por WhatsApp con su teléfono (`conCharla`: los diez dígitos de los
 * teléfonos que escribieron). Las que no, se cuentan en `sinRelacion`.
 */
export function empresasFinDeAno(
  empresas: ClienteEmpresa[],
  compras: Compra[],
  eventos: EventoLiviano[],
  hoy: string,
  { conCharla = new Set<string>() }: { conCharla?: Set<string> } = {},
) {
  const temporada = temporadaFinDeAno(hoy);
  const desde = sumarDias(hoy, -365);
  const deTemporada = eventos.filter((e) => e.cliente_id && esEventoDeTemporada(e, temporada));
  const conEvento = new Set(deTemporada.filter((e) => e.estado !== 'cancelado').map((e) => e.cliente_id as string));
  const dijeronQueNo = new Set(deTemporada.filter((e) => e.estado === 'cancelado' && !conEvento.has(e.cliente_id as string)).map((e) => e.cliente_id as string));
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
  const yaTrabajada = (id: string) => conEvento.has(id) || dijeronQueNo.has(id);
  const libres = candidatas.filter((c) => !yaTrabajada(c.id));
  const conRelacion = libres.filter((c) => {
    const diez = telDiez(c.telefono);
    return porCliente.has(c.id) || (diez != null && conCharla.has(diez));
  });
  const lista = conRelacion
    .map((c) => {
      const s = porCliente.get(c.id) ?? { compras: 0, total: 0, ultima: null };
      return {
        cliente_id: c.id,
        nombre: (c.razon_social ?? '').trim() || (c.nombre ?? '').trim() || 'Empresa sin nombre',
        telefono: c.telefono ?? null,
        /** false: el teléfono cargado no sirve para escribirle ("15", sin característica). */
        whatsapp: telefonoLimpio(c.telefono) != null,
        cuit: c.cuit ?? null,
        compras: s.compras,
        total: Math.round(s.total),
        ultima: s.ultima,
      };
    })
    .sort((a, b) => b.total - a.total || b.compras - a.compras || a.nombre.localeCompare(b.nombre, 'es'));
  return {
    temporada: temporada.anio,
    /** Todas: son pocas (antes se cortaba en 12 y la 13.ª no se podía ver). */
    lista,
    pendientes: lista.length,
    yaTienen: candidatas.filter((c) => conEvento.has(c.id)).length,
    /** Las que tuvieron su evento esta temporada y lo cancelaron (dijeron que no). */
    dijeronQueNo: candidatas.filter((c) => dijeronQueNo.has(c.id)).length,
    /** Con CUIT de empresa pero sin compras ni charlas en el último año: no se ofrecen. */
    sinRelacion: libres.length - conRelacion.length,
  };
}

// ---------------------------------------------------------- compras grandes

/**
 * Los pedidos que cuentan como compra: los que avanzaron. Uno en "recibido"
 * cuenta solo si alguien de la casa lo tomó (tomado_en): el 16/10 un pedido de
 * $218.000 que el cliente canceló por chat seguía en "recibido" y salía como
 * la única compra grande.
 */
export const ESTADOS_COMPRA = ['pagado', 'en_preparacion', 'listo', 'en_camino', 'entregado'] as const;

export const COMPRA_GRANDE = {
  /** Ventana para listar: compras de los últimos 60 días. */
  ventana: 60,
  /** El pedido típico sale de los últimos 90 días. */
  diasBase: 90,
  /** "Muy por encima": el doble del pedido típico (la mediana)… */
  factor: 2,
  /** …pero nunca menos de $100.000 (con pedidos chicos, el doble sigue siendo una compra común). */
  piso: 100_000,
  /**
   * Con menos de 30 compras la mediana no dice nada: se usa el piso. El 21/10
   * había 9 (casi todos pedidos de WhatsApp: el mostrador no está en ODB) y el
   * promedio lo inflaba la misma compra que después se evaluaba.
   */
  minimoTickets: 30,
};

const mediana = (valores: number[]) => {
  if (!valores.length) return 0;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * El umbral de "compra grande": el doble del pedido típico (la mediana, que
 * una compra enorme no mueve) de los últimos 90 días, con piso de $100.000; si
 * hay menos de 30 compras, el piso solo. `regla` dice cuál se usó, para que la
 * pantalla lo explique bien.
 */
export function umbralCompraGrande(tickets: Compra[], hoy: string) {
  const desde = sumarDias(hoy, -COMPRA_GRANDE.diasBase);
  const recientes = tickets.filter((t) => t.fecha.slice(0, 10) >= desde && Number(t.total) > 0).map((t) => Number(t.total));
  const tipico = Math.round(mediana(recientes));
  const conBase = recientes.length >= COMPRA_GRANDE.minimoTickets;
  const doble = Math.round(COMPRA_GRANDE.factor * tipico);
  const umbral = conBase ? Math.max(doble, COMPRA_GRANDE.piso) : COMPRA_GRANDE.piso;
  const regla: 'doble' | 'piso' = conBase && doble >= COMPRA_GRANDE.piso ? 'doble' : 'piso';
  return { tipico: conBase ? tipico : null, umbral, regla, tickets: recientes.length };
}

/**
 * Clientes con una compra muy por encima de lo común en los últimos 60 días:
 * probablemente compraron para un festejo, y el próximo se lo podemos armar
 * nosotros. Uno por cliente (su compra más grande). Se saltean los que ya
 * tienen un evento abierto o uno creado después de esa compra (también si se
 * canceló: dijo que no).
 * `tickets`: las compras de los últimos 90 días, para el pedido típico.
 * `candidatas`: las compras con cliente a revisar (por defecto, los mismos
 * tickets; el servicio las trae con su propia consulta).
 */
export function comprasGrandes(
  tickets: Compra[],
  eventos: EventoLiviano[],
  hoy: string,
  { tope = 30, candidatas = tickets }: { tope?: number; candidatas?: Compra[] } = {},
) {
  const { tipico, umbral, regla, tickets: cuantos } = umbralCompraGrande(tickets, hoy);
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
        (ABIERTOS.includes(e.estado as Estado) || e.creado_en.slice(0, 10) >= fechaCompra.slice(0, 10)),
    );
  const lista = [...mayor.values()]
    .filter((t) => !yaAtendido(t.cliente_id as string, t.fecha))
    .map((t) => ({
      cliente_id: t.cliente_id as string,
      total: Math.round(Number(t.total)),
      fecha: t.fecha,
      /** El estado del pedido ("entregado", "recibido" tomado…); null si es una venta del local. */
      estado: t.estado ?? null,
      veces: tipico ? Math.round((Number(t.total) / tipico) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);
  return { tipico, umbral, regla, tickets: cuantos, lista: lista.slice(0, tope) };
}
