'use client';

// Eventos: vender cumpleaños, casamientos, corporativos y fiestas de fin de año.
//
// 21/10/2026 (Leandro la calificó de "basura"): arrancaba en una pestaña de
// cumpleaños que siempre estaba vacía (2 clientes con fecha de nacimiento
// sobre 6.749), con cuatro números en cero y el "Nuevo evento" escondido en la
// segunda pestaña. Ahora:
//  - "Nuevo evento" siempre arriba, en una ventana con buscador de clientes o
//    contacto nuevo (nombre + WhatsApp) y el nombre sugerido solo;
//  - la vista principal son los eventos por etapa (tablero en la compu,
//    chips en el celular), con lo de esta semana destacado;
//  - el detalle pasa de etapa con un botón y se puede editar;
//  - oportunidades que salen de lo que la base sí tiene: cumpleaños, empresas
//    para fin de año y compras grandes recientes, cada una con "Armar propuesta".
// La lógica de los números y las listas está en el API (eventos.logica.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fecha, hoyISO, numero, pesos, porcentaje } from '../lib/formato';
import {
  AreaTexto,
  Aviso,
  Boton,
  BotonLink,
  Campo,
  Chips,
  Entrada,
  Etiqueta,
  FOCO,
  FOCO_ADENTRO,
  IconoCerrar,
  Kpi,
  Modal,
  Pestanas,
  PlacaRoja,
  Selector,
  Tarjeta,
  TarjetaCabecera,
  Vacio,
  clasesBoton,
  unir,
  useConfirmar,
  type TonoEtiqueta,
} from './kit';

// ------------------------------------------------------------------ tipos

type Etapa = 'prospecto' | 'propuesta' | 'confirmado' | 'realizado';
type Estado = Etapa | 'cancelado';
type Tipo = 'cumpleanos' | 'casamiento' | 'corporativo' | 'fin_de_ano' | 'otro';

type Item = { producto_id?: string | null; descripcion: string; cantidad: number; precio_unitario: number };

type ClienteDelEvento = {
  nombre?: string | null;
  razon_social?: string | null;
  dni?: string | null;
  telefono?: string | null;
  /** Tiene la app de ODB con las notificaciones activadas (el API no manda el token). */
  tiene_app?: boolean;
};

export type Evento = {
  id: string;
  nombre: string;
  tipo: Tipo;
  estado: Estado;
  fecha: string | null;
  invitados: number | null;
  presupuesto: number | string | null;
  notas?: string | null;
  lugar?: string | null;
  contacto_nombre?: string | null;
  contacto_telefono?: string | null;
  cliente_id: string | null;
  cliente?: ClienteDelEvento | null;
  items?: Item[];
};

export type ResumenEventos = {
  hoy: string;
  proximos30: { cantidad: number; estaSemana: number };
  fechaPasada: number;
  propuestas: { cantidad: number; monto: number; prospectos: number };
  confirmados: { cantidad: number; monto: number };
  cierre: { tasa: number | null; ganados: number; decididos: number };
};

type Cumple = {
  cliente_id: string;
  nombre: string | null;
  dni: string | null;
  dias: number;
  fecha: string;
  evento_id: string | null;
  /** 'cancelado': dijo que no (la oportunidad ya se trabajó). */
  evento_estado?: string | null;
};
type Empresa = {
  cliente_id: string;
  nombre: string;
  telefono: string | null;
  /** false: el teléfono de la ficha no sirve para escribirle ("15", sin característica). */
  whatsapp?: boolean;
  compras: number;
  total: number;
  ultima: string | null;
};
type CompraGrande = { cliente_id: string; nombre: string | null; telefono: string | null; total: number; fecha: string; estado?: string | null; veces: number | null };

export type OportunidadesEventos = {
  hoy: string;
  cumpleanos: { dias: number; lista: Cumple[]; sinFecha: number | null };
  empresas: { temporada: number; lista: Empresa[]; pendientes: number; yaTienen: number; dijeronQueNo?: number; sinRelacion?: number } | null;
  comprasGrandes: { tipico: number | null; umbral: number; regla: 'doble' | 'piso'; tickets: number; lista: CompraGrande[] } | null;
  avisos: string[];
};

/** Con qué se abre la ventana de "Nuevo evento" (vacía, o desde una oportunidad). */
type Inicial = {
  tipo?: Tipo;
  cliente?: ClienteBuscado | null;
  fecha?: string | null;
  origen?: 'manual' | 'cumpleanos' | 'fin_de_ano' | 'compra_grande';
  motivo?: string;
};

type ClienteBuscado = { id: string; nombre: string | null; razon_social?: string | null; dni?: string | null; telefono?: string | null };

// ---------------------------------------------------------------- constantes

const ETAPAS: { valor: Etapa; etiqueta: string }[] = [
  { valor: 'prospecto', etiqueta: 'Prospecto' },
  { valor: 'propuesta', etiqueta: 'Propuesta' },
  { valor: 'confirmado', etiqueta: 'Confirmado' },
  { valor: 'realizado', etiqueta: 'Realizado' },
];
const ESTADO_ETIQUETA: Record<Estado, string> = {
  prospecto: 'Prospecto',
  propuesta: 'Propuesta',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};
const ESTADO_TONO: Record<Estado, TonoEtiqueta> = {
  prospecto: 'neutro',
  propuesta: 'info',
  confirmado: 'ok',
  realizado: 'neutro',
  cancelado: 'error',
};
const ABIERTOS: Estado[] = ['prospecto', 'propuesta', 'confirmado'];
const SIGUIENTE: Partial<Record<Estado, Etapa>> = { prospecto: 'propuesta', propuesta: 'confirmado', confirmado: 'realizado' };
const ANTERIOR: Partial<Record<Estado, Etapa>> = { propuesta: 'prospecto', confirmado: 'propuesta', realizado: 'confirmado' };
const TEXTO_PASAR: Record<Etapa, string> = {
  prospecto: 'Volver a Prospecto',
  propuesta: 'Pasar a Propuesta',
  confirmado: 'Pasar a Confirmado',
  realizado: 'Marcar como realizado',
};
const VACIO_COLUMNA: Record<Etapa, string> = {
  prospecto: 'Los eventos nuevos arrancan acá.',
  propuesta: 'Al guardar una propuesta, el evento pasa acá.',
  confirmado: 'Cuando el cliente confirma, pasalo acá.',
  realizado: 'Los eventos ya hechos.',
};

const TIPOS: { valor: Tipo; etiqueta: string }[] = [
  { valor: 'cumpleanos', etiqueta: 'Cumpleaños' },
  { valor: 'casamiento', etiqueta: 'Casamiento' },
  { valor: 'corporativo', etiqueta: 'Corporativo' },
  { valor: 'fin_de_ano', etiqueta: 'Fin de año' },
  { valor: 'otro', etiqueta: 'Otro' },
];
const tipoEtiqueta = (t: string) => TIPOS.find((x) => x.valor === t)?.etiqueta ?? 'Evento';
const deEmpresa = (t: string) => t === 'corporativo' || t === 'fin_de_ano';

const SIN_INICIAL: Inicial = {};

// ------------------------------------------------------------------ ayudas

const aDia = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** Días de hoy a la fecha (negativo si ya pasó). */
const diasHasta = (hoy: string, f: string) => Math.round((aDia(f.slice(0, 10)) - aDia(hoy)) / 86_400_000);

/** "Es hoy", "Es mañana", "Faltan 12 días", "Pasó hace 3 días". */
function cuandoFalta(d: number): string {
  if (d === 0) return 'Es hoy';
  if (d === 1) return 'Es mañana';
  if (d > 1) return `Faltan ${d} días`;
  return d === -1 ? 'Pasó ayer' : `Pasó hace ${-d} días`;
}

/** Fecha del evento: "sábado 12 de diciembre" este año; con el año si es otro. */
const fechaEvento = (f: string, hoy: string) => (f.slice(0, 4) === hoy.slice(0, 4) ? fecha(f, 'dia') : fecha(f, 'larga'));

// ---- igual que en el API (apps/api/src/eventos/eventos.logica.ts): si cambia allá, cambia acá

const NO_ES_NOMBRE = new Set([
  'st', 'sr', 'santa', 'san', 'campos', 'cliente', 'clientes', 'lauquen', 'los', 'las', 'la', 'el', 'solar',
  'lagos', 'ombu', 'venado', 'don', 'horqueta', 'evento', 'eventos', 'chopera', 'barrio', 'lote', 'rodal',
  'cruz', 'alameda', 'terralago', 'rocio', 'country', 'club', 'fr', 'ex', 'thomas', 'este', 'oeste', 'lista',
  'degustacion', 'nuevo', 'nueva', 'consumidor', 'final', 'mostrador', 'casa', 'l', 'y', 'o', 'de', 'del',
]);
const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pareceNombre = (p: string) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}$/.test(p) && !NO_ES_NOMBRE.has(sinTildes(p));

