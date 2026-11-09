'use client';

import { useEffect, useMemo, useState } from 'react';
import { Aviso, Cargando, FOCO, ROTULO, Tarjeta, unir, Vacio } from './kit';

// MANTENIMIENTO (Leandro, 9/11/2026: «6 horas de programación de mantenimiento
// mensuales… qué hicimos, sobre qué trabajamos, qué se mejoró, si fueron
// arreglos, bugs, propuestas o mejoras, quién las pidió, cuándo y todo… bien
// gráfico»). Cada trabajo publicado entra solo (scripts/mantenimiento-sync.mjs
// corre al final de cada publicación). Todo número y toda barra se tocan y
// filtran la lista de abajo.

type Tipo = 'bug' | 'arreglo' | 'mejora' | 'nuevo' | 'propuesta';
type Trabajo = {
  hash: string; publicado_en: string; mes: string; tipo: Tipo; area: string; titulo: string; que_se_hizo: string;
  para_que: string | null; pidio: string | null; pedido_el: string | null; cita: string | null; mensaje: string;
  minutos: number; partes: string[]; archivos: number; lineas: number;
};
type Respuesta = { horasAbono: number; trabajos: Trabajo[] };
type Filtro = { tipo?: Tipo; area?: string; pidio?: string; dia?: string };

const TIPOS: { tipo: Tipo; nombre: string; plural: string; fondo: string; texto: string; suave: string; borde: string; explica: string }[] = [
  { tipo: 'bug', nombre: 'Bug', plural: 'Bugs resueltos', fondo: 'bg-marca', texto: 'text-marca-hondo', suave: 'bg-marca-suave', borde: 'border-l-marca', explica: 'Algo fallaba o daba error' },
  { tipo: 'arreglo', nombre: 'Arreglo', plural: 'Arreglos', fondo: 'bg-dato-2', texto: 'text-dato-2', suave: 'bg-dato-2/10', borde: 'border-l-dato-2', explica: 'Andaba, pero no como lo necesita el negocio' },
  { tipo: 'mejora', nombre: 'Mejora', plural: 'Mejoras', fondo: 'bg-dato-1', texto: 'text-dato-1', suave: 'bg-dato-1/10', borde: 'border-l-dato-1', explica: 'Algo que ya existía quedó mejor' },
  { tipo: 'nuevo', nombre: 'Nuevo', plural: 'Funciones nuevas', fondo: 'bg-dato-3', texto: 'text-dato-3', suave: 'bg-dato-3/10', borde: 'border-l-dato-3', explica: 'Una pantalla o función que no existía' },
  { tipo: 'propuesta', nombre: 'Propuesta', plural: 'Propuestas de MetoGroup', fondo: 'bg-ok', texto: 'text-ok', suave: 'bg-ok-suave', borde: 'border-l-ok', explica: 'Una idea nuestra, sin que nadie la pidiera' },
];
const DE_TIPO = Object.fromEntries(TIPOS.map((t) => [t.tipo, t])) as Record<Tipo, (typeof TIPOS)[number]>;

const PARTES: Record<string, string> = { panel: 'Panel', sistema: 'Sistema', tienda: 'Tienda web', app: 'App', caja: 'Caja', base: 'Base de datos', servidor: 'Servidor' };
const ZONA = 'America/Argentina/Buenos_Aires';
const SIN_PEDIDO = 'Sin registro';

const diaDe = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(iso));
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
const mesActual = () => diaDe(new Date().toISOString()).slice(0, 7);
const nombreMes = (mes: string, corto = false) => {
  const t = new Date(`${mes}-15T12:00:00-03:00`).toLocaleDateString('es-AR', { month: corto ? 'short' : 'long', year: 'numeric', timeZone: ZONA });
  return t.charAt(0).toUpperCase() + t.slice(1).replace('.', '');
};
const tituloDia = (dia: string) => {
  const t = new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fechaCorta = (dia: string) => new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: ZONA });
/** 90 → «1,5 h»; 40 → «40 min». */
export function horas(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  return `${(min / 60).toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`;
}
const sumaMin = (ts: Trabajo[]) => ts.reduce((s, t) => s + t.minutos, 0);

