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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

type ClienteDelEvento = { nombre?: string | null; razon_social?: string | null; dni?: string | null; telefono?: string | null };

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

type Cumple = { cliente_id: string; nombre: string | null; dni: string | null; dias: number; fecha: string; evento_id: string | null };
type Empresa = { cliente_id: string; nombre: string; telefono: string | null; compras: number; total: number; ultima: string | null };
type CompraGrande = { cliente_id: string; nombre: string | null; telefono: string | null; total: number; fecha: string; veces: number | null };

export type OportunidadesEventos = {
  hoy: string;
  cumpleanos: { dias: number; lista: Cumple[]; sinFecha: number | null };
  empresas: { temporada: number; lista: Empresa[]; pendientes: number; yaTienen: number } | null;
  comprasGrandes: { promedio: number; umbral: number; tickets: number; lista: CompraGrande[] } | null;
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

/** Igual que en el API (eventos.logica.ts → nombreSugerido). */
function nombreSugerido(tipo: Tipo, nombre?: string | null): string {
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim();
  const solo: Record<Tipo, string> = {
    cumpleanos: 'Cumpleaños',
    casamiento: 'Casamiento',
    corporativo: 'Evento corporativo',
    fin_de_ano: 'Fiesta de fin de año',
    otro: 'Evento',
  };
  if (!limpio) return solo[tipo];
  const titulo: Record<Tipo, string> = { cumpleanos: 'Cumpleaños', casamiento: 'Casamiento', corporativo: 'Evento', fin_de_ano: 'Fin de año', otro: 'Festejo' };
  return `${titulo[tipo]} de ${deEmpresa(tipo) ? limpio : limpio.split(' ')[0]}`.slice(0, 120);
}

const quienEs = (ev: Evento): string | null => {
  const c = ev.cliente;
  const deCliente = deEmpresa(ev.tipo) ? c?.razon_social || c?.nombre : c?.nombre || c?.razon_social;
  return deCliente || ev.contacto_nombre || null;
};
const telefonoDe = (ev: Evento): string | null => ev.contacto_telefono || ev.cliente?.telefono || null;

/** Enlace para abrir el chat de WhatsApp (no manda nada solo: lo escribe la persona). */
function enlaceWhatsApp(telefono: string, texto: string): string | null {
  const d = telefono.replace(/\D/g, '');
  if (d.length < 10) return null;
  const numeroWa = d.startsWith('54') ? d : d.length === 10 ? `549${d}` : d;
  return `https://wa.me/${numeroWa}?text=${encodeURIComponent(texto)}`;
}

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
}: {
  resumen: ResumenEventos | null;
  oportunidades: OportunidadesEventos | null;
  eventos: Evento[];
}) {
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
          {kpi.fechaPasada === 1 ? 'Hay un evento con la fecha pasada' : `Hay ${kpi.fechaPasada} eventos con la fecha pasada`} que sigue abierto: abrilo y
          marcalo como realizado o cancelalo, así los números de arriba dicen la verdad.
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
        <VistaOportunidades ops={ops} hoy={hoy} onArmar={setAlta} onAbrir={abrir} onReintentar={refrescar} />
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
  onArmar,
  onAbrir,
  onReintentar,
}: {
  ops: OportunidadesEventos | null;
  hoy: string;
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
            sub="Las que todavía no tienen su fiesta armada, por lo que compraron en el último año."
          />
          {!empresas ? (
            <p className="px-4 py-3 text-sm text-tinta/60 sm:px-5">No pude leer las empresas.</p>
          ) : empresas.lista.length === 0 ? (
            <Vacio
              titulo={empresas.yaTienen ? 'Todas las empresas ya tienen su evento' : 'No hay empresas identificadas'}
              texto={
                empresas.yaTienen
                  ? 'Las que tienen la fiesta de fin de año cargada no se repiten acá.'
                  : 'Aparecen los clientes con CUIT de empresa (30, 33 o 34), responsables inscriptos o mayoristas. Cargá el CUIT en la ficha del cliente.'
              }
              accion={
                <BotonLink href="/clientes" variante="secundario">
                  Ir a Clientes
                </BotonLink>
              }
            />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {empresasVisibles.map((e) => (
                <FilaOportunidad
                  key={e.cliente_id}
                  titulo={e.nombre}
                  detalle={
                    e.total > 0
                      ? `Compró ${pesos(e.total)} en ${e.compras} ${e.compras === 1 ? 'compra' : 'compras'}${e.ultima ? ` · la última el ${fecha(e.ultima, 'corta')}` : ''}`
                      : 'Sin compras registradas en el sistema todavía'
                  }
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
          {empresas && (empresas.pendientes > empresas.lista.length || empresas.yaTienen > 0) && (
            <p className="border-t border-black/[0.06] px-4 py-3 text-sm text-tinta/60 sm:px-5">
              {[
                empresas.pendientes > empresas.lista.length ? `Y ${empresas.pendientes - empresas.lista.length} más sin evento.` : null,
                empresas.yaTienen ? `${empresas.yaTienen} ya ${empresas.yaTienen === 1 ? 'tiene' : 'tienen'} su fin de año cargado.` : null,
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
            sub={
              comprasGrandes
                ? `Más de ${pesos(comprasGrandes.umbral)} en los últimos 60 días${comprasGrandes.tickets >= 5 ? ` (el doble del ticket promedio, ${pesos(comprasGrandes.promedio)})` : ''}: seguro festejaron algo. Ofreceles el próximo.`
                : 'Clientes con una compra muy por encima del promedio.'
            }
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
                  detalle={`${pesos(c.total)} el ${fecha(c.fecha, 'corta')}${c.veces ? ` · ${numero(c.veces, 1)} veces el promedio` : ''}`}
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
              texto="Solo aparecen los clientes con la fecha de nacimiento cargada."
              accion={
                <BotonLink href="/clientes" variante="secundario">
                  Cargar fechas en Clientes
                </BotonLink>
              }
            />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {cumpleanos.lista.map((c) => (
                <FilaOportunidad
                  key={c.cliente_id}
                  titulo={c.nombre || 'Cliente sin nombre'}
                  detalle={`${c.dias === 0 ? 'Cumple hoy' : c.dias === 1 ? 'Cumple mañana' : `Cumple en ${c.dias} días`} · ${fecha(c.fecha, 'dia')}`}
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
              {numero(cumpleanos.sinFecha)} clientes no tienen la fecha de nacimiento cargada. Pedila en Caja o por WhatsApp y cargala en su ficha.
            </p>
          )}
        </Tarjeta>
      </div>
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
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ClienteBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTel, setContactoTel] = useState('');
  const [tipo, setTipo] = useState<Tipo>('casamiento');
  const [nombre, setNombre] = useState('');
  const [fechaEv, setFechaEv] = useState('');
  const [invitados, setInvitados] = useState('');
  const [lugar, setLugar] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // cada vez que se abre arranca de cero (o con lo de la oportunidad)
  useEffect(() => {
    if (!abierto) return;
    setModo('cliente');
    setCliente(inicial.cliente ?? null);
    setQ('');
    setResultados([]);
    setContactoNombre('');
    setContactoTel('');
    setTipo(inicial.tipo ?? 'casamiento');
    setNombre('');
    setFechaEv(inicial.fecha ?? '');
    setInvitados('');
    setLugar('');
    setNotas('');
    setError(null);
  }, [abierto, inicial]);

  useEffect(() => {
    if (modo !== 'cliente' || cliente || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(q.trim())}`);
        if (r.ok) {
          const d = await r.json();
          setResultados((Array.isArray(d) ? d : d.clientes ?? d.items ?? []).slice(0, 6));
        }
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, modo, cliente]);

  const quien = modo === 'cliente' ? (cliente ? (deEmpresa(tipo) ? cliente.razon_social || cliente.nombre : cliente.nombre || cliente.razon_social) : null) : contactoNombre;
  const nombreFinal = nombre || nombreSugerido(tipo, quien);

  const crear = async () => {
    setError(null);
    if (modo === 'cliente' && !cliente) return setError('Elegí un cliente de la lista o pasá a «Contacto nuevo».');
    if (modo === 'contacto') {
      if (!contactoNombre.trim()) return setError('Falta el nombre del contacto.');
      if (contactoTel.replace(/\D/g, '').length < 10) return setError('Poné el WhatsApp con característica (por ejemplo 11 2281-2200).');
    }
    setGuardando(true);
    try {
      const ev = await pedir<Evento>(
        '/api/eventos',
        conJson('POST', {
          tipo,
          nombre: nombreFinal,
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
              <div className="space-y-1">
                <Entrada
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre, DNI o CUIT…"
                  aria-label="Buscar cliente"
                  autoComplete="off"
                />
                {resultados.length > 0 ? (
                  <ul className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
                    {resultados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setCliente(c);
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
                      <button type="button" onClick={() => { setModo('contacto'); setContactoNombre(q.trim()); }} className={unir('font-semibold text-marca-hondo underline', FOCO)}>
                        Cargarlo como contacto nuevo
                      </button>
                    </p>
                  )
                )}
              </div>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre" obligatorio>
                <Entrada value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} placeholder="Ana Pérez" autoComplete="off" />
              </Campo>
              <Campo etiqueta="WhatsApp" obligatorio ayuda="Con característica. Si ya es cliente, lo encuentra por el teléfono.">
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
          <Campo etiqueta="Nombre del evento" className="sm:col-span-2" ayuda={nombre ? undefined : 'Sugerido. Cambialo si querés.'}>
            <Entrada value={nombreFinal} onChange={(e) => setNombre(e.target.value)} />
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

        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// =============================================================== detalle

type Datos = { nombre: string; tipo: Tipo; fecha: string; invitados: string; lugar: string; notas: string };
const datosDe = (ev: Evento): Datos => ({
  nombre: ev.nombre ?? '',
  tipo: ev.tipo,
  fecha: ev.fecha ? ev.fecha.slice(0, 10) : '',
  invitados: ev.invitados == null ? '' : String(ev.invitados),
  lugar: ev.lugar ?? '',
  notas: ev.notas ?? '',
});
const firmaItems = (items: Item[]) => JSON.stringify(items.map((i) => [i.producto_id ?? null, i.descripcion, Number(i.cantidad), Number(i.precio_unitario)]));

function Detalle({ ev, hoy, onVolver, onCambio }: { ev: Evento; hoy: string; onVolver: () => void; onCambio: (ev: Evento) => void }) {
  const { confirmar, pedirTexto, dialogo } = useConfirmar();
  const [datos, setDatos] = useState<Datos>(() => datosDe(ev));
  const [base, setBase] = useState<Datos>(() => datosDe(ev));
  const [items, setItems] = useState<Item[]>(ev.items ?? []);
  const [itemsGuardados, setItemsGuardados] = useState(() => firmaItems(ev.items ?? []));
  const [moviendo, setMoviendo] = useState(false);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [guardandoPropuesta, setGuardandoPropuesta] = useState(false);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);

  const total = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
  const datosSucios = JSON.stringify(datos) !== JSON.stringify(base);
  const itemsSucios = firmaItems(items) !== itemsGuardados;
  const sig = SIGUIENTE[ev.estado];
  const ant = ANTERIOR[ev.estado];
  const abierto = ABIERTOS.includes(ev.estado);
  const quien = quienEs(ev);
  const tel = telefonoDe(ev);
  const wa = tel ? enlaceWhatsApp(tel, `Hola, le escribimos de O.D.B Premium Market por la propuesta de bebidas para «${ev.nombre}».`) : null;
  const d = ev.fecha ? diasHasta(hoy, ev.fecha) : null;
  const idx = ETAPAS.findIndex((e) => e.valor === ev.estado);

  useEffect(() => {
    if (q.length < 2) {
      setRes([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const dd = await r.json();
        setRes((dd.items ?? []).slice(0, 6));
      }
    }, 250);
    return () => clearTimeout(t);
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
      setMsg({ tono: 'ok', texto: estado === 'cancelado' ? 'El evento quedó cancelado.' : `El evento pasó a ${ESTADO_ETIQUETA[estado]}.` });
    } catch (e) {
      setMsg({ tono: 'error', texto: mensajeDe(e) });
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

  const guardarDatos = async () => {
    setGuardandoDatos(true);
    setMsg(null);
    try {
      const nuevo = await cambiar({
        nombre: datos.nombre,
        tipo: datos.tipo,
        fecha: datos.fecha || null,
        invitados: datos.invitados === '' ? null : Number(datos.invitados),
        lugar: datos.lugar,
        notas: datos.notas,
      });
      const limpio = datosDe(nuevo);
      // sin la migración, el lugar vuelve dentro de las notas: el campo queda como se escribió
      if (nuevo.lugar === undefined) limpio.lugar = datos.lugar;
      setDatos(limpio);
      setBase(limpio);
      setMsg({ tono: 'ok', texto: 'Se guardaron los datos del evento.' });
    } catch (e) {
      setMsg({ tono: 'error', texto: mensajeDe(e) });
    } finally {
      setGuardandoDatos(false);
    }
  };

  const guardarPropuesta = async (): Promise<boolean> => {
    setGuardandoPropuesta(true);
    setMsg(null);
    try {
      const r = await pedir<{ total: number }>(`/api/eventos/${ev.id}/propuesta`, conJson('POST', { items }));
      setItemsGuardados(firmaItems(items.filter((i) => i.descripcion && Number(i.cantidad) > 0)));
      onCambio(await pedir<Evento>(`/api/eventos/${ev.id}`));
      setMsg({ tono: 'ok', texto: `Propuesta guardada por ${pesos(r.total ?? 0)}.` });
      return true;
    } catch (e) {
      setMsg({ tono: 'error', texto: mensajeDe(e) });
      return false;
    } finally {
      setGuardandoPropuesta(false);
    }
  };

  const sugerir = async () => {
    setSugiriendo(true);
    setMsg(null);
    try {
      const r = await pedir<{ items: Item[] }>('/api/eventos/sugerir', conJson('POST', { tipo: datos.tipo, invitados: Number(datos.invitados) || 0 }));
      setItems(r.items ?? []);
      setMsg({ tono: 'ok', texto: `La IA sugirió ${r.items?.length ?? 0} productos. Revisalos y guardá la propuesta.` });
    } catch (e) {
      setMsg({ tono: 'error', texto: mensajeDe(e) });
    } finally {
      setSugiriendo(false);
    }
  };

  const enviar = async () => {
    if (itemsSucios && !(await guardarPropuesta())) return;
    setEnviando(true);
    setMsg(null);
    try {
      await pedir(`/api/eventos/${ev.id}/enviar`, { method: 'POST' });
      onCambio(await pedir<Evento>(`/api/eventos/${ev.id}`));
      setMsg({ tono: 'ok', texto: 'La propuesta le llegó al cliente como aviso en la app de ODB.' });
    } catch (e) {
      setMsg({ tono: 'error', texto: mensajeDe(e) });
    } finally {
      setEnviando(false);
    }
  };

  const agregar = (p: any) => {
    setItems((c) => [...c, { producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: Number(p.precio) || 0 }]);
    setQ('');
    setRes([]);
  };
  const editarCantidad = (i: number, val: number) => setItems((c) => c.map((it, idx2) => (idx2 === i ? { ...it, cantidad: val } : it)));
  const poner = (k: keyof Datos) => (e: { target: { value: string } }) => setDatos((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-6">
      <Boton
        variante="secundario"
        onClick={onVolver}
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
              {tel ? ` · ${tel}` : ''}
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
            <Boton onClick={() => pasarA(itemsGuardados !== '[]' ? 'propuesta' : 'prospecto')} cargando={moviendo}>
              Reabrir
            </Boton>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante: 'secundario' })}>
              Escribir por WhatsApp
            </a>
          )}
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

      {msg && <Aviso tono={msg.tono}>{msg.texto}</Aviso>}

      {/* Datos editables */}
      <Tarjeta relleno={false}>
        <TarjetaCabecera titulo="Datos del evento" sub={datosSucios ? 'Hay cambios sin guardar.' : undefined} />
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
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
          <Campo etiqueta="Notas" className="sm:col-span-2">
            <AreaTexto rows={3} value={datos.notas} onChange={poner('notas')} placeholder="Qué le gusta, presupuesto que mencionó, si lleva barra…" />
          </Campo>
        </div>
        {datosSucios && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-black/[0.06] px-4 py-3 sm:px-5">
            <Boton variante="secundario" onClick={() => setDatos(base)} disabled={guardandoDatos}>
              Descartar
            </Boton>
            <Boton onClick={guardarDatos} cargando={guardandoDatos}>
              Guardar cambios
            </Boton>
          </div>
        )}
      </Tarjeta>

      {/* La propuesta de bebidas, como Placa roja (pedido de Leandro, 2/10/2026:
          "siempre que se detallen productos vamos a usar el paquete gráfico de
          pedidos y lista de precio"). La cantidad va en el círculo y se sigue
          corrigiendo abajo de cada renglón; el total, en la píldora negra. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta/70">
          {items.length ? `${items.length} ${items.length === 1 ? 'producto' : 'productos'}` : 'Todavía sin productos.'}
          {itemsSucios ? ' Hay cambios sin guardar.' : ''}
        </p>
        <Boton variante="secundario" onClick={sugerir} cargando={sugiriendo}>
          {sugiriendo ? 'Pensando…' : 'Sugerir bebidas con IA'}
        </Boton>
      </div>
      <PlacaRoja
        titulo="Propuesta"
        sub={ev.nombre}
        renglones={items.map((it, i) => ({
          cantidad: it.cantidad,
          nombre: it.descripcion,
          detalle: `${numero(it.cantidad, 2)} × ${pesos(it.precio_unitario ?? 0)}`,
          importe: pesos(Number(it.cantidad) * Number(it.precio_unitario) || 0),
          acciones: (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-tinta/60">
                Cantidad
                <span className="w-24 shrink-0">
                  <Entrada
                    type="number"
                    inputMode="decimal"
                    value={it.cantidad}
                    onChange={(e) => editarCantidad(i, Number(e.target.value))}
                    aria-label={`Cantidad de ${it.descripcion}`}
                    className="text-center"
                  />
                </span>
              </label>
              <button
                type="button"
                onClick={() => setItems((c) => c.filter((_, idx2) => idx2 !== i))}
                aria-label={`Quitar ${it.descripcion}`}
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
          <div className="w-full min-w-0 space-y-1">
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
          </div>
        }
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Boton variante="secundario" onClick={guardarPropuesta} cargando={guardandoPropuesta} disabled={!itemsSucios || guardandoPropuesta}>
            Guardar propuesta
          </Boton>
          <a href={`/api/eventos/${ev.id}/presupuesto`} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante: 'secundario' })}>
            Descargar PDF
          </a>
          <Boton onClick={enviar} cargando={enviando} disabled={enviando || !ev.cliente_id || items.length === 0}>
            Enviar al cliente
          </Boton>
        </div>
        <p className="text-xs text-tinta/60">
          {!ev.cliente_id
            ? 'Para enviarla, el evento tiene que tener un cliente: descargá el PDF y mandalo por WhatsApp.'
            : '«Enviar al cliente» le deja la propuesta como aviso en la app de ODB. Para WhatsApp: descargá el PDF y usá «Escribir por WhatsApp».'}
        </p>
      </div>
      {dialogo}
    </div>
  );
}