/** "Ana Pérez" → "Ana"; "St Thomas 118 Jimena" → "Jimena"; "Campos 51" → null. */
function nombreDePila(nombre?: string | null): string | null {
  const palabras = (nombre ?? '').replace(/[()*"«»]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!palabras.length) return null;
  if (pareceNombre(palabras[0])) return palabras[0];
  let ultimoNumero = -1;
  palabras.forEach((p, i) => {
    if (/\d/.test(p)) ultimoNumero = i;
  });
  const despues = ultimoNumero >= 0 ? palabras.slice(ultimoNumero + 1).find(pareceNombre) : undefined;
  return despues ? despues.charAt(0).toUpperCase() + despues.slice(1) : null;
}

function nombreSugerido(tipo: Tipo, nombre?: string | null): string {
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim();
  const solo: Record<Tipo, string> = {
    cumpleanos: 'Cumpleaños',
    casamiento: 'Casamiento',
    corporativo: 'Evento corporativo',
    fin_de_ano: 'Fiesta de fin de año',
    otro: 'Evento',
  };
  const quien = deEmpresa(tipo) ? limpio : nombreDePila(limpio);
  if (!quien) return solo[tipo];
  const titulo: Record<Tipo, string> = { cumpleanos: 'Cumpleaños', casamiento: 'Casamiento', corporativo: 'Evento', fin_de_ano: 'Fin de año', otro: 'Festejo' };
  return `${titulo[tipo]} de ${quien}`.slice(0, 120);
}

function telDiez(t: unknown): string | null {
  let d = String(t ?? '').replace(/\D/g, '').replace(/^00/, '');
  if (d.startsWith('549')) d = d.slice(3);
  else if (d.startsWith('54')) d = d.slice(2).replace(/^0/, '');
  else d = d.replace(/^0/, '');
  if (d.length === 12) d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return d.length >= 10 && d.length <= 13 ? d.slice(-10) : null;
}

/** Los diez dígitos de un WhatsApp argentino con característica (o uno de otro país con +); null si no sirve. */
function telefonoLimpio(t: unknown): string | null {
  const crudo = String(t ?? '').trim();
  const d = crudo.replace(/\D/g, '');
  if (/^\+/.test(crudo) && !d.startsWith('54')) return d.length >= 8 && d.length <= 15 ? d : null;
  const diez = telDiez(d);
  return diez && /^(11\d{8}|[23]\d{9})$/.test(diez) ? diez : null;
}

function motivoTelefono(t: unknown): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (/^15\d{8}$/.test(d)) {
    const n = `${d.slice(2, 6)}-${d.slice(6)}`;
    return `Falta la característica: poné la del lugar en vez del 15 (en el AMBA, 11 ${n} y no 15 ${n}).`;
  }
  return 'El WhatsApp del contacto no parece un teléfono: poné el número con característica (por ejemplo 11 2281-2200).';
}

// ---- fin de lo copiado del API

const quienEs = (ev: Evento): string | null => {
  const c = ev.cliente;
  const deCliente = deEmpresa(ev.tipo) ? c?.razon_social || c?.nombre : c?.nombre || c?.razon_social;
  return deCliente || ev.contacto_nombre || null;
};

/**
 * Sin la migración eventos-pro, el contacto que se carga queda escrito en las
 * notas ("Contacto: Ana · 1122812200", ver pasarExtrasANotas en el API): se lee
 * de ahí, el último que se cargó.
 */
function telefonoEnNotas(notas?: string | null): string | null {
  const lineas = [...(notas ?? '').matchAll(/^Contacto: (.+)$/gm)];
  const ultima = lineas.length ? lineas[lineas.length - 1][1] : '';
  const tel = ultima.split(' · ').pop()?.trim() ?? '';
  return /^\d{8,15}$/.test(tel) ? tel : null;
}

/** El WhatsApp del evento (el del contacto, si no el del cliente), solo si se le puede escribir. */
const telefonoDe = (ev: Evento): string | null =>
  [ev.contacto_telefono, telefonoEnNotas(ev.notas), ev.cliente?.telefono].map(telefonoLimpio).find(Boolean) ?? null;

/** Enlace para abrir el chat de WhatsApp (no manda nada solo: lo escribe la persona). */
function enlaceWhatsApp(telefono: string, texto: string): string | null {
  const t = telefonoLimpio(telefono);
  if (!t) return null;
  return `https://wa.me/${t.length === 10 ? `549${t}` : t}?text=${encodeURIComponent(texto)}`;
}

/** Cómo quedó el pedido de una compra grande. */
const ESTADO_COMPRA: Record<string, string> = {
  recibido: 'pedido tomado',
  pagado: 'pedido pagado',
  en_preparacion: 'pedido en preparación',
  listo: 'pedido listo',
  en_camino: 'pedido en camino',
  entregado: 'pedido entregado',
};

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (d as any)?.message;
    throw new Error(Array.isArray(m) ? m.join(' · ') : m || 'No se pudo completar. Probá de nuevo.');
  }
  return d as T;
}
const conJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : 'No se pudo completar. Probá de nuevo.');

