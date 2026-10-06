import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

// VARIAS LÍNEAS DE WHATSAPP CON EL MISMO BOT (Leandro, 6/10/2026): «necesitamos
// automatizar una nueva línea de ODB, mismo todo pero otra línea» y «comparte
// todo, está en otro lado de la sucursal». Un segundo número (otro sector de
// Saint Thomas) atiende con el MISMO bot de pedidos y la MISMA configuración
// (alias y CBU, a quién se derivan pagos y consultas, notas vigentes, reglas).
// Solo cambian el número y la sesión de WAHA.
//
// Lo que sabe este archivo, en un solo lugar (antes el código preguntaba
// «¿es la línea 'pedidos'?» en ~70 lugares y cada archivo tenía su propio
// nombre de sesión por defecto, 'odb' en unos y 'default' en otros):
//   · lineas_whatsapp.linea es el ID de cada número. Es la clave que usan
//     bot_conversaciones, bot_cotizaciones, etc. junto con el teléfono, así que
//     el mismo cliente en dos líneas son dos charlas distintas.
//   · tipo dice QUÉ hace la línea ('pedidos' o 'proveedores'). El
//     comportamiento depende del tipo, no del nombre.
//   · waha_sesion: por qué sesión de WAHA entra y sale todo lo de esa línea.
//     NULL = la de WAHA_SESSION (la línea de antes de la multilínea).
//   · comparte_config_de: la línea nueva no tiene configuración propia; usa la
//     de la línea madre. Se resuelve ACÁ, en cada lectura: una copia suelta se
//     desfasa sola el día que cambie el CBU o las notas del evento.
//   · los avisos internos (administración, reparto, compras, campanita) siguen
//     saliendo por la sesión principal, sin duplicarse; llevan el rótulo de la
//     línea de la charla (etiqueta), que es '' mientras haya una sola línea:
//     con una sola línea cargada todo se comporta igual que antes.
//
// Tolera la base de antes de la migración (db/migracion-multilinea.sql): lee
// con select('*'), así una columna que todavía no existe no rompe la consulta,
// y una fila sin tipo ni sesión se toma como la línea de siempre.

export type TipoLinea = 'pedidos' | 'proveedores';

/** La línea de siempre (11 2281-2200). No se renombra: al 6/10 tiene 582 charlas colgadas de ese nombre. */
export const LINEA_GENERAL = 'pedidos';

/** Lo que la línea madre le presta a la que comparte su configuración. */
export const CONFIG_COMPARTIDA = [
  'notas', 'derivar_pagos_a', 'avisar_proveedores_a', 'whatsapp_reparto', 'whatsapp_compras',
  'alias_pago', 'titular_pago', 'banco_pago', 'cbu_pago',
] as const;

export type FilaLinea = {
  linea: string;
  tipo?: string | null;
  nombre?: string | null;
  numero_legible?: string | null;
  numero_e164?: string | null;
  waha_sesion?: string | null;
  activa?: boolean | null;
  bot_activo?: boolean | null;
  bot_pausado_en?: string | null;
  comparte_config_de?: string | null;
  [k: string]: any;
};

/**
 * La sesión de WAHA de la línea principal: la de la variable WAHA_SESSION.
 * Antes había dos valores por defecto ('odb' para leer, 'default' para mandar);
 * vale el de mandar, que es el que demostradamente anda (6/10/2026).
 */
export function sesionPrincipal(): string {
  return process.env.WAHA_SESSION || 'default';
}

/** Un ID de línea válido: minúsculas, dígitos y guion bajo (va en claves y en filtros). */
export function nombreDeLineaValido(linea: unknown): linea is string {
  return typeof linea === 'string' && /^[a-z][a-z0-9_]{1,29}$/.test(linea);
}