export function MantenimientoTablero() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState<string>(mesActual());
  const [filtro, setFiltro] = useState<Filtro>({});
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/mantenimiento', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.trabajos)) throw new Error(d?.message ?? 'La API no respondió bien');
        setDatos(d);
        // si el mes en curso todavía no tiene nada, abre el último con trabajos
        if (!d.trabajos.some((t: Trabajo) => t.mes === mesActual()) && d.trabajos[0]) setMes(d.trabajos[0].mes);
      })
      .catch((e) => setError(e.message));
  }, []);

  const meses = useMemo(() => {
    const m = new Map<string, Trabajo[]>();
    for (const t of datos?.trabajos ?? []) m.set(t.mes, [...(m.get(t.mes) ?? []), t]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [datos]);

  const delMes = useMemo(() => (datos?.trabajos ?? []).filter((t) => t.mes === mes), [datos, mes]);
  const filtrados = useMemo(
    () => delMes.filter((t) =>
      (!filtro.tipo || t.tipo === filtro.tipo) &&
      (!filtro.area || t.area === filtro.area) &&
      (!filtro.pidio || (t.pidio ?? SIN_PEDIDO) === filtro.pidio) &&
      (!filtro.dia || diaDe(t.publicado_en) === filtro.dia)),
    [delMes, filtro],
  );

  if (error) return <Aviso tono="error">No pude traer el mantenimiento: {error}</Aviso>;
  if (!datos) return <Cargando />;
  if (!datos.trabajos.length) return <Vacio titulo="Todavía no hay trabajos cargados" />;

  const cambiar = (f: Filtro) => { setFiltro((v) => ({ ...v, ...f })); setAbierto(null); };
  const hayFiltro = Object.values(filtro).some(Boolean);
  const maxMesMin = Math.max(...meses.map(([, ts]) => sumaMin(ts)), 1);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* los meses: cada uno con su barra de horas, el abono marcado */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {meses.map(([m, ts]) => {
          const min = sumaMin(ts);
          const activo = m === mes;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMes(m); setFiltro({}); setAbierto(null); }}
              className={unir('min-w-32 shrink-0 rounded-2xl border px-3.5 py-2.5 text-left transition-colors', FOCO,
                activo ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta hover:border-black/25')}
            >
              <span className="block text-sm font-semibold">{nombreMes(m, true)}</span>
              <span className={unir('block text-xs', activo ? 'text-white/70' : 'text-tinta/60')}>{ts.length} trabajos · {horas(min)}</span>
              <span className={unir('mt-2 block h-1.5 rounded-full', activo ? 'bg-white/20' : 'bg-crema-hondo')}>
                <span className={unir('block h-full rounded-full', activo ? 'bg-white' : 'bg-marca')} style={{ width: `${Math.max(4, (min / maxMesMin) * 100)}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      <Resumen trabajos={delMes} horasAbono={datos.horasAbono} mes={mes} filtro={filtro} cambiar={cambiar} />

      <Tarjeta>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-tinta">Día por día</h2>
          <p className="text-xs text-tinta/60">Tocá un día para ver lo que se hizo</p>
        </div>
        <Calendario mes={mes} trabajos={delMes} dia={filtro.dia} elegir={(dia) => cambiar({ dia: filtro.dia === dia ? undefined : dia })} />
      </Tarjeta>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Barras
          titulo="Sobre qué trabajamos"
          grupos={agrupar(delMes, (t) => t.area)}
          activo={filtro.area}
          elegir={(area) => cambiar({ area: filtro.area === area ? undefined : area })}
        />
        <Barras
          titulo="Quién lo pidió"
          grupos={agrupar(delMes, (t) => t.pidio ?? SIN_PEDIDO)}
          activo={filtro.pidio}
          elegir={(p) => cambiar({ pidio: filtro.pidio === p ? undefined : p })}
          nota="«Sin registro»: trabajos de antes de octubre, cuando todavía no anotábamos quién pedía cada cosa."
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold text-tinta">
            {filtrados.length} {filtrados.length === 1 ? 'trabajo' : 'trabajos'} · {horas(sumaMin(filtrados))}
          </h2>
          {filtro.tipo && <Quitar texto={DE_TIPO[filtro.tipo].plural} quitar={() => cambiar({ tipo: undefined })} />}
          {filtro.area && <Quitar texto={filtro.area} quitar={() => cambiar({ area: undefined })} />}
          {filtro.pidio && <Quitar texto={`Pidió: ${filtro.pidio}`} quitar={() => cambiar({ pidio: undefined })} />}
          {filtro.dia && <Quitar texto={tituloDia(filtro.dia)} quitar={() => cambiar({ dia: undefined })} />}
          {hayFiltro && (
            <button type="button" onClick={() => cambiar({ tipo: undefined, area: undefined, pidio: undefined, dia: undefined })} className={unir('text-sm font-medium text-marca underline-offset-2 hover:underline', FOCO)}>
              Ver todo el mes
            </button>
          )}
        </div>
        {filtrados.length === 0 ? (
          <Vacio titulo="Nada con esos filtros" />
        ) : (
          <Lista trabajos={filtrados} abierto={abierto} abrir={(h) => setAbierto(abierto === h ? null : h)} />
        )}
      </section>
    </div>
  );
}

// ---- arriba: las horas del abono y la mezcla del mes ----------------------

function Resumen({ trabajos, horasAbono, mes, filtro, cambiar }: { trabajos: Trabajo[]; horasAbono: number; mes: string; filtro: Filtro; cambiar: (f: Filtro) => void }) {
  const min = sumaMin(trabajos);
  const abonoMin = horasAbono * 60;
  const escala = Math.max(min, abonoMin);
  const extra = Math.max(0, min - abonoMin);
  const pedidos = trabajos.filter((t) => t.pidio).length;
  return (
    <Tarjeta className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
        <div>
          <p className={ROTULO}>{nombreMes(mes)} · horas de mantenimiento</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-tinta sm:text-5xl">
            {horas(min)}
            <span className="ml-2 text-base font-medium text-tinta/60">de {horasAbono} h incluidas</span>
          </p>
          {/* la barra: el tramo del abono y, si se pasó, lo que fue por encima */}
          <div className="relative mt-4 h-5 overflow-hidden rounded-full bg-crema-hondo">
            <div className="absolute inset-y-0 left-0 bg-tinta" style={{ width: `${(Math.min(min, abonoMin) / escala) * 100}%` }} />
            {extra > 0 && (
              <div className="absolute inset-y-0 bg-marca" style={{ left: `${(abonoMin / escala) * 100}%`, width: `${(extra / escala) * 100}%` }} />
            )}
            <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(abonoMin / escala) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-tinta/70">
              <span className="mr-1.5 inline-block size-2.5 rounded-full bg-tinta align-middle" />
              Abono: {horas(Math.min(min, abonoMin))} de {horasAbono} h
            </span>
            {extra > 0 ? (
              <span className="font-semibold text-marca-hondo">
                <span className="mr-1.5 inline-block size-2.5 rounded-full bg-marca align-middle" />
                {horas(extra)} por encima del abono
              </span>
            ) : (
              <span className="text-tinta/70">Quedan {horas(abonoMin - min)}</span>
            )}
          </div>
          <p className="mt-3 text-xs text-tinta/60">
            {trabajos.length} trabajos publicados · {pedidos} pedidos por alguien con nombre y fecha. El tiempo es una estimación por las sesiones de trabajo de cada día.
          </p>
        </div>

        <div>
          <p className={ROTULO}>Qué tipo de trabajo fue</p>
          <div className="mt-3 flex h-5 overflow-hidden rounded-full bg-crema-hondo">
            {TIPOS.map((t) => {
              const n = trabajos.filter((x) => x.tipo === t.tipo).length;
              return n ? (
                <button
                  key={t.tipo}
                  type="button"
                  title={`${t.plural}: ${n}`}
                  onClick={() => cambiar({ tipo: filtro.tipo === t.tipo ? undefined : t.tipo })}
                  className={unir('h-full transition-opacity', t.fondo, filtro.tipo && filtro.tipo !== t.tipo && 'opacity-30')}
                  style={{ width: `${(n / Math.max(1, trabajos.length)) * 100}%` }}
                />
              ) : null;
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {TIPOS.map((t) => {
              const ts = trabajos.filter((x) => x.tipo === t.tipo);
              const activo = filtro.tipo === t.tipo;
              return (
                <button
                  key={t.tipo}
                  type="button"
                  onClick={() => cambiar({ tipo: activo ? undefined : t.tipo })}
                  className={unir('rounded-xl border p-3 text-left transition-colors', FOCO,
                    activo ? 'border-tinta bg-crema-claro' : 'border-black/[0.06] hover:border-black/20',
                    filtro.tipo && !activo && 'opacity-50')}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-tinta/70">
                    <span className={unir('inline-block size-2.5 rounded-full', t.fondo)} />
                    {t.plural}
                  </span>
                  <span className={unir('mt-1 block text-2xl font-bold', t.texto)}>{ts.length}</span>
                  <span className="block text-xs text-tinta/60">{ts.length ? horas(sumaMin(ts)) : t.explica}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

// ---- el mes día por día: una columna por día, apilada por tipo ------------

function Calendario({ mes, trabajos, dia, elegir }: { mes: string; trabajos: Trabajo[]; dia?: string; elegir: (d: string) => void }) {
  const [a, m] = mes.split('-').map(Number);
  const dias = new Date(a, m, 0).getDate();
  const porDia = new Map<string, Trabajo[]>();
  for (const t of trabajos) { const d = diaDe(t.publicado_en); porDia.set(d, [...(porDia.get(d) ?? []), t]); }
  const max = Math.max(...[...porDia.values()].map(sumaMin), 60);
  const hoy = diaDe(new Date().toISOString());
  return (
    <div className="mt-4 -mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-[40rem] items-end gap-1 px-1">
        {Array.from({ length: dias }, (_, i) => {
          const d = `${mes}-${String(i + 1).padStart(2, '0')}`;
          const ts = porDia.get(d) ?? [];
          const min = sumaMin(ts);
          const semana = new Date(`${d}T12:00:00-03:00`).getDay();
          const finde = semana === 0 || semana === 6;
          const activo = dia === d;
          return (
            <button
              key={d}
              type="button"
              disabled={!ts.length}
              onClick={() => elegir(d)}
              title={ts.length ? `${tituloDia(d)}: ${ts.length} trabajos, ${horas(min)}` : tituloDia(d)}
              className={unir('group flex flex-1 flex-col items-center gap-1 rounded-lg pt-1 disabled:cursor-default', FOCO, activo && 'bg-crema-claro')}
            >
              <span className="text-xs font-semibold text-tinta/70">{ts.length ? horas(min).replace(' min', '′').replace(' h', 'h') : ''}</span>
              <span className="flex h-32 w-full max-w-7 flex-col-reverse overflow-hidden rounded-md bg-crema-claro">
                {TIPOS.map((t) => {
                  const mt = sumaMin(ts.filter((x) => x.tipo === t.tipo));
                  return mt ? <span key={t.tipo} className={unir('w-full', t.fondo, dia && !activo && 'opacity-30')} style={{ height: `${(mt / max) * 100}%` }} /> : null;
                })}
              </span>
              <span className={unir('text-xs', d === hoy ? 'font-bold text-marca' : finde ? 'text-tinta/40' : 'text-tinta/70', activo && 'font-bold text-tinta')}>{i + 1}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-tinta/70">
        {TIPOS.map((t) => (
          <span key={t.tipo} className="flex items-center gap-1.5"><span className={unir('size-2.5 rounded-full', t.fondo)} />{t.nombre}</span>
        ))}
      </div>
    </div>
  );
}

// ---- barras horizontales (áreas y quién pidió) ----------------------------

function agrupar(ts: Trabajo[], clave: (t: Trabajo) => string) {
  const m = new Map<string, Trabajo[]>();
  for (const t of ts) { const k = clave(t); m.set(k, [...(m.get(k) ?? []), t]); }
  return [...m.entries()].map(([nombre, lista]) => ({ nombre, lista, min: sumaMin(lista) })).sort((a, b) => b.min - a.min);
}

function Barras({ titulo, grupos, activo, elegir, nota }: { titulo: string; grupos: ReturnType<typeof agrupar>; activo?: string; elegir: (k: string) => void; nota?: string }) {
  const max = Math.max(...grupos.map((g) => g.min), 1);
  const conNota = nota && grupos.some((g) => g.nombre === SIN_PEDIDO);
  return (
    <Tarjeta>
      <h2 className="text-base font-semibold text-tinta">{titulo}</h2>
      <ul className="mt-3 space-y-1">
        {grupos.map((g) => (
          <li key={g.nombre}>
            <button
              type="button"
              onClick={() => elegir(g.nombre)}
              className={unir('w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-crema-claro', FOCO, activo === g.nombre && 'bg-crema-claro', activo && activo !== g.nombre && 'opacity-50')}
            >
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-tinta">{g.nombre}</span>
                <span className="shrink-0 text-tinta/60">{g.lista.length} · {horas(g.min)}</span>
              </span>
              {/* la barra se parte por tipo: se ve si fueron bugs o mejoras */}
              <span className="mt-1 flex h-2 overflow-hidden rounded-full bg-crema-hondo" style={{ width: `${Math.max(3, (g.min / max) * 100)}%` }}>
                {TIPOS.map((t) => {
                  const mt = sumaMin(g.lista.filter((x) => x.tipo === t.tipo));
                  return mt ? <span key={t.tipo} className={unir('h-full', t.fondo)} style={{ width: `${(mt / g.min) * 100}%` }} /> : null;
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {conNota && <p className="mt-3 text-xs text-tinta/60">{nota}</p>}
    </Tarjeta>
  );
}

function Quitar({ texto, quitar }: { texto: string; quitar: () => void }) {
  return (
    <button type="button" onClick={quitar} className={unir('inline-flex min-h-9 items-center gap-2 rounded-full border border-tinta bg-tinta px-3.5 text-sm font-medium text-white', FOCO)}>
      {texto}
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      <span className="sr-only">Quitar filtro</span>
    </button>
  );
}

// ---- la lista: cada trabajo, día por día ---------------------------------

function Lista({ trabajos, abierto, abrir }: { trabajos: Trabajo[]; abierto: string | null; abrir: (h: string) => void }) {
  const dias = agrupar(trabajos, (t) => diaDe(t.publicado_en)).sort((a, b) => b.nombre.localeCompare(a.nombre));
  return (
    <div className="space-y-5">
      {dias.map((d) => (
        <div key={d.nombre}>
          <p className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-tinta">{tituloDia(d.nombre)}</span>
            <span className="text-xs text-tinta/60">{d.lista.length} · {horas(d.min)}</span>
          </p>
          <ul className="space-y-2">
            {d.lista.map((t) => <Item key={t.hash} t={t} abierto={abierto === t.hash} abrir={() => abrir(t.hash)} />)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Item({ t, abierto, abrir }: { t: Trabajo; abierto: boolean; abrir: () => void }) {
  const tipo = DE_TIPO[t.tipo];
  return (
    <li className={unir('overflow-hidden rounded-2xl border border-l-4 border-black/[0.06] bg-white shadow-tarjeta', tipo.borde)}>
      <button type="button" onClick={abrir} aria-expanded={abierto} className={unir('block w-full p-4 text-left', FOCO)}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={unir('rounded-full px-2 py-0.5 font-semibold', tipo.suave, tipo.texto)}>{tipo.nombre}</span>
          <span className="font-medium text-tinta/70">{t.area}</span>
          <span className="ml-auto text-tinta/60">{horaDe(t.publicado_en)} · {horas(t.minutos)}</span>
        </span>
        <span className="mt-2 block text-base font-semibold text-tinta">{t.titulo}</span>
        <span className="mt-0.5 block text-sm text-tinta/70">{t.que_se_hizo}</span>
        {t.para_que && <span className="mt-1 block text-sm text-tinta/70">Para qué: {t.para_que}</span>}
        {t.pidio && (
          <span className="mt-3 flex flex-wrap items-baseline gap-x-2 rounded-xl bg-crema-claro px-3 py-2 text-sm">
            <span className="font-semibold text-tinta">
              {t.tipo === 'propuesta' ? 'Propuesta de MetoGroup' : `Lo pidió ${t.pidio}`}
              {t.pedido_el ? ` el ${fechaCorta(t.pedido_el)}` : ''}
            </span>
            {t.cita && <span className="text-tinta/70">«{t.cita}»</span>}
          </span>
        )}
      </button>
      {abierto && (
        <div className="space-y-3 border-t border-black/[0.06] bg-crema-claro/60 p-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {t.partes.map((p) => <span key={p} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-tinta/70">{PARTES[p] ?? p}</span>)}
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-tinta/60">{t.archivos} archivos · {t.lineas.toLocaleString('es-AR')} líneas</span>
            <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-xs text-tinta/60">{t.hash.slice(0, 7)}</span>
          </div>
          <p className={ROTULO}>El registro completo</p>
          <p className="whitespace-pre-wrap break-words text-tinta/80">{t.mensaje}</p>
        </div>
      )}
    </li>
  );
}