function IconoMas({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ============================================================== la pantalla

export function EventosWorkspace({
  resumen,
  oportunidades,
  eventos,
  rol = null,
}: {
  resumen: ResumenEventos | null;
  oportunidades: OportunidadesEventos | null;
  eventos: Evento[];
  /** Del token (page.tsx): dejar el aviso en la app, borrar un evento y editar clientes es de gerente o dueño. */
  rol?: string | null;
}) {
  const esEncargado = rol === 'gerente' || rol === 'dueno';
  const [kpi, setKpi] = useState<ResumenEventos | null>(resumen);
  const [ops, setOps] = useState<OportunidadesEventos | null>(oportunidades);
  const [evs, setEvs] = useState<Evento[]>(Array.isArray(eventos) ? eventos : []);
  const [vista, setVista] = useState<'eventos' | 'oportunidades'>('eventos');
  const [sel, setSel] = useState<Evento | null>(null);
  const [alta, setAlta] = useState<Inicial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoy = kpi?.hoy ?? hoyISO();

  const refrescar = useCallback(async () => {
    const [a, b, c] = await Promise.allSettled([
      pedir<ResumenEventos>('/api/eventos/resumen'),
      pedir<OportunidadesEventos>('/api/eventos/oportunidades'),
      pedir<Evento[]>('/api/eventos'),
    ]);
    if (a.status === 'fulfilled') setKpi(a.value);
    if (b.status === 'fulfilled') setOps(b.value);
    if (c.status === 'fulfilled' && Array.isArray(c.value)) setEvs(c.value);
    const fallo = [a, b, c].find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(fallo ? mensajeDe(fallo.reason) : null);
  }, []);

  const abrir = useCallback(async (id: string) => {
    try {
      setError(null);
      setSel(await pedir<Evento>(`/api/eventos/${id}`));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, []);

  const cantOportunidades =
    (ops?.cumpleanos.lista.filter((c) => !c.evento_id).length ?? 0) + (ops?.empresas?.pendientes ?? 0) + (ops?.comprasGrandes?.lista.length ?? 0);
  const enCurso = evs.filter((e) => ABIERTOS.includes(e.estado)).length;

  const modal = (
    <NuevoEvento
      abierto={!!alta}
      inicial={alta ?? SIN_INICIAL}
      onCerrar={() => setAlta(null)}
      onCreado={(ev) => {
        setAlta(null);
        setSel({ ...ev, items: ev.items ?? [] });
        window.scrollTo({ top: 0 });
        refrescar();
      }}
    />
  );

  if (sel) {
    return (
      <>
        <Detalle
          key={sel.id}
          ev={sel}
          hoy={hoy}
          esEncargado={esEncargado}
          onCambio={setSel}
          onVolver={() => {
            setSel(null);
            refrescar();
          }}
        />
        {modal}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-56 text-sm text-tinta/70">
          {enCurso === 0
            ? 'Ningún evento en curso.'
            : `${enCurso} ${enCurso === 1 ? 'evento en curso' : 'eventos en curso'}${kpi?.proximos30.estaSemana ? ` · ${kpi.proximos30.estaSemana} esta semana` : ''}.`}
        </p>
        <Boton onClick={() => setAlta({ origen: 'manual' })} icono={<IconoMas />} className="w-full sm:w-auto">
          Nuevo evento
        </Boton>
      </div>

      {error && (
        <Aviso tono="error" titulo="No pude actualizar todo" accion={<Boton tamano="chico" variante="secundario" onClick={refrescar}>Reintentar</Boton>}>
          {error}
        </Aviso>
      )}

      {kpi && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            etiqueta={<span className="whitespace-normal">Próximos 30 días</span>}
            valor={numero(kpi.proximos30.cantidad)}
            sub={kpi.proximos30.estaSemana ? `${kpi.proximos30.estaSemana} esta semana` : 'Ninguno esta semana'}
            tono={kpi.proximos30.estaSemana ? 'atencion' : 'neutro'}
          />
          <Kpi
            etiqueta={<span className="whitespace-normal">Propuestas abiertas</span>}
            valor={pesos(kpi.propuestas.monto ?? 0)}
            sub={`${kpi.propuestas.cantidad} ${kpi.propuestas.cantidad === 1 ? 'propuesta' : 'propuestas'}${kpi.propuestas.prospectos ? ` · ${kpi.propuestas.prospectos} sin armar` : ''}`}
          />
          <Kpi
            etiqueta="Confirmados"
            valor={pesos(kpi.confirmados.monto ?? 0)}
            sub={`${kpi.confirmados.cantidad} ${kpi.confirmados.cantidad === 1 ? 'evento' : 'eventos'} por hacer`}
          />
          <Kpi
            etiqueta="Tasa de cierre"
            valor={kpi.cierre.tasa == null ? '—' : porcentaje(kpi.cierre.tasa, 0, { fraccion: true })}
            sub={kpi.cierre.decididos ? `${kpi.cierre.ganados} de ${kpi.cierre.decididos} decididos` : 'Todavía no se cerró ninguno'}
          />
        </div>
      )}

      {kpi && kpi.fechaPasada > 0 && (
        <Aviso tono="atencion">
          {kpi.fechaPasada === 1
            ? 'Hay un evento con la fecha pasada que sigue abierto: abrilo y marcalo como realizado o cancelalo, así los números de arriba dicen la verdad.'
            : `Hay ${kpi.fechaPasada} eventos con la fecha pasada que siguen abiertos: abrilos y marcalos como realizados o cancelalos, así los números de arriba dicen la verdad.`}
        </Aviso>
      )}

      <Pestanas
        etiquetaAccesible="Vistas de eventos"
        valor={vista}
        onCambiar={setVista}
        opciones={[
          { valor: 'eventos', etiqueta: 'Eventos', cuenta: evs.length },
          { valor: 'oportunidades', etiqueta: 'Oportunidades', cuenta: cantOportunidades },
        ]}
      />

      {vista === 'eventos' ? (
        <Tablero
          eventos={evs}
          hoy={hoy}
          onAbrir={abrir}
          onNuevo={() => setAlta({ origen: 'manual' })}
          onVerOportunidades={() => setVista('oportunidades')}
          cantOportunidades={cantOportunidades}
        />
      ) : (
        <VistaOportunidades ops={ops} hoy={hoy} esEncargado={esEncargado} onArmar={setAlta} onAbrir={abrir} onReintentar={refrescar} />
      )}

      {modal}
    </div>
  );
}

// ================================================================ tablero

function ordenar(lista: Evento[], estado: Estado | 'en_curso'): Evento[] {
  const cerrados = estado === 'realizado' || estado === 'cancelado';
  return [...lista].sort((a, b) => {
    if (!a.fecha && !b.fecha) return a.nombre.localeCompare(b.nombre, 'es');
    if (!a.fecha) return 1; // sin fecha, al final
    if (!b.fecha) return -1;
    return cerrados ? b.fecha.localeCompare(a.fecha) : a.fecha.localeCompare(b.fecha);
  });
}

const montoDe = (lista: Evento[]) => lista.reduce((s, e) => s + (Number(e.presupuesto) || 0), 0);

function Tablero({
  eventos,
  hoy,
  onAbrir,
  onNuevo,
  onVerOportunidades,
  cantOportunidades,
}: {
  eventos: Evento[];
  hoy: string;
  onAbrir: (id: string) => void;
  onNuevo: () => void;
  onVerOportunidades: () => void;
  cantOportunidades: number;
}) {
  const [filtro, setFiltro] = useState<'en_curso' | Estado>('en_curso');
  const [verTodosRealizados, setVerTodosRealizados] = useState(false);
  const [verCancelados, setVerCancelados] = useState(false);

  const porEstado = useMemo(() => {
    const m = {} as Record<Estado, Evento[]>;
    for (const e of ['prospecto', 'propuesta', 'confirmado', 'realizado', 'cancelado'] as Estado[]) {
      m[e] = ordenar(
        eventos.filter((x) => x.estado === e),
        e,
      );
    }
    return m;
  }, [eventos]);
  const enCurso = useMemo(() => ordenar(eventos.filter((e) => ABIERTOS.includes(e.estado)), 'en_curso'), [eventos]);

  if (eventos.length === 0) {
    return (
      <Vacio
        titulo="Todavía no hay eventos cargados"
        texto="Cargá el primero o arrancá desde una oportunidad: clientes que cumplen años, empresas para fin de año o clientes que hicieron una compra grande."
        accion={
          <>
            <Boton variante="secundario" onClick={onVerOportunidades}>
              {cantOportunidades ? `Ver ${cantOportunidades} oportunidades` : 'Ver oportunidades'}
            </Boton>
            <Boton variante="secundario" onClick={onNuevo}>
              Cargar un evento
            </Boton>
          </>
        }
      />
    );
  }

  const listaMovil = filtro === 'en_curso' ? enCurso : porEstado[filtro];
  const LIMITE_REALIZADOS = 6;

  return (
    <div className="space-y-4">
      {/* Compu grande: tablero de cuatro columnas, con cantidad y plata por columna */}
      <div className="hidden gap-3 xl:grid xl:grid-cols-4">
        {ETAPAS.map((et) => {
          const todos = porEstado[et.valor];
          const lista = et.valor === 'realizado' && !verTodosRealizados ? todos.slice(0, LIMITE_REALIZADOS) : todos;
          const monto = montoDe(todos);
          return (
            <section key={et.valor} aria-label={et.etiqueta} className="flex min-w-0 flex-col rounded-2xl bg-crema-hondo/60 p-2">
              <header className="flex flex-wrap items-baseline justify-between gap-x-2 px-2 pb-2 pt-1">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-tinta">
                  {et.etiqueta}
                  <span className="importe rounded-full bg-white px-1.5 text-xs font-semibold leading-5 text-tinta/70">{todos.length}</span>
                </h2>
                {monto > 0 && <span className="importe text-sm font-semibold text-tinta/70">{pesos(monto)}</span>}
              </header>
              <div className="space-y-2">
                {lista.map((e) => (
                  <TarjetaEvento key={e.id} ev={e} hoy={hoy} onAbrir={onAbrir} />
                ))}
                {todos.length === 0 && <p className="px-2 py-6 text-center text-sm text-tinta/60">{VACIO_COLUMNA[et.valor]}</p>}
                {et.valor === 'realizado' && todos.length > LIMITE_REALIZADOS && (
                  <Boton variante="fantasma" tamano="chico" anchoCompleto onClick={() => setVerTodosRealizados((v) => !v)}>
                    {verTodosRealizados ? 'Ver solo los últimos' : `Ver los ${todos.length}`}
                  </Boton>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {porEstado.cancelado.length > 0 && (
        <div className="hidden space-y-3 xl:block">
          <Boton variante="fantasma" tamano="chico" onClick={() => setVerCancelados((v) => !v)} aria-expanded={verCancelados}>
            {verCancelados ? 'Esconder cancelados' : `Ver cancelados (${porEstado.cancelado.length})`}
          </Boton>
          {verCancelados && (
            <div className="grid grid-cols-4 gap-3">
              {porEstado.cancelado.map((e) => (
                <TarjetaEvento key={e.id} ev={e} hoy={hoy} onAbrir={onAbrir} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Celular y compu chica: chips por etapa */}
      <div className="space-y-3 xl:hidden">
        <Chips
          etiquetaAccesible="Etapa del evento"
          desplazable
          valor={filtro}
          onCambiar={setFiltro}
          opciones={[
            { valor: 'en_curso', etiqueta: 'En curso', cuenta: enCurso.length },
            ...ETAPAS.map((et) => ({ valor: et.valor, etiqueta: et.etiqueta, cuenta: porEstado[et.valor].length })),
            { valor: 'cancelado', etiqueta: 'Cancelado', cuenta: porEstado.cancelado.length },
          ]}
        />
        {filtro !== 'en_curso' && listaMovil.length > 0 && montoDe(listaMovil) > 0 && (
          <p className="text-sm text-tinta/70">
            {listaMovil.length} {listaMovil.length === 1 ? 'evento' : 'eventos'} por <span className="importe font-semibold text-tinta">{pesos(montoDe(listaMovil))}</span>
          </p>
        )}
        {listaMovil.length === 0 ? (
          <Vacio
            titulo={filtro === 'en_curso' ? 'No hay eventos en curso' : `No hay eventos en ${ESTADO_ETIQUETA[filtro]}`}
            texto={filtro === 'en_curso' ? 'Cargá uno nuevo o mirá las oportunidades.' : undefined}
            accion={
              filtro === 'en_curso' ? (
                <Boton variante="secundario" onClick={onVerOportunidades}>
                  Ver oportunidades
                </Boton>
              ) : (
                <Boton variante="secundario" onClick={() => setFiltro('en_curso')}>
                  Ver los que están en curso
                </Boton>
              )
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {listaMovil.map((e) => (
              <TarjetaEvento key={e.id} ev={e} hoy={hoy} onAbrir={onAbrir} conEtapa={filtro === 'en_curso'} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TarjetaEvento({ ev, hoy, onAbrir, conEtapa = false }: { ev: Evento; hoy: string; onAbrir: (id: string) => void; conEtapa?: boolean }) {
  const abierto = ABIERTOS.includes(ev.estado);
  const d = ev.fecha ? diasHasta(hoy, ev.fecha) : null;
  const semana = abierto && d != null && d >= 0 && d <= 6;
  const pasada = abierto && d != null && d < 0;
  const monto = Number(ev.presupuesto) || 0;
  const quien = quienEs(ev);
  return (
    <button
      type="button"
      onClick={() => onAbrir(ev.id)}
      className={unir(
        'block w-full min-w-0 rounded-2xl border bg-white p-3 text-left shadow-tarjeta transition-colors hover:bg-crema-claro sm:p-4',
        semana ? 'border-atencion' : 'border-black/[0.06]',
        FOCO,
      )}
    >
      <span className="block break-words text-sm font-semibold text-tinta sm:text-base">{ev.nombre}</span>
      <span className={unir('mt-0.5 block truncate text-sm', quien ? 'text-tinta/70' : 'text-tinta/60')}>{quien ?? 'Sin cliente'}</span>
      <span className="mt-1 block text-sm text-tinta/60">
        {tipoEtiqueta(ev.tipo)} · {ev.fecha ? fechaEvento(ev.fecha, hoy) : 'Sin fecha'}
        {ev.invitados ? ` · ${numero(ev.invitados)} invitados` : ''}
      </span>
      {(conEtapa || (abierto && d != null) || monto > 0) && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {conEtapa && <Etiqueta tono={ESTADO_TONO[ev.estado]}>{ESTADO_ETIQUETA[ev.estado]}</Etiqueta>}
          {abierto && d != null && (
            <Etiqueta tono={semana ? 'atencion' : pasada ? 'error' : 'neutro'} punto={semana}>
              {semana && d > 1 ? `Esta semana · faltan ${d} días` : cuandoFalta(d)}
            </Etiqueta>
          )}
          {monto > 0 && <span className="importe ml-auto text-sm font-semibold text-tinta">{pesos(monto)}</span>}
        </span>
      )}
    </button>
  );
}

// ========================================================== oportunidades

/** En el celular, 12 empresas tapaban las compras grandes y los cumpleaños. */
const EMPRESAS_DE_ENTRADA = 5;

function FilaOportunidad({ titulo, detalle, accion }: { titulo: ReactNode; detalle: ReactNode; accion: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="break-words text-sm font-semibold text-tinta">{titulo}</p>
        <p className="text-sm text-tinta/60">{detalle}</p>
      </div>
      <div className="shrink-0">{accion}</div>
    </li>
  );
}

function VistaOportunidades({
  ops,
  hoy,
  esEncargado,
  onArmar,
  onAbrir,
  onReintentar,
}: {
  ops: OportunidadesEventos | null;
  hoy: string;
  esEncargado: boolean;
  onArmar: (i: Inicial) => void;
  onAbrir: (id: string) => void;
  onReintentar: () => void;
}) {
  const [verTodasEmpresas, setVerTodasEmpresas] = useState(false);
  if (!ops) {
    return (
      <Aviso tono="error" titulo="No pude leer las oportunidades" accion={<Boton tamano="chico" variante="secundario" onClick={onReintentar}>Reintentar</Boton>}>
        Probá de nuevo en un rato.
      </Aviso>
    );
  }
  const { cumpleanos, empresas, comprasGrandes } = ops;
  const empresasVisibles = empresas ? (verTodasEmpresas ? empresas.lista : empresas.lista.slice(0, EMPRESAS_DE_ENTRADA)) : [];
  const algunaCompro = !!empresas?.lista.some((e) => e.total > 0);
  const subCompras = (() => {
    if (!comprasGrandes) return 'Clientes con una compra muy por encima de lo común.';
    const { umbral, tipico, regla } = comprasGrandes;
    const porque =
      regla === 'doble' && tipico
        ? `el doble de un pedido típico, ${pesos(tipico)}`
        : tipico
          ? `un pedido típico es de ${pesos(tipico)}; tomamos ${pesos(umbral)} como mínimo`
          : `todavía hay pocas compras para saber cuánto es un pedido típico: tomamos ${pesos(umbral)} como mínimo`;
    return `Más de ${pesos(umbral)} en los últimos 60 días (${porque}): seguro festejaron algo. Ofreceles el próximo.`;
  })();
  return (
    <div className="space-y-4">
      {ops.avisos.length > 0 && (
        <Aviso tono="atencion" accion={<Boton tamano="chico" variante="secundario" onClick={onReintentar}>Reintentar</Boton>}>
          No pude leer: {ops.avisos.join(', ')}. Lo demás está al día.
        </Aviso>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        {/* Fin de año: la temporada fuerte, primero */}
        <Tarjeta relleno={false}>
          <TarjetaCabecera
            titulo={`Fin de año ${empresas?.temporada ?? hoy.slice(0, 4)}: empresas`}
            sub={
              empresas && empresas.lista.length > 0
                ? `Empresas que compraron o escribieron en el último año y todavía no tienen su fiesta armada${algunaCompro ? ', las que más compraron primero' : ''}.`
                : 'Empresas que compraron o escribieron en el último año.'
            }
          />
          {!empresas ? (
            <p className="px-4 py-3 text-sm text-tinta/60 sm:px-5">No pude leer las empresas.</p>
          ) : empresas.lista.length === 0 ? (
            <Vacio
              titulo={empresas.yaTienen || empresas.dijeronQueNo ? 'Ya se les ofreció a todas' : 'Ninguna empresa para ofrecer todavía'}
              texto={
                empresas.yaTienen || empresas.dijeronQueNo
                  ? 'Las que ya tienen su fiesta cargada, o dijeron que no esta temporada, no se repiten acá.'
                  : `Aparecen las empresas (CUIT 30, 33 o 34, responsables inscriptos o mayoristas) que compraron o escribieron por WhatsApp en el último año.${
                      empresas.sinRelacion ? ` Hay ${numero(empresas.sinRelacion)} con CUIT de empresa que no compraron ni escribieron: no se ofrecen.` : ''
                    }`
              }
              accion={
                <Boton variante="secundario" onClick={() => onArmar({ tipo: 'fin_de_ano', origen: 'fin_de_ano' })}>
                  Cargar una fiesta de fin de año
                </Boton>
              }
            />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {empresasVisibles.map((e) => (
                <FilaOportunidad
                  key={e.cliente_id}
                  titulo={e.nombre}
                  detalle={`${
                    e.total > 0
                      ? `Compró ${pesos(e.total)} en ${e.compras} ${e.compras === 1 ? 'compra' : 'compras'}${e.ultima ? ` · la última el ${fecha(e.ultima, 'corta')}` : ''}`
                      : 'Escribió por WhatsApp; todavía no compró'
                  }${e.whatsapp === false ? ' · sin un WhatsApp válido en su ficha' : ''}`}
                  accion={
                    <Boton
                      variante="secundario"
                      tamano="chico"
                      onClick={() =>
                        onArmar({
                          tipo: 'fin_de_ano',
                          origen: 'fin_de_ano',
                          cliente: { id: e.cliente_id, nombre: e.nombre, razon_social: e.nombre, telefono: e.telefono },
                          motivo: `Fin de año ${empresas.temporada}`,
                        })
                      }
                    >
                      Armar propuesta
                    </Boton>
                  }
                />
              ))}
            </ul>
          )}
          {empresas && empresas.lista.length > EMPRESAS_DE_ENTRADA && (
            <div className="border-t border-black/[0.06] px-4 py-2 sm:px-5">
              <Boton variante="fantasma" tamano="chico" onClick={() => setVerTodasEmpresas((v) => !v)} aria-expanded={verTodasEmpresas}>
                {verTodasEmpresas ? 'Ver menos' : `Ver las ${empresas.lista.length}`}
              </Boton>
            </div>
          )}
          {empresas && empresas.lista.length > 0 && (empresas.pendientes > empresas.lista.length || empresas.yaTienen > 0 || !!empresas.dijeronQueNo) && (
            <p className="border-t border-black/[0.06] px-4 py-3 text-sm text-tinta/60 sm:px-5">
              {[
                empresas.pendientes > empresas.lista.length ? `Y ${empresas.pendientes - empresas.lista.length} más sin evento.` : null,
                empresas.yaTienen ? `${empresas.yaTienen} ya ${empresas.yaTienen === 1 ? 'tiene' : 'tienen'} su fin de año cargado.` : null,
                empresas.dijeronQueNo ? `${empresas.dijeronQueNo} ${empresas.dijeronQueNo === 1 ? 'dijo' : 'dijeron'} que no esta temporada.` : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </Tarjeta>

        {/* Compras grandes */}
        <Tarjeta relleno={false}>
          <TarjetaCabecera
            titulo="Compras grandes"
            sub={subCompras}
          />
          {!comprasGrandes ? (
            <p className="px-4 py-3 text-sm text-tinta/60 sm:px-5">No pude leer las compras.</p>
          ) : comprasGrandes.lista.length === 0 ? (
            <Vacio
              titulo="Ninguna compra grande con cliente identificado"
              texto="Cuando un cliente identificado (pedido por WhatsApp, web o venta con cliente en Caja) compre por encima del umbral, aparece acá."
              accion={
                <Boton variante="secundario" onClick={() => onArmar({ origen: 'manual' })}>
                  Cargar un evento
                </Boton>
              }
            />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {comprasGrandes.lista.map((c) => (
                <FilaOportunidad
                  key={c.cliente_id}
                  titulo={c.nombre || 'Cliente sin nombre'}
                  detalle={`${pesos(c.total)} el ${fecha(c.fecha, 'corta')} · ${c.estado ? ESTADO_COMPRA[c.estado] ?? 'pedido' : 'venta en el local'}${
                    c.veces ? ` · ${numero(c.veces, 1)} veces un pedido típico` : ''
                  }`}
                  accion={
                    <Boton
                      variante="secundario"
                      tamano="chico"
                      onClick={() =>
                        onArmar({
                          tipo: 'otro',
                          origen: 'compra_grande',
                          cliente: { id: c.cliente_id, nombre: c.nombre, telefono: c.telefono },
                          motivo: `Compró ${pesos(c.total)} el ${fecha(c.fecha, 'corta')}`,
                        })
                      }
                    >
                      Armar propuesta
                    </Boton>
                  }
                />
              ))}
            </ul>
          )}
        </Tarjeta>

        {/* Cumpleaños */}
        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Cumpleaños" sub={`Clientes que cumplen en los próximos ${cumpleanos.dias} días.`} />
          {cumpleanos.lista.length === 0 ? (
            <Vacio
              titulo="Ningún cumpleaños cerca"
              texto={
                esEncargado
                  ? 'Solo aparecen los clientes con la fecha de nacimiento cargada: en Clientes, «Configurar» en la fila del cliente.'
                  : 'Solo aparecen los clientes con la fecha de nacimiento cargada. La carga un gerente o el dueño en Clientes.'
              }
              accion={
                esEncargado ? (
                  <BotonLink href="/clientes" variante="secundario">
                    Cargar fechas en Clientes
                  </BotonLink>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {cumpleanos.lista.map((c) => (
                <FilaOportunidad
                  key={c.cliente_id}
                  titulo={c.nombre || 'Cliente sin nombre'}
                  detalle={`${c.dias === 0 ? 'Cumple hoy' : c.dias === 1 ? 'Cumple mañana' : `Cumple en ${c.dias} días`} · ${fecha(c.fecha, 'dia')}${
                    c.evento_estado === 'cancelado' ? ' · dijo que no' : ''
                  }`}
                  accion={
                    c.evento_id ? (
                      <Boton variante="fantasma" tamano="chico" onClick={() => onAbrir(c.evento_id as string)}>
                        Ver evento
                      </Boton>
                    ) : (
                      <Boton
                        variante="secundario"
                        tamano="chico"
                        onClick={() =>
                          onArmar({
                            tipo: 'cumpleanos',
                            origen: 'cumpleanos',
                            fecha: c.fecha,
                            cliente: { id: c.cliente_id, nombre: c.nombre, dni: c.dni },
                            motivo: `Cumple el ${fecha(c.fecha, 'dia')}`,
                          })
                        }
                      >
                        Armar propuesta
                      </Boton>
                    )
                  }
                />
              ))}
            </ul>
          )}
          {cumpleanos.sinFecha != null && cumpleanos.sinFecha > 0 && (
            <p className="border-t border-black/[0.06] px-4 py-3 text-sm text-tinta/60 sm:px-5">
              {numero(cumpleanos.sinFecha)} clientes no tienen la fecha de nacimiento cargada. Pedila en Caja o por WhatsApp y cargala en Clientes
              («Configurar» en la fila del cliente{esEncargado ? '' : ', lo hace un gerente o el dueño'}).
            </p>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}

// ========================================================== buscar cliente

/** El buscador de clientes del alta y de "Cambiar cliente" en el evento. */
function BuscadorCliente({
  onElegir,
  onContactoNuevo,
  autoFocus = false,
}: {
  onElegir: (c: ClienteBuscado) => void;
  /** Si se pasa, cuando no encuentra a nadie ofrece cargarlo como contacto nuevo. */
  onContactoNuevo?: (texto: string) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ClienteBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    // una respuesta vieja que llega tarde no pisa la de lo que está escrito ahora
    let vigente = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(q.trim())}`);
        if (r.ok) {
          const d = await r.json();
          if (vigente) setResultados((Array.isArray(d) ? d : d.clientes ?? d.items ?? []).slice(0, 6));
        }
      } catch {
        // sin conexión: queda la lista como estaba
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  return (
    <div className="space-y-1">
      <Entrada
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, DNI o CUIT…"
        aria-label="Buscar cliente"
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {resultados.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(c);
                  setQ('');
                }}
                className={unir('flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-crema-claro', FOCO_ADENTRO)}
              >
                <span className="break-words text-sm font-medium text-tinta">{c.razon_social || c.nombre || 'Cliente sin nombre'}</span>
                <span className="text-xs text-tinta/60">{[c.telefono, c.dni ? `DNI ${c.dni}` : null].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        q.trim().length >= 2 &&
        !buscando && (
          <p className="text-sm text-tinta/60">
            No encontré a nadie con «{q.trim()}».{' '}
            {onContactoNuevo && (
              <button type="button" onClick={() => onContactoNuevo(q.trim())} className={unir('font-semibold text-marca-hondo underline', FOCO)}>
                Cargarlo como contacto nuevo
              </button>
            )}
          </p>
        )
      )}
    </div>
  );
}

// ========================================================== nuevo evento

function NuevoEvento({
  abierto,
  inicial,
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  inicial: Inicial;
  onCerrar: () => void;
  onCreado: (ev: Evento) => void;
}) {
  const [modo, setModo] = useState<'cliente' | 'contacto'>('cliente');
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  // cada apertura arranca el buscador de cero
  const [vez, setVez] = useState(0);
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTel, setContactoTel] = useState('');
  const [tipo, setTipo] = useState<Tipo>('casamiento');
  // null: no se tocó y se muestra el sugerido. Vacío también vale: se borró
  // para escribir de cero (antes se volvía a llenar solo y no se podía borrar).
  const [nombre, setNombre] = useState<string | null>(null);
  const [fechaEv, setFechaEv] = useState('');
  const [invitados, setInvitados] = useState('');
  const [lugar, setLugar] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // cada vez que se abre arranca de cero (o con lo de la oportunidad)
  useEffect(() => {
    if (!abierto) return;
    setModo('cliente');
    setCliente(inicial.cliente ?? null);
    setVez((v) => v + 1);
    setContactoNombre('');
    setContactoTel('');
    setTipo(inicial.tipo ?? 'casamiento');
    setNombre(null);
    setFechaEv(inicial.fecha ?? '');
    setInvitados('');
    setLugar('');
    setNotas('');
    setError(null);
  }, [abierto, inicial]);

  // el error va arriba del formulario y, si quedó fuera de la vista, se trae
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const quien = modo === 'cliente' ? (cliente ? (deEmpresa(tipo) ? cliente.razon_social || cliente.nombre : cliente.nombre || cliente.razon_social) : null) : contactoNombre;
  const sugerido = nombreSugerido(tipo, quien);
  const nombreFinal = nombre ?? sugerido;

  const crear = async () => {
    setError(null);
    if (modo === 'cliente' && !cliente) return setError('Elegí un cliente de la lista o pasá a «Contacto nuevo».');
    if (modo === 'contacto') {
      if (!contactoNombre.trim()) return setError('Falta el nombre del contacto.');
      if (!telefonoLimpio(contactoTel)) return setError(motivoTelefono(contactoTel));
    }
    setGuardando(true);
    try {
      const ev = await pedir<Evento>(
        '/api/eventos',
        conJson('POST', {
          tipo,
          nombre: nombreFinal.trim() || sugerido,
          fecha: fechaEv || null,
          invitados: invitados === '' ? null : Number(invitados),
          lugar: lugar.trim() || null,
          notas: notas.trim() || null,
          clienteId: modo === 'cliente' ? cliente?.id : null,
          contacto_nombre: modo === 'contacto' ? contactoNombre.trim() : null,
          contacto_telefono: modo === 'contacto' ? contactoTel : null,
          origen: inicial.origen ?? 'manual',
        }),
      );
      onCreado(ev);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo evento"
      descripcion={inicial.motivo ? `Desde la oportunidad: ${inicial.motivo}.` : 'Para quién es, qué festejan y cuándo. La propuesta de bebidas se arma después.'}
      bloquearCierre={guardando}
      cerrarAlTocarAfuera={false}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={crear} cargando={guardando}>
            Crear evento
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div ref={errorRef}>
            <Aviso tono="error">{error}</Aviso>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-tinta">¿Para quién?</p>
          <Chips
            etiquetaAccesible="Cliente o contacto nuevo"
            valor={modo}
            onCambiar={setModo}
            opciones={[
              { valor: 'cliente', etiqueta: 'Cliente de la base' },
              { valor: 'contacto', etiqueta: 'Contacto nuevo' },
            ]}
          />
          {modo === 'cliente' ? (
            cliente ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-black/15 bg-crema-claro px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-tinta">{cliente.razon_social || cliente.nombre || 'Cliente sin nombre'}</p>
                  <p className="text-sm text-tinta/60">{[cliente.telefono, cliente.dni ? `DNI ${cliente.dni}` : null].filter(Boolean).join(' · ') || 'Sin teléfono cargado'}</p>
                </div>
                <Boton variante="fantasma" tamano="chico" onClick={() => setCliente(null)}>
                  Cambiar
                </Boton>
              </div>
            ) : (
              <BuscadorCliente
                key={vez}
                onElegir={setCliente}
                onContactoNuevo={(texto) => {
                  setModo('contacto');
                  setContactoNombre(texto);
                }}
              />
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre" obligatorio>
                <Entrada value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} placeholder="Ana Pérez" autoComplete="off" />
              </Campo>
              <Campo etiqueta="WhatsApp" obligatorio ayuda="Con característica y sin el 15. Si ya es cliente, lo encuentra por el teléfono.">
                <Entrada type="tel" inputMode="tel" value={contactoTel} onChange={(e) => setContactoTel(e.target.value)} placeholder="11 2281-2200" autoComplete="off" />
              </Campo>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-tinta">¿Qué festejan?</p>
          <Chips etiquetaAccesible="Tipo de evento" valor={tipo} onCambiar={setTipo} opciones={TIPOS} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre del evento"
            className="sm:col-span-2"
            ayuda={nombre === null ? 'Sugerido. Cambialo si querés.' : nombre.trim() === '' ? `Si lo dejás vacío queda «${sugerido}».` : undefined}
          >
            <Entrada value={nombreFinal} onChange={(e) => setNombre(e.target.value)} placeholder={sugerido} />
          </Campo>
          <Campo etiqueta="Fecha">
            <Entrada type="date" value={fechaEv} onChange={(e) => setFechaEv(e.target.value)} />
          </Campo>
          <Campo etiqueta="Invitados">
            <Entrada type="number" inputMode="numeric" min={0} value={invitados} onChange={(e) => setInvitados(e.target.value)} placeholder="80" />
          </Campo>
          <Campo etiqueta="Lugar" className="sm:col-span-2">
            <Entrada value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Salón, quinta, oficina…" />
          </Campo>
          <Campo etiqueta="Notas" className="sm:col-span-2">
            <AreaTexto rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Qué le gusta, presupuesto que mencionó, si lleva barra…" />
          </Campo>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================== detalle

type Datos = { nombre: string; tipo: Tipo; fecha: string; invitados: string; lugar: string; contacto_nombre: string; contacto_telefono: string; notas: string };
const datosDe = (ev: Evento): Datos => ({
  nombre: ev.nombre ?? '',
  tipo: ev.tipo,
  fecha: ev.fecha ? ev.fecha.slice(0, 10) : '',
  invitados: ev.invitados == null ? '' : String(ev.invitados),
  lugar: ev.lugar ?? '',
  contacto_nombre: ev.contacto_nombre ?? '',
  contacto_telefono: ev.contacto_telefono ?? '',
  notas: ev.notas ?? '',
});
const itemsDe = (ev: Evento): Item[] =>
  (ev.items ?? []).map((i) => ({ producto_id: i.producto_id ?? null, descripcion: i.descripcion, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario) }));
const firmaItems = (items: Item[]) => JSON.stringify(items.map((i) => [i.producto_id ?? null, i.descripcion, Number(i.cantidad), Number(i.precio_unitario)]));

/**
 * Dónde sale cada mensaje: al lado de lo que se tocó. Antes había uno solo
 * debajo de la cabecera y el resultado de "Enviar" o "Sugerir" quedaba unos
 * 2.000 px más arriba del botón en el celular.
 */
type Zona = 'etapa' | 'datos' | 'ia' | 'propuesta';
type Mensaje = { zona: Zona; tono: 'ok' | 'error' | 'atencion'; texto: string; accion?: ReactNode };

function Detalle({
  ev,
  hoy,
  esEncargado,
  onVolver,
  onCambio,
}: {
  ev: Evento;
  hoy: string;
  esEncargado: boolean;
  onVolver: () => void;
  onCambio: (ev: Evento) => void;
}) {
  const { confirmar, pedirTexto, dialogo } = useConfirmar();
  const [datos, setDatos] = useState<Datos>(() => datosDe(ev));
  const [base, setBase] = useState<Datos>(() => datosDe(ev));
  const [items, setItems] = useState<Item[]>(() => itemsDe(ev));
  const [itemsBase, setItemsBase] = useState<Item[]>(() => itemsDe(ev));
  const [moviendo, setMoviendo] = useState(false);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [guardandoPropuesta, setGuardandoPropuesta] = useState(false);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const [avisoDejado, setAvisoDejado] = useState(false);
  const [bajandoPdf, setBajandoPdf] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [cambiandoCliente, setCambiandoCliente] = useState(false);
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const telRef = useRef<HTMLInputElement>(null);

  const total = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
  const datosSucios = JSON.stringify(datos) !== JSON.stringify(base);
  const itemsSucios = firmaItems(items) !== firmaItems(itemsBase);
  const sig = SIGUIENTE[ev.estado];
  const ant = ANTERIOR[ev.estado];
  const abierto = ABIERTOS.includes(ev.estado);
  const quien = quienEs(ev);
  const tel = telefonoDe(ev);
  const wa = tel ? enlaceWhatsApp(tel, `Hola, le escribimos de O.D.B Premium Market por la propuesta de bebidas para «${ev.nombre}».`) : null;
  const telCargado = ev.contacto_telefono || ev.cliente?.telefono || null;
  const tieneApp = !!ev.cliente?.tiene_app;
  const d = ev.fecha ? diasHasta(hoy, ev.fecha) : null;
  const idx = ETAPAS.findIndex((e) => e.valor === ev.estado);
  const urlPdf = `/api/eventos/${ev.id}/presupuesto`;

  const aviso = (zona: Zona) =>
    msg && msg.zona === zona ? (
      <Aviso tono={msg.tono} accion={msg.accion}>
        {msg.texto}
      </Aviso>
    ) : null;

  useEffect(() => {
    if (q.length < 2) {
      setRes([]);
      return;
    }
    // una respuesta vieja que llega tarde no pisa la de lo que está escrito ahora
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const dd = await r.json();
          if (vigente) setRes((dd.items ?? []).slice(0, 6));
        }
      } catch {
        // sin conexión: queda la lista como estaba
      }
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  const cambiar = async (patch: Record<string, unknown>) => {
    const nuevo = await pedir<Evento>(`/api/eventos/${ev.id}`, conJson('PATCH', patch));
    onCambio(nuevo);
    return nuevo;
  };

  const pasarA = async (estado: Estado, motivo?: string) => {
    setMoviendo(true);
    setMsg(null);
    try {
      await cambiar(motivo ? { estado, motivo } : { estado });
      setMsg({ zona: 'etapa', tono: 'ok', texto: estado === 'cancelado' ? 'El evento quedó cancelado.' : `El evento pasó a ${ESTADO_ETIQUETA[estado]}.` });
    } catch (e) {
      setMsg({ zona: 'etapa', tono: 'error', texto: mensajeDe(e) });
    } finally {
      setMoviendo(false);
    }
  };

  const avanzar = async () => {
    if (!sig) return;
    if (sig === 'realizado' && d != null && d > 0) {
      const ok = await confirmar({
        titulo: '¿Marcarlo como realizado?',
        texto: `La fecha del evento es el ${fecha(ev.fecha, 'larga')} y todavía no llegó.`,
        textoConfirmar: 'Marcar como realizado',
      });
      if (!ok) return;
    }
    await pasarA(sig);
  };

  const cancelar = async () => {
    const motivo = await pedirTexto({
      titulo: 'Cancelar el evento',
      texto: 'Queda en Cancelados y cuenta como perdido en la tasa de cierre. Se puede reabrir.',
      campo: { etiqueta: 'Motivo (opcional)', placeholder: 'Eligió otro proveedor, se suspendió…', multilinea: true },
      variante: 'peligro',
      textoConfirmar: 'Cancelar evento',
      textoCancelar: 'Volver',
    });
    if (motivo === null) return;
    await pasarA('cancelado', motivo.trim() || undefined);
  };

  const volver = async () => {
    if (datosSucios || itemsSucios) {
      const ok = await confirmar({
        titulo: '¿Salir sin guardar?',
        texto: 'La propuesta y los datos que cambiaste se pierden.',
        variante: 'peligro',
        textoConfirmar: 'Salir sin guardar',
        textoCancelar: 'Seguir editando',
      });
      if (!ok) return;
    }
    onVolver();
  };

  const eliminar = async () => {
    const ok = await confirmar({
      titulo: '¿Eliminar el evento?',
      texto: 'Es para un evento cargado por error o de prueba: se borra con su propuesta y no cuenta en la tasa de cierre. Si el cliente dijo que no, mejor cancelalo.',
      variante: 'peligro',
      textoConfirmar: 'Eliminar',
      textoCancelar: 'Volver',
    });
    if (!ok) return;
    setEliminando(true);
    setMsg(null);
    try {
      await pedir(`/api/eventos/${ev.id}`, { method: 'DELETE' });
      onVolver();
    } catch (e) {
      setMsg({ zona: 'etapa', tono: 'error', texto: mensajeDe(e) });
      setEliminando(false);
    }
  };

  const guardarDatos = async (): Promise<boolean> => {
    if (datos.contacto_telefono.trim() && !telefonoLimpio(datos.contacto_telefono)) {
      setMsg({ zona: 'datos', tono: 'error', texto: motivoTelefono(datos.contacto_telefono) });
      return false;
    }
    setGuardandoDatos(true);
    setMsg(null);
    try {
      const nuevo = await cambiar({
        nombre: datos.nombre,
        tipo: datos.tipo,
        fecha: datos.fecha || null,
        invitados: datos.invitados === '' ? null : Number(datos.invitados),
        lugar: datos.lugar,
        contacto_nombre: datos.contacto_nombre,
        contacto_telefono: datos.contacto_telefono,
        notas: datos.notas,
      });
      const limpio = datosDe(nuevo);
      // sin la migración, el lugar y el contacto vuelven dentro de las notas: los campos quedan como se escribieron
      if (nuevo.lugar === undefined) limpio.lugar = datos.lugar;
      if (nuevo.contacto_nombre === undefined) limpio.contacto_nombre = datos.contacto_nombre;
      if (nuevo.contacto_telefono === undefined) limpio.contacto_telefono = datos.contacto_telefono;
      setDatos(limpio);
      setBase(limpio);
      setMsg({ zona: 'datos', tono: 'ok', texto: 'Se guardaron los datos del evento.' });
      return true;
    } catch (e) {
      setMsg({ zona: 'datos', tono: 'error', texto: mensajeDe(e) });
      return false;
    } finally {
      setGuardandoDatos(false);
    }
  };

  const elegirCliente = async (c: ClienteBuscado) => {
    setMsg(null);
    try {
      await cambiar({ clienteId: c.id });
      setCambiandoCliente(false);
      setMsg({ zona: 'datos', tono: 'ok', texto: `El evento quedó a nombre de ${c.razon_social || c.nombre || 'ese cliente'}.` });
    } catch (e) {
      setMsg({ zona: 'datos', tono: 'error', texto: mensajeDe(e) });
    }
  };

  const guardarPropuesta = async (): Promise<boolean> => {
    if (items.some((i) => !i.descripcion.trim())) {
      setMsg({ zona: 'propuesta', tono: 'error', texto: 'Hay un renglón libre sin descripción: poné qué es (servicio de barra, hielo…) o quitalo.' });
      return false;
    }
    if (items.some((i) => !(Number(i.cantidad) > 0) || !(Number(i.precio_unitario) >= 0))) {
      setMsg({ zona: 'propuesta', tono: 'error', texto: 'Revisá las cantidades y los precios: tienen que ser números, la cantidad mayor que cero.' });
      return false;
    }
    setGuardandoPropuesta(true);
    setMsg(null);
    try {
      const r = await pedir<{ total: number }>(`/api/eventos/${ev.id}/propuesta`, conJson('POST', { items }));
      const nuevo = await pedir<Evento>(`/api/eventos/${ev.id}`);
      // lo guardado, como quedó en la base (redondeos incluidos)
      setItems(itemsDe(nuevo));
      setItemsBase(itemsDe(nuevo));
      onCambio(nuevo);
      setMsg({ zona: 'propuesta', tono: 'ok', texto: `Propuesta guardada por ${pesos(r.total ?? 0)}.` });
      return true;
    } catch (e) {
      setMsg({ zona: 'propuesta', tono: 'error', texto: mensajeDe(e) });
      return false;
    } finally {
      setGuardandoPropuesta(false);
    }
  };

  const sugerir = async () => {
    const previa = items;
    if (previa.length) {
      const ok = await confirmar({
        titulo: '¿Reemplazar la propuesta?',
        texto: `Ya tiene ${previa.length} ${previa.length === 1 ? 'renglón' : 'renglones'}. La IA arma una propuesta nueva y la reemplaza entera (después la podés deshacer).`,
        variante: 'peligro',
        textoConfirmar: 'Reemplazar con la IA',
        textoCancelar: 'Volver',
      });
      if (!ok) return;
    }
    setSugiriendo(true);
    setMsg(null);
    try {
      const r = await pedir<{ items: Item[] }>('/api/eventos/sugerir', conJson('POST', { tipo: datos.tipo, invitados: Number(datos.invitados) || 0 }));
      setItems(r.items ?? []);
      setMsg({
        zona: 'ia',
        tono: 'ok',
        texto: `La IA sugirió ${r.items?.length ?? 0} productos. Revisalos y guardá la propuesta.`,
        accion: previa.length ? (
          <Boton
            tamano="chico"
            variante="secundario"
            onClick={() => {
              setItems(previa);
              setMsg({ zona: 'ia', tono: 'ok', texto: 'Volvió la propuesta de antes.' });
            }}
          >
            Deshacer
          </Boton>
        ) : undefined,
      });
    } catch (e) {
      setMsg({ zona: 'ia', tono: 'error', texto: mensajeDe(e) });
    } finally {
      setSugiriendo(false);
    }
  };

  /** El PDF sale de lo guardado: si hay cambios, primero se guardan (si no, salía con los renglones viejos o en $0). */
  const bajarPdf = async () => {
    if (!itemsSucios && !datosSucios) {
      window.open(urlPdf, '_blank', 'noopener');
      return;
    }
    // la pestaña se abre ya, dentro del toque (si se abre después de guardar, el navegador la bloquea)
    const pestana = window.open('', '_blank');
    if (pestana) pestana.opener = null;
    setBajandoPdf(true);
    try {
      const okDatos = !datosSucios || (await guardarDatos());
      // el error de los datos sale acá, al lado del botón que se tocó
      if (!okDatos) setMsg((m) => (m ? { ...m, zona: 'propuesta', texto: `No bajé el PDF: ${m.texto}` } : m));
      const ok = okDatos && (!itemsSucios || (await guardarPropuesta()));
      if (ok && pestana) pestana.location.href = urlPdf;
      else if (ok) window.location.href = urlPdf;
      else pestana?.close();
    } finally {
      setBajandoPdf(false);
    }
  };

  /** Deja la propuesta como aviso en la app de ODB. Solo se ofrece si el cliente la usa. */
  const avisarEnLaApp = async () => {
    if (itemsSucios && !(await guardarPropuesta())) return;
    setAvisando(true);
    setMsg(null);
    try {
      const r = await pedir<{ push?: boolean }>(`/api/eventos/${ev.id}/enviar`, { method: 'POST' });
      onCambio(await pedir<Evento>(`/api/eventos/${ev.id}`));
      setAvisoDejado(true);
      setMsg({
        zona: 'propuesta',
        tono: r.push ? 'ok' : 'atencion',
        texto: r.push
          ? 'Le llegó la notificación al celular (app de ODB). Igual conviene mandarle el PDF por WhatsApp.'
          : 'Quedó como aviso en su cuenta de la app, pero no tiene las notificaciones activadas: no le llegó nada al celular. Mandale el PDF por WhatsApp.',
      });
    } catch (e) {
      setMsg({ zona: 'propuesta', tono: 'error', texto: mensajeDe(e) });
    } finally {
      setAvisando(false);
    }
  };

  const agregar = (p: any) => {
    setItems((c) => [...c, { producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: Number(p.precio) || 0 }]);
    setQ('');
    setRes([]);
  };
  const editarItem = (i: number, cambio: Partial<Item>) => setItems((c) => c.map((it, idx2) => (idx2 === i ? { ...it, ...cambio } : it)));
  const poner = (k: keyof Datos) => (e: { target: { value: string } }) => setDatos((x) => ({ ...x, [k]: e.target.value }));
  const irAlWhatsApp = () => {
    telRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    telRef.current?.focus({ preventScroll: true });
  };

  const botonWhatsApp = (variante: 'primario' | 'secundario') =>
    wa ? (
      <a href={wa} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante })}>
        Escribir por WhatsApp
      </a>
    ) : (
      <Boton variante="fantasma" onClick={irAlWhatsApp}>
        {telCargado ? 'El WhatsApp no sirve: corregilo' : 'Cargá el WhatsApp para escribirle'}
      </Boton>
    );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-6">
      <Boton
        variante="secundario"
        onClick={volver}
        icono={
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        }
      >
        Volver a eventos
      </Boton>

      {/* Cabecera: quién, cuándo, en qué etapa está y el paso que sigue */}
      <Tarjeta>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold text-tinta">{ev.nombre}</h2>
            <p className="break-words text-sm text-tinta/70">
              {tipoEtiqueta(ev.tipo)} · {quien ?? 'Sin cliente asociado'}
              {tel ? ` · ${tel}` : telCargado ? ` · ${telCargado} (no sirve para WhatsApp)` : ''}
            </p>
            <p className="text-sm text-tinta/60">
              {ev.fecha ? `${fecha(ev.fecha, 'larga')}${abierto && d != null ? ` · ${cuandoFalta(d)}` : ''}` : 'Sin fecha'}
              {ev.invitados ? ` · ${numero(ev.invitados)} invitados` : ''}
              {ev.lugar ? ` · ${ev.lugar}` : ''}
            </p>
          </div>
          <Etiqueta tono={ESTADO_TONO[ev.estado]} className="shrink-0">
            {ESTADO_ETIQUETA[ev.estado]}
          </Etiqueta>
        </div>

        <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Etapas del evento">
          {ETAPAS.map((et, i) => {
            const hecho = ev.estado !== 'cancelado' && idx >= i;
            const actual = idx === i;
            return (
              <li key={et.valor} className="min-w-0" aria-current={actual ? 'step' : undefined}>
                <span className={unir('block h-1.5 rounded-full', hecho ? 'bg-tinta' : 'bg-crema-hondo')} aria-hidden="true" />
                <span className={unir('mt-1 block truncate text-xs', actual ? 'font-semibold text-tinta' : 'text-tinta/60')}>{et.etiqueta}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sig && (
            <Boton onClick={avanzar} cargando={moviendo}>
              {TEXTO_PASAR[sig]}
            </Boton>
          )}
          {ev.estado === 'cancelado' && (
            <Boton onClick={() => pasarA(itemsBase.length ? 'propuesta' : 'prospecto')} cargando={moviendo}>
              Reabrir
            </Boton>
          )}
          {botonWhatsApp('secundario')}
          {ant && (
            <Boton variante="fantasma" onClick={() => pasarA(ant)} disabled={moviendo}>
              {`Volver a ${ESTADO_ETIQUETA[ant]}`}
            </Boton>
          )}
          {abierto && (
            <Boton variante="peligro" onClick={cancelar} disabled={moviendo} className="sm:ml-auto">
              Cancelar evento
            </Boton>
          )}
        </div>
      </Tarjeta>

      {aviso('etapa')}

      {/* Datos editables */}
      <Tarjeta relleno={false}>
        <TarjetaCabecera titulo="Datos del evento" sub={datosSucios ? 'Hay cambios sin guardar.' : undefined} />
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-tinta">Cliente</p>
            {cambiandoCliente ? (
              <div className="space-y-2">
                <BuscadorCliente onElegir={elegirCliente} autoFocus />
                <Boton variante="fantasma" tamano="chico" onClick={() => setCambiandoCliente(false)}>
                  No cambiar
                </Boton>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-black/15 bg-crema-claro px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-tinta">
                    {ev.cliente ? ev.cliente.razon_social || ev.cliente.nombre || 'Cliente sin nombre' : 'Sin cliente'}
                  </p>
                  <p className="text-sm text-tinta/60">
                    {ev.cliente
                      ? [ev.cliente.telefono, ev.cliente.dni ? `DNI ${ev.cliente.dni}` : null].filter(Boolean).join(' · ') || 'Sin teléfono cargado'
                      : 'Vinculalo a un cliente para que quede en su ficha.'}
                  </p>
                </div>
                <Boton variante="fantasma" tamano="chico" onClick={() => setCambiandoCliente(true)}>
                  {ev.cliente ? 'Cambiar cliente' : 'Elegir cliente'}
                </Boton>
              </div>
            )}
          </div>
          <Campo etiqueta="Nombre" className="sm:col-span-2">
            <Entrada value={datos.nombre} onChange={poner('nombre')} />
          </Campo>
          <Campo etiqueta="Tipo">
            <Selector value={datos.tipo} onChange={poner('tipo')} opciones={TIPOS} />
          </Campo>
          <Campo etiqueta="Fecha">
            <Entrada type="date" value={datos.fecha} onChange={poner('fecha')} />
          </Campo>
          <Campo etiqueta="Invitados">
            <Entrada type="number" inputMode="numeric" min={0} value={datos.invitados} onChange={poner('invitados')} />
          </Campo>
          <Campo etiqueta="Lugar">
            <Entrada value={datos.lugar} onChange={poner('lugar')} placeholder="Salón, quinta, oficina…" />
          </Campo>
          <Campo etiqueta="Contacto" ayuda="Quién habla por el evento, si no es el cliente.">
            <Entrada value={datos.contacto_nombre} onChange={poner('contacto_nombre')} placeholder="La novia, la secretaria…" autoComplete="off" />
          </Campo>
          <Campo etiqueta="WhatsApp del contacto" ayuda={tel ? 'Si lo dejás vacío se usa el del cliente.' : 'Con característica y sin el 15: 11 2281-2200.'}>
            <Entrada ref={telRef} type="tel" inputMode="tel" value={datos.contacto_telefono} onChange={poner('contacto_telefono')} placeholder="11 2281-2200" autoComplete="off" />
          </Campo>
          <Campo etiqueta="Notas" className="sm:col-span-2">
            <AreaTexto rows={3} value={datos.notas} onChange={poner('notas')} placeholder="Qué le gusta, presupuesto que mencionó, si lleva barra…" />
          </Campo>
        </div>
        {(datosSucios || msg?.zona === 'datos') && (
          <div className="space-y-3 border-t border-black/[0.06] px-4 py-3 sm:px-5">
            {aviso('datos')}
            {datosSucios && (
              <div className="flex flex-wrap justify-end gap-2">
                <Boton variante="secundario" onClick={() => setDatos(base)} disabled={guardandoDatos}>
                  Descartar
                </Boton>
                <Boton onClick={guardarDatos} cargando={guardandoDatos}>
                  Guardar cambios
                </Boton>
              </div>
            )}
          </div>
        )}
      </Tarjeta>

      {/* La propuesta de bebidas, como Placa roja (pedido de Leandro, 2/10/2026:
          "siempre que se detallen productos vamos a usar el paquete gráfico de
          pedidos y lista de precio"). La cantidad va en el círculo; abajo de
          cada renglón se corrigen la cantidad y el precio (el acordado con el
          cliente). Los renglones libres (servicio de barra, hielo, envío) no
          son productos del catálogo. El total, en la píldora negra. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta/70">
          {items.length ? `${items.length} ${items.length === 1 ? 'renglón' : 'renglones'}` : 'Todavía sin productos.'}
          {itemsSucios ? ' Hay cambios sin guardar.' : ''}
        </p>
        <Boton variante="secundario" onClick={sugerir} cargando={sugiriendo}>
          {sugiriendo ? 'Pensando…' : 'Sugerir bebidas con IA'}
        </Boton>
      </div>
      {aviso('ia')}
      <PlacaRoja
        titulo="Propuesta"
        sub={ev.nombre}
        renglones={items.map((it, i) => ({
          cantidad: it.cantidad,
          nombre: it.descripcion || 'Renglón libre (poné qué es)',
          detalle: `${numero(it.cantidad, 2)} × ${pesos(it.precio_unitario ?? 0)}${it.producto_id ? '' : ' · renglón libre'}`,
          importe: pesos(Number(it.cantidad) * Number(it.precio_unitario) || 0),
          acciones: (
            <div className="flex flex-wrap items-end gap-2">
              {!it.producto_id && (
                <label className="flex min-w-0 basis-full flex-col gap-1 text-sm text-tinta/60">
                  Qué es
                  <Entrada
                    value={it.descripcion}
                    onChange={(e) => editarItem(i, { descripcion: e.target.value })}
                    placeholder="Servicio de barra, hielo, copas, envío…"
                    aria-label="Descripción del renglón libre"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm text-tinta/60">
                Cantidad
                <span className="w-24 shrink-0">
                  <Entrada
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={it.cantidad}
                    onChange={(e) => editarItem(i, { cantidad: Number(e.target.value) })}
                    aria-label={`Cantidad de ${it.descripcion || 'el renglón libre'}`}
                    className="text-center"
                  />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm text-tinta/60">
                Precio unitario
                <span className="w-36 shrink-0">
                  <Entrada
                    type="number"
                    inputMode="decimal"
                    min={0}
                    prefijo="$"
                    value={it.precio_unitario}
                    onChange={(e) => editarItem(i, { precio_unitario: Number(e.target.value) })}
                    aria-label={`Precio unitario de ${it.descripcion || 'el renglón libre'}`}
                  />
                </span>
              </label>
              <button
                type="button"
                onClick={() => setItems((c) => c.filter((_, idx2) => idx2 !== i))}
                aria-label={`Quitar ${it.descripcion || 'el renglón libre'}`}
                className={unir('ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-marca-suave hover:text-marca-hondo', FOCO)}
              >
                <IconoCerrar className="size-5" />
              </button>
            </div>
          ),
        }))}
        total={items.length > 0 ? { etiqueta: 'Total', valor: pesos(total) } : undefined}
        pie={items.length === 0 ? `Sin productos. Usá «Sugerir bebidas con IA»${datos.invitados ? '' : ' (cargá antes los invitados)'} o buscá abajo.` : undefined}
        acciones={
          // la placa recorta lo que se le sale (overflow-hidden por las puntas
          // redondeadas): los resultados van debajo del campo, no flotando encima
          <div className="w-full min-w-0 space-y-2">
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Agregar producto…" aria-label="Agregar producto" />
            {res.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
                {res.map((p) => (
                  <button
                    key={p.sku ?? p.id}
                    type="button"
                    onClick={() => agregar(p)}
                    className={unir('flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-tinta hover:bg-crema-claro', FOCO_ADENTRO)}
                  >
                    <span className="min-w-0 break-words">{p.nombre}</span>
                    <span className="importe shrink-0 text-tinta/60">{pesos(p.precio ?? 0)}</span>
                  </button>
                ))}
              </div>
            )}
            <Boton
              variante="fantasma"
              tamano="chico"
              icono={<IconoMas className="size-4" />}
              onClick={() => setItems((c) => [...c, { producto_id: null, descripcion: '', cantidad: 1, precio_unitario: 0 }])}
            >
              Renglón libre (servicio, hielo, envío…)
            </Boton>
          </div>
        }
      />

      <div className="space-y-2">
        {aviso('propuesta')}
        <div className="flex flex-wrap items-center gap-2">
          {botonWhatsApp('primario')}
          <Boton variante="secundario" onClick={bajarPdf} cargando={bajandoPdf} disabled={bajandoPdf || (items.length === 0 && !itemsSucios)}>
            {itemsSucios || datosSucios ? 'Guardar y bajar PDF' : 'Descargar PDF'}
          </Boton>
          <Boton variante="secundario" onClick={guardarPropuesta} cargando={guardandoPropuesta} disabled={!itemsSucios || guardandoPropuesta}>
            Guardar propuesta
          </Boton>
          {itemsSucios && (
            <Boton variante="fantasma" onClick={() => setItems(itemsBase)} disabled={guardandoPropuesta}>
              Descartar cambios
            </Boton>
          )}
          {tieneApp && esEncargado && (
            <Boton variante="secundario" onClick={avisarEnLaApp} cargando={avisando} disabled={avisando || avisoDejado || items.length === 0}>
              {avisoDejado ? 'Aviso dejado ✓' : 'Dejar aviso en la app'}
            </Boton>
          )}
        </div>
        <p className="text-xs text-tinta/60">
          Para mandarla: «Descargar PDF» y adjuntalo en el chat que abre «Escribir por WhatsApp».
          {tieneApp ? (esEncargado ? ' Este cliente usa la app de ODB: también le podés dejar el aviso ahí.' : ' Este cliente usa la app de ODB: el aviso ahí lo deja un gerente o el dueño.') : ''}
        </p>
      </div>

      {esEncargado && (
        <div className="border-t border-black/[0.06] pt-4">
          <Boton variante="fantasma" tamano="chico" onClick={eliminar} cargando={eliminando}>
            Eliminar evento (cargado por error)
          </Boton>
        </div>
      )}
      {dialogo}
    </div>
  );
}