/** El tipo de una línea: el de su fila; sin fila (o sin la columna), el de los dos nombres históricos. */
export function tipoDeLinea(linea: string, fila?: Partial<FilaLinea> | null): TipoLinea {
  const t = String(fila?.tipo ?? '').trim();
  if (t === 'pedidos' || t === 'proveedores') return t;
  return linea === 'proveedores' ? 'proveedores' : 'pedidos';
}

const digitos = (s: unknown) => String(s ?? '').split('@')[0].replace(/\D/g, '');
// la base devuelve una fila; algunas bases de prueba devuelven la lista entera
const una = (d: any) => (Array.isArray(d) ? (d[0] ?? null) : (d ?? null));
/** La sesión propia de una fila ('' = sin sesión propia: la de WAHA_SESSION). */
const sesionDe = (f: Partial<FilaLinea> | null | undefined) => String(f?.waha_sesion ?? '').trim();

export class Lineas {
  private cache: { hasta: number; filas: FilaLinea[] } | null = null;
  /** ¿Falló la última lectura de lineas_whatsapp? (revisión 6/10/2026) */
  private lecturaFallida = false;
  private readonly log = new Logger('Lineas');

  constructor(private readonly db: SupabaseClient) {}

  /**
   * Todas las filas de lineas_whatsapp (activas o no). Memoria de 60 s: se lee en cada mensaje.
   *
   * SI LA LECTURA FALLA (revisión 6/10/2026): antes se guardaba una lista VACÍA
   * por 60 s. Un corte de un segundo en Supabase justo al vencer la memoria
   * dejaba un minuto entero sin la línea nueva: sus mensajes se descartaban como
   * «sesión desconocida» y quedaba una alerta falsa en la campanita. Ahora se
   * sigue con lo último que se leyó bien y se reintenta a los 5 s; sin nada
   * leído antes, la lista vacía dura solo esos 5 s y queda marcado que falló
   * (deEntrada no confunde «no pude leer» con «esa sesión no es de nadie»).
   */
  async todas(): Promise<FilaLinea[]> {
    if (this.cache && this.cache.hasta > Date.now()) return this.cache.filas;
    let filas: FilaLinea[] | null = null;
    try {
      const { data, error } = await (this.db.from('lineas_whatsapp').select('*') as any);
      if (!error) {
        const crudas = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
        // una fila sin `linea` no se puede usar para elegir línea (bases de prueba viejas)
        filas = crudas.filter((f: any) => f && nombreDeLineaValido(f.linea));
      }
    } catch { /* sin base: abajo */ }
    if (!filas) {
      this.lecturaFallida = true;
      const previas = this.cache?.filas ?? [];
      this.cache = { hasta: Date.now() + 5_000, filas: previas };
      this.log.warn(`no pude leer lineas_whatsapp: sigo con lo último que leí (${previas.length} líneas) y reintento en 5 s`);
      return previas;
    }
    this.lecturaFallida = false;
    this.cache = { hasta: Date.now() + 60_000, filas };
    for (const f of this.enConflictoCon(filas)) {
      this.log.error(`la línea «${f.linea}» tiene waha_sesion = WAHA_SESSION, que es la de la línea general: se ignora esa fila y todo lo de esa sesión sigue siendo de «${LINEA_GENERAL}». Corregir waha_sesion en lineas_whatsapp.`);
    }
    return filas;
  }

  /** Después de cambiar una fila (el interruptor del panel), que no espere el minuto. */
  olvidar() {
    this.cache = null;
  }

