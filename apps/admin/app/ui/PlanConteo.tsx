'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, BotonLink, Cargando, Chip, Entrada, Kpi, Modal, Selector, unir, FOCO } from './kit';
import { filtrarPorBusqueda } from '../lib/busqueda';

// ============================================================
// PLAN DE CONTEO POR RUBRO (24/10/2026). La planilla pegada en la pared de ODB
// (rubros por semanas del mes, con «Ale 21/7» en cada celda) pasada al sistema:
//   · lo contado sale solo de las lecturas del arqueo (quién y qué día);
//   · lo asignado lo cargan las responsables (Ana y Romina), una celda o
//     repartiendo el mes entre el equipo;
//   · en rojo, los rubros que hace más de 30 días que nadie cuenta.
// ============================================================

type Hecho = { conteoId: string; estado: string; fecha: string; quien: string; productos: number };
type Celda = { categoriaId: string; semana: string; asignado: string | null; hechos: Hecho[] };
type Rubro = { id: string; nombre: string; productos: number; valor: number; ultimo: { fecha: string; quien: string; dias: number } | null };
type Plan = { mes: string; hoy: string; semanaActual: string; semanas: string[]; rubros: Rubro[]; celdas: Celda[]; personas: string[] };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ddmm = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
const otroMes = (mes: string, d: number) => {
  const [a, m] = mes.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1 + d, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};
const VENCIDO = 30;