  /**
   * LA SESIÓN DE LA LÍNEA GENERAL NO SE LA QUEDA OTRA FILA (revisión 6/10/2026).
   * 'pedidos' tiene waha_sesion NULL (= WAHA_SESSION) y el índice único de la
   * migración compara coalesce(waha_sesion, ''): una fila nueva cargada por error
   * con waha_sesion = el valor de WAHA_SESSION (p. ej. 'default') pasaba el
   * índice y le ganaba a la general en principal() y en deEntrada(). Todo lo del
   * 11 2281-2200 pasaba a ser de la línea nueva: 584 charlas sin memoria, los
   * avisos con otro rótulo y el interruptor de una línea apagada. Mientras la
   * general esté activa sin sesión propia, esa sesión es SUYA; la otra fila queda
   * en conflicto (log y alerta en la campanita desde el vigilante).
   */
  private enConflictoCon(filas: FilaLinea[]): FilaLinea[] {
    const env = sesionPrincipal();
    const activas = filas.filter((f) => f.activa !== false);
    const general = activas.find((f) => f.linea === LINEA_GENERAL && !sesionDe(f));
    if (!general) return [];
    return activas.filter((f) => f.linea !== LINEA_GENERAL && sesionDe(f) === env);
  }

  /** Las filas que reclaman la sesión de la línea general (para la alerta del vigilante). */
  async sesionEnConflicto(): Promise<FilaLinea[]> {
    return this.enConflictoCon(await this.todas());
  }

  async fila(linea: string | null | undefined): Promise<FilaLinea | null> {
    if (!linea) return null;
    return (await this.todas()).find((f) => f.linea === linea) ?? null;
  }

  async tipo(linea: string): Promise<TipoLinea> {
    return tipoDeLinea(linea, await this.fila(linea));
  }

  /** ¿Existe la línea? Las dos históricas existen siempre ('proveedores' nunca tuvo fila). */
  async existe(linea: unknown): Promise<boolean> {
    if (!nombreDeLineaValido(linea)) return false;
    if (linea === 'pedidos' || linea === 'proveedores') return true;
    return !!(await this.fila(linea));
  }

  /** Las líneas activas de un tipo (las del panel y los barridos). */
  async activas(tipo?: TipoLinea): Promise<FilaLinea[]> {
    return (await this.todas()).filter((f) => f.activa !== false && (!tipo || tipoDeLinea(f.linea, f) === tipo));
  }

  /** ¿Hay más de una línea de clientes atendiendo? Recién ahí los avisos dicen de qué línea vienen. */
  async varias(): Promise<boolean> {
    return (await this.activas('pedidos')).length > 1;
  }

  /**
   * La línea principal: la que usa la sesión de WAHA_SESSION, por donde salen
   * los avisos internos. Hoy, 'pedidos'.
   */
  async principal(): Promise<string> {
    const filas = await this.activas('pedidos');
    const env = sesionPrincipal();
    // la general sin sesión propia ES la de WAHA_SESSION: gana aunque otra fila
    // diga tener esa misma sesión (revisión 6/10/2026, ver enConflictoCon)
    return (
      filas.find((f) => !sesionDe(f) && f.linea === LINEA_GENERAL)
      ?? filas.find((f) => sesionDe(f) === env)
      ?? filas.find((f) => !sesionDe(f))
    )?.linea ?? LINEA_GENERAL;
  }

  async esPrincipal(linea: string | null | undefined): Promise<boolean> {
    return !linea || linea === (await this.principal());
  }

  /** La sesión de WAHA de una línea. Sin sesión propia (o sin fila), la principal. */
  async sesion(linea: string | null | undefined): Promise<string> {
    const f = await this.fila(linea);
    return String(f?.waha_sesion ?? '').trim() || sesionPrincipal();
  }

  /**
   * Por qué línea entró un mensaje de WAHA, en este orden: la sesión del evento
   * (la que WAHA manda siempre), el número propio del evento (me.id), el número
   * de la línea en la URL del webhook (?linea=) y, si nada de eso dice, la
   * principal.
   *
   * Una sesión que no es la de WAHA_SESSION ni la de ninguna línea devuelve
   * null y el mensaje no se atiende: contestarlo por la principal sería
   * escribirle al cliente desde otro número. Es lo que pasaría si se vincula el
   * teléfono nuevo antes de cargar su fila. Con la línea de siempre no cambia
   * nada: sus eventos traen la sesión de WAHA_SESSION, la misma con la que se
   * manda todo (si no coincidiera, el bot no podría mandar nada).
   */
  async deEntrada(o: { sesion?: string | null; me?: string | null; numero?: string | null }): Promise<{ linea: string | null; por: string; sinDatos?: boolean }> {
    const filas = (await this.todas()).filter((f) => f.activa !== false);
    const principal = await this.principal();
    const ses = String(o.sesion ?? '').trim();
    if (ses) {
      // la sesión de WAHA_SESSION es de la principal, aunque otra fila la
      // reclame por error (revisión 6/10/2026, ver enConflictoCon)
      if (ses === sesionPrincipal()) return { linea: principal, por: 'sesión principal' };
      const f = filas.find((x) => sesionDe(x) === ses);
      if (f) return { linea: f.linea, por: 'sesión' };
      // no se pudo leer la tabla: no es «una sesión de nadie». El mensaje no se
      // contesta ahora (sería por otro número) y lo levanta el barrido de cada
      // minuto, sin alerta falsa (revisión 6/10/2026)
      if (this.lecturaFallida) return { linea: null, por: `no pude leer las líneas para la sesión ${ses}: lo levanta el barrido`, sinDatos: true };
      return { linea: null, por: `sesión de WAHA desconocida (${ses})` };
    }
    for (const n of [o.me, o.numero].map(digitos).filter((d) => d.length >= 8)) {
      const f = filas.find((x) => digitos(x.numero_e164) === n);
      if (f) return { linea: f.linea, por: 'número de la línea' };
    }
    return { linea: principal, por: 'principal' };
  }

  /**
   * La configuración que usa una línea (alias, CBU, a quién se deriva, notas
   * vigentes): la de su fila, o la de la línea madre si comparte la suya. Lo
   * propio (número, sesión, bot_activo) sale siempre de su fila. Se lee sin
   * memoria, igual que antes: un cambio de CBU vale en el mensaje siguiente.
   */
  async config(linea: string): Promise<FilaLinea | null> {
    const { data } = await (this.db.from('lineas_whatsapp').select('*').eq('linea', linea).eq('activa', true).limit(1).maybeSingle() as any);
    const propia = una(data);
    if (!propia) return propia;
    // la madre puede, a su vez, copiar de otra: se sigue la cadena (hasta 3, sin vueltas)
    let m: FilaLinea | null = propia;
    const vistas = new Set<string>([linea]);
    for (let i = 0; i < 3; i++) {
      const madre = String(m?.comparte_config_de ?? '').trim();
      if (!madre || vistas.has(madre)) break;
      vistas.add(madre);
      const { data: dm } = await (this.db.from('lineas_whatsapp').select('*').eq('linea', madre).limit(1).maybeSingle() as any);
      const siguiente = una(dm);
      if (!siguiente) break;
      m = siguiente;
    }
    if (m === propia) return propia;
    const prestada: Record<string, unknown> = {};
    for (const k of CONFIG_COMPARTIDA) prestada[k] = m?.[k] ?? null;
    return { ...propia, ...prestada };
  }

  /**
   * Cómo se nombra la línea en los avisos internos: «Línea local (11 5555-1234)».
   * '' con una sola línea de clientes: los textos de siempre no cambian.
   */
  async etiqueta(linea: string | null | undefined): Promise<string> {
    if (!linea || !(await this.varias())) return '';
    return etiquetaDeFila(linea, await this.fila(linea));
  }
}

/** El rótulo de una fila, haya una línea o varias (el panel lo usa siempre). */
export function etiquetaDeFila(linea: string, f?: Partial<FilaLinea> | null): string {
  const nombre = String(f?.nombre ?? '').trim() || (linea === LINEA_GENERAL ? 'Línea general' : `Línea ${linea}`);
  const numero = String(f?.numero_legible ?? '').trim();
  return numero ? `${nombre} (${numero})` : nombre;
}