export function PlanConteo({ sucursales, sucursalPropia, responsable }: { sucursales: { id: string; nombre: string }[]; sucursalPropia: string | null; responsable: boolean }) {
  const router = useRouter();
  const [sucursalId, setSucursalId] = useState(sucursalPropia ?? sucursales[0]?.id ?? '');
  const [mes, setMes] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'vencidos' | 'sin-asignar'>('todos');
  const [editando, setEditando] = useState<{ rubro: Rubro; semana: string } | null>(null);
  const [repartiendo, setRepartiendo] = useState(false);

  const cargar = useCallback(async () => {
    if (!sucursalId) return;
    try {
      const r = await fetch(`/api/arqueo?ruta=plan&sucursalId=${encodeURIComponent(sucursalId)}${mes ? `&mes=${mes}` : ''}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer el plan');
      setPlan(j); setError(null);
      if (!mes) setMes(j.mes);
    } catch (e: any) { setError(e.message); }
  }, [sucursalId, mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const celdas = useMemo(() => new Map((plan?.celdas ?? []).map((c) => [`${c.categoriaId}|${c.semana}`, c])), [plan]);
  const filas = useMemo(() => {
    let r = plan?.rubros ?? [];
    if (filtro === 'vencidos') r = r.filter((x) => !x.ultimo || x.ultimo.dias > VENCIDO);
    if (filtro === 'sin-asignar') r = r.filter((x) => !plan!.semanas.some((s) => celdas.get(`${x.id}|${s}`)));
    return filtrarPorBusqueda(r, busca, (x) => x.nombre);
  }, [plan, filtro, busca, celdas]);

  if (error && !plan) return <Aviso tono="error">{error}</Aviso>;
  if (!plan) return <Cargando />;
  const [anio, m] = plan.mes.split('-').map(Number);
  const contadosMes = new Set(plan.celdas.filter((c) => c.hechos.length).map((c) => c.categoriaId)).size;
  const asignadosMes = new Set(plan.celdas.filter((c) => c.asignado).map((c) => c.categoriaId)).size;
  const vencidos = plan.rubros.filter((x) => !x.ultimo || x.ultimo.dias > VENCIDO).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Boton variante="secundario" tamano="chico" onClick={() => setMes(otroMes(plan.mes, -1))} aria-label="Mes anterior">‹</Boton>
        <p className="min-w-36 text-center text-lg font-semibold capitalize text-tinta">{MESES[m - 1]} {anio}</p>
        <Boton variante="secundario" tamano="chico" onClick={() => setMes(otroMes(plan.mes, 1))} aria-label="Mes siguiente">›</Boton>
        {sucursales.length > 1 && (
          <div className="min-w-0 sm:w-56">
            <Selector value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setPlan(null); }} aria-label="Sucursal"
              opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre.replace(/^Suc\s+/, '') }))} />
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {responsable && <Boton onClick={() => setRepartiendo(true)}>Repartir el mes</Boton>}
          <Boton variante="secundario" onClick={() => window.print()}>Imprimir</Boton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
        <Kpi etiqueta="Rubros con stock" valor={plan.rubros.length} />
        <Kpi etiqueta="Contados este mes" valor={contadosMes} sub={`${Math.round((100 * contadosMes) / Math.max(1, plan.rubros.length))}% de los rubros`} tono={contadosMes ? 'ok' : 'neutro'} />
        <Kpi etiqueta="Asignados" valor={asignadosMes} />
        <Kpi etiqueta={`Sin contar hace +${VENCIDO} días`} valor={vencidos} tono={vencidos ? 'error' : 'ok'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="min-w-0 flex-1 sm:max-w-xs"><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar rubro" aria-label="Buscar rubro" /></div>
        <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</Chip>
        <Chip activo={filtro === 'vencidos'} cuenta={vencidos} onClick={() => setFiltro('vencidos')}>Hace mucho</Chip>
        <Chip activo={filtro === 'sin-asignar'} onClick={() => setFiltro('sin-asignar')}>Sin nadie este mes</Chip>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      <p className="hidden text-lg font-semibold print:block">Plan de conteo · {MESES[m - 1]} {anio}</p>
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-crema-claro text-left text-xs uppercase tracking-wide text-tinta/70">
              <th className="sticky left-0 z-10 min-w-44 bg-crema-claro px-3 py-2">Rubro</th>
              {plan.semanas.map((s, i) => (
                <th key={s} className={unir('min-w-24 px-2 py-2 text-center', s === plan.semanaActual && 'bg-marca-suave text-marca-hondo')}>
                  {i + 1}ª semana<span className="block font-normal normal-case">{ddmm(s)}</span>
                </th>
              ))}
              <th className="min-w-28 px-2 py-2 text-center">Último conteo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => {
              const vencido = !r.ultimo || r.ultimo.dias > VENCIDO;
              return (
                <tr key={r.id} className="border-t border-black/[0.06]">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                    <p className="break-words font-medium text-tinta">{r.nombre}</p>
                    <p className="text-xs text-tinta/60">{r.productos} productos</p>
                  </td>
                  {plan.semanas.map((s) => {
                    const c = celdas.get(`${r.id}|${s}`);
                    const pasada = s < plan.semanaActual;
                    return (
                      <td key={s} className={unir('px-1 py-1 text-center align-middle', s === plan.semanaActual && 'bg-marca-suave/40')}>
                        <button type="button" disabled={!responsable && !c?.asignado}
                          onClick={() => setEditando({ rubro: r, semana: s })}
                          className={unir('min-h-9 w-full rounded-lg px-1 text-xs leading-tight disabled:cursor-default', FOCO,
                            c?.hechos.length ? (c.hechos.some((h) => h.estado === 'aplicado') ? 'bg-ok-suave font-semibold text-ok' : 'bg-info-suave font-semibold text-info')
                              : c?.asignado ? (pasada ? 'border border-marca/50 text-marca-hondo' : 'border border-black/15 text-tinta')
                              : 'text-tinta/30 hover:bg-crema-claro')}>
                          {c?.hechos.length ? c.hechos.map((h) => `${h.quien} ${ddmm(h.fecha)}`).join(' · ')
                            : c?.asignado ? `${c.asignado}${pasada ? ' · no se contó' : ''}`
                            : responsable ? '+' : ''}
                        </button>
                      </td>
                    );
                  })}
                  <td className={unir('px-2 py-1.5 text-center text-xs', vencido ? 'font-semibold text-marca-hondo' : 'text-tinta/70')}>
                    {r.ultimo ? <>{r.ultimo.quien} {ddmm(r.ultimo.fecha)}<span className="block font-normal">hace {r.ultimo.dias} días</span></> : 'Nunca'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filas.length && <p className="p-4 text-sm text-tinta/60">Ningún rubro coincide.</p>}
      </div>
      <p className="text-xs text-tinta/60 print:hidden">
        Verde: contado y aplicado. Celeste: contado, falta aplicar. Con borde: asignado (en rojo si la semana pasó y no se contó). Lo contado se completa solo con lo que el equipo cuenta en el celular.
      </p>
      <div className="print:hidden"><BotonLink href="/arqueo" variante="fantasma" tamano="chico">← Volver a los arqueos</BotonLink></div>

      {editando && (
        <EditarCelda plan={plan} sucursalId={sucursalId} rubro={editando.rubro} semana={editando.semana} celda={celdas.get(`${editando.rubro.id}|${editando.semana}`)}
          responsable={responsable} onCerrar={() => setEditando(null)} onListo={() => { setEditando(null); cargar(); }}
          onContar={(id) => router.push(`/arqueo/${id}/contar`)} />
      )}
      {repartiendo && <Repartir plan={plan} sucursalId={sucursalId} onCerrar={() => setRepartiendo(false)} onListo={() => { setRepartiendo(false); cargar(); }} />}
    </div>
  );
}

function EditarCelda({ plan, sucursalId, rubro, semana, celda, responsable, onCerrar, onListo, onContar }: {
  plan: Plan; sucursalId: string; rubro: Rubro; semana: string; celda?: Celda; responsable: boolean;
  onCerrar: () => void; onListo: () => void; onContar: (id: string) => void;
}) {
  const [persona, setPersona] = useState(celda?.asignado ?? '');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function post(ruta: string, cuerpo: any) {
    setTrabajando(true); setError(null);
    try {
      const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruta, ...cuerpo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No se pudo');
      return j;
    } catch (e: any) { setError(e.message); return null; } finally { setTrabajando(false); }
  }
  const esEstaSemana = semana === plan.semanaActual;
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`${rubro.nombre} · semana del ${ddmm(semana)}`} ancho="chico"
      pie={<>
        {responsable && celda?.asignado && <Boton variante="peligro" disabled={trabajando} onClick={async () => { if (await post('plan/asignar', { sucursalId, categoriaId: rubro.id, semana, persona: '' })) onListo(); }}>Sacar</Boton>}
        {responsable && <Boton disabled={trabajando || !persona.trim()} onClick={async () => { if (await post('plan/asignar', { sucursalId, categoriaId: rubro.id, semana, persona })) onListo(); }}>Guardar</Boton>}
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-tinta/70">{rubro.productos} productos con stock{rubro.ultimo ? ` · último conteo: ${rubro.ultimo.quien}, hace ${rubro.ultimo.dias} días` : ' · nunca se contó'}.</p>
        {!!celda?.hechos.length && (
          <div className="space-y-1">
            {celda.hechos.map((h) => (
              <p key={h.conteoId} className="text-sm text-tinta">
                Contó <b>{h.quien}</b> el {ddmm(h.fecha)} ({h.productos} productos) · {h.estado === 'aplicado' ? 'aplicado' : h.estado === 'en_revision' ? 'en revisión' : 'contando'}
                {responsable && <> · <a className="underline" href={`/arqueo/${h.conteoId}`}>ver</a></>}
              </p>
            ))}
          </div>
        )}
        {responsable && (
          <>
            <p className="text-sm font-semibold text-tinta">¿A quién le toca?</p>
            {!!plan.personas.length && (
              <div className="flex flex-wrap gap-2">
                {plan.personas.map((p) => <Chip key={p} activo={p.toLowerCase() === persona.trim().toLowerCase()} onClick={() => setPersona(p)}>{p}</Chip>)}
              </div>
            )}
            <Entrada value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Nombre (ej.: Ale)" maxLength={40} aria-label="Persona" />
          </>
        )}
        {esEstaSemana && (
          <Boton variante="secundario" anchoCompleto disabled={trabajando} onClick={async () => { const r = await post('plan/empezar', { sucursalId, categoriaId: rubro.id }); if (r?.id) onContar(r.id); }}>
            Contar este rubro ahora
          </Boton>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

function Repartir({ plan, sucursalId, onCerrar, onListo }: { plan: Plan; sucursalId: string; onCerrar: () => void; onListo: () => void }) {
  const [personas, setPersonas] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<number | null>(null);
  const todas = Array.from(new Set([...plan.personas, ...personas]));
  const semanasQueQuedan = plan.semanas.filter((s) => s >= plan.semanaActual).length;
  async function repartir() {
    setTrabajando(true); setError(null);
    try {
      const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruta: 'plan/repartir', sucursalId, mes: plan.mes, personas }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No se pudo repartir');
      setResultado(j.asignados ?? 0);
    } catch (e: any) { setError(e.message); } finally { setTrabajando(false); }
  }
  const agregar = () => { const n = nuevo.trim(); if (n) { setPersonas((p) => Array.from(new Set([...p, n.charAt(0).toUpperCase() + n.slice(1)]))); setNuevo(''); } };
  return (
    <Modal abierto onCerrar={resultado != null ? onListo : onCerrar} titulo="Repartir el mes" ancho="chico"
      pie={resultado != null ? <Boton onClick={onListo}>Listo</Boton> : <>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={repartir} disabled={trabajando || !personas.length || !semanasQueQuedan}>{trabajando ? 'Repartiendo…' : 'Repartir'}</Boton>
      </>}>
      {resultado != null ? <Aviso tono="ok">Se asignaron {resultado} rubros. Podés cambiar cualquiera tocando su celda.</Aviso> : (
        <div className="space-y-3">
          <p className="text-sm text-tinta/70">
            Los rubros que todavía no tienen a nadie este mes se reparten entre las {semanasQueQuedan} semanas que quedan y las personas que elijas,
            parejo por cantidad de productos. Primero van los que hace más tiempo no se cuentan. Lo ya asignado no se toca.
          </p>
          <p className="text-sm font-semibold text-tinta">¿Quiénes cuentan?</p>
          <div className="flex flex-wrap gap-2">
            {todas.map((p) => <Chip key={p} activo={personas.includes(p)} onClick={() => setPersonas((x) => x.includes(p) ? x.filter((y) => y !== p) : [...x, p])}>{p}</Chip>)}
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Entrada value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar persona (ej.: Guada)" maxLength={40} aria-label="Agregar persona"
              onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }} /></div>
            <Boton variante="secundario" onClick={agregar}>Agregar</Boton>
          </div>
          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      )}
    </Modal>
  );
}
