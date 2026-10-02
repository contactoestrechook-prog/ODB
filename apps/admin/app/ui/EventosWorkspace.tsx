'use client';

import { useEffect, useState } from 'react';
import { fecha, numero, pesos as pesosFmt } from '../lib/formato';
import {
  Aviso,
  Boton,
  Campo,
  Chips,
  Entrada,
  Etiqueta,
  FOCO,
  IconoCerrar,
  Kpi,
  Pestanas,
  PlacaRoja,
  Selector,
  Tarjeta,
  Vacio,
  clasesBoton,
  unir,
  type TonoEtiqueta,
} from './kit';

const pesos = (n: any) => pesosFmt(Number(n) || 0);
const TIPO: [string, string][] = [['cumpleanos', 'Cumpleaños'], ['casamiento', 'Casamiento'], ['corporativo', 'Corporativo'], ['fin_de_ano', 'Fin de año'], ['otro', 'Otro']];
const ESTADO: [string, string][] = [['prospecto', 'Prospecto'], ['propuesta', 'Propuesta'], ['confirmado', 'Confirmado'], ['realizado', 'Realizado'], ['cancelado', 'Cancelado']];
const ESTADO_TONO: Record<string, TonoEtiqueta> = { prospecto: 'atencion', propuesta: 'info', confirmado: 'ok', realizado: 'neutro', cancelado: 'error' };
const tipoLabel = (t: string) => TIPO.find((x) => x[0] === t)?.[1] ?? t;
const estadoLabel = (e: string) => ESTADO.find((x) => x[0] === e)?.[1] ?? e;
const isoEnDias = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// Los mensajes de éxito llegan con "✓ " adelante: aviso verde y sin el tilde.
const tonoMsg = (msg: string) => (msg.startsWith('✓') ? 'ok' : 'error');
const sinTilde = (msg: string) => msg.replace(/^✓\s*/, '');

export function EventosWorkspace({ resumen, oportunidades, eventos }: { resumen: any; oportunidades: any[]; eventos: any[] }) {
  const [kpi, setKpi] = useState(resumen ?? {});
  const [tab, setTab] = useState('oportunidades');
  const [op, setOp] = useState<any[]>(oportunidades ?? []);
  const [evs, setEvs] = useState<any[]>(eventos ?? []);
  const [filtro, setFiltro] = useState('');
  const [sel, setSel] = useState<any | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const refrescar = async () => {
    const [a, b, c] = await Promise.all([fetch('/api/eventos/resumen'), fetch('/api/eventos/oportunidades'), fetch(`/api/eventos${filtro ? `?estado=${filtro}` : ''}`)]);
    if (a.ok) setKpi(await a.json());
    if (b.ok) setOp(await b.json());
    if (c.ok) setEvs(await c.json());
  };
  useEffect(() => { fetch(`/api/eventos${filtro ? `?estado=${filtro}` : ''}`).then((r) => r.json()).then((d) => setEvs(Array.isArray(d) ? d : [])); }, [filtro]);

  const abrir = async (id: string) => { const r = await fetch(`/api/eventos/${id}`); if (r.ok) setSel(await r.json()); };
  const crearDesdeCumple = async (o: any) => {
    const r = await fetch('/api/eventos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'cumpleanos', nombre: `Cumple de ${o.nombre ?? 'cliente'}`, clienteId: o.cliente_id, fecha: isoEnDias(o.dias) }) });
    const d = await r.json(); if (d.id) { await refrescar(); abrir(d.id); }
  };

  if (sel) return <Detalle ev={sel} onBack={() => { setSel(null); refrescar(); }} />;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Oportunidades 60d', kpi?.oportunidades ?? 0], ['Propuestas', kpi?.propuestas ?? 0], ['Confirmados', kpi?.confirmados ?? 0], ['Pipeline', pesos(kpi?.pipeline)]].map(([l, v]: any) => (
          <Kpi key={l} etiqueta={<span className="whitespace-normal">{l}</span>} valor={v} />
        ))}
      </div>

      <Pestanas
        etiquetaAccesible="Vistas de eventos"
        valor={tab}
        onCambiar={setTab}
        opciones={[['oportunidades', 'Oportunidades'], ['pipeline', 'Eventos']].map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {tab === 'oportunidades' && (
        <div className="space-y-3">
          <p className="text-sm text-tinta/70">Clientes que cumplen años en los próximos 60 días. Armales una propuesta para su festejo.</p>
          {op.length === 0 ? (
            <Vacio titulo="No hay cumpleaños próximos." texto="Cargá fechas de nacimiento de tus clientes para ver oportunidades." />
          ) : op.map((o) => (
            <Tarjeta key={o.cliente_id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-base font-semibold text-tinta">{o.nombre ?? 'Cliente'} <span className="text-sm font-normal text-tinta/60">· DNI {o.dni}</span></p>
                <p className="mt-0.5 text-sm text-tinta/60">Cumple en <b className="font-semibold text-marca-hondo">{o.dias} días</b> · {new Date(o.fecha_nacimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}</p>
              </div>
              <Boton onClick={() => crearDesdeCumple(o)} className="w-full shrink-0 sm:w-auto">{o.tiene_evento ? 'Ver propuesta' : 'Armar propuesta'}</Boton>
            </Tarjeta>
          ))}
        </div>
      )}

      {tab === 'pipeline' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              etiquetaAccesible="Estado del evento"
              valor={filtro}
              onCambiar={setFiltro}
              opciones={[['', 'Todos'], ...ESTADO].map(([k, label]) => ({ valor: k, etiqueta: label }))}
            />
            <Boton onClick={() => setNuevo(true)}>Nuevo evento</Boton>
          </div>
          {nuevo && <NuevoEvento onClose={() => setNuevo(false)} onCreated={(id) => { setNuevo(false); refrescar(); abrir(id); }} />}
          {evs.length === 0 ? (
            <Vacio titulo={`No hay eventos${filtro ? ' en este estado' : ''}.`} />
          ) : evs.map((e) => (
            <button
              key={e.id}
              onClick={() => abrir(e.id)}
              className={unir(
                'flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 text-left shadow-tarjeta transition-colors hover:bg-crema-claro sm:p-5',
                FOCO,
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-base font-semibold text-tinta">{e.nombre}</p>
                <p className="mt-0.5 text-sm text-tinta/60">{tipoLabel(e.tipo)}{e.cliente?.nombre ? ` · ${e.cliente.nombre}` : ''}{e.fecha ? ` · ${fecha(e.fecha, 'completa')}` : ''}{e.invitados ? ` · ${e.invitados} inv.` : ''}</p>
              </div>
              <div className="shrink-0 text-right">
                <Etiqueta tono={ESTADO_TONO[e.estado] ?? 'neutro'}>{estadoLabel(e.estado)}</Etiqueta>
                {Number(e.presupuesto) > 0 && <p className="importe mt-1 text-sm font-semibold text-tinta">{pesos(e.presupuesto)}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NuevoEvento({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [tipo, setTipo] = useState('casamiento');
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState('');
  const [invitados, setInvitados] = useState('');
  const [guardando, setGuardando] = useState(false);
  const crear = async () => {
    if (!nombre.trim() || guardando) return; setGuardando(true);
    try {
      const r = await fetch('/api/eventos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, nombre, fecha: fecha || null, invitados: invitados ? Number(invitados) : null }) });
      const d = await r.json(); if (d.id) onCreated(d.id);
    } finally { setGuardando(false); }
  };
  return (
    <Tarjeta className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo">
          <Selector value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Nombre del evento">
          <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del evento" />
        </Campo>
        <Campo etiqueta="Fecha">
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo etiqueta="Invitados">
          <Entrada type="number" inputMode="numeric" value={invitados} onChange={(e) => setInvitados(e.target.value)} placeholder="Invitados" />
        </Campo>
      </div>
      <div className="flex flex-wrap gap-2">
        <Boton onClick={crear} cargando={guardando}>{guardando ? 'Creando…' : 'Crear evento'}</Boton>
        <Boton variante="fantasma" onClick={onClose}>Cancelar</Boton>
      </div>
    </Tarjeta>
  );
}

function Detalle({ ev, onBack }: { ev: any; onBack: () => void }) {
  const [items, setItems] = useState<any[]>(ev.items ?? []);
  const [invitados, setInvitados] = useState(ev.invitados ?? '');
  const [estado, setEstado] = useState(ev.estado);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const total = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);

  useEffect(() => {
    if (q.length < 2) { setRes([]); return; }
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(q)}`); if (r.ok) { const d = await r.json(); setRes((d.items ?? []).slice(0, 6)); } }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const sugerir = async () => {
    setSugiriendo(true); setMsg(null);
    try {
      const r = await fetch('/api/eventos/sugerir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: ev.tipo, invitados: Number(invitados) || 0 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'Error');
      setItems(d.items ?? []); setMsg(`✓ La IA sugirió ${d.items?.length ?? 0} productos.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); } finally { setSugiriendo(false); }
  };
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      await fetch(`/api/eventos/${ev.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invitados: invitados ? Number(invitados) : null, estado }) });
      const r = await fetch(`/api/eventos/${ev.id}/propuesta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const d = await r.json(); setMsg(`✓ Propuesta guardada (${pesos(d.total)}).`);
    } finally { setGuardando(false); }
  };
  const enviar = async () => {
    setEnviando(true); setMsg(null);
    try { const r = await fetch(`/api/eventos/${ev.id}/enviar`, { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Error'); setMsg('✓ Propuesta enviada al cliente.'); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); } finally { setEnviando(false); }
  };
  const agregar = (p: any) => { setItems((c) => [...c, { producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: Number(p.precio) || 0 }]); setQ(''); setRes([]); };
  const editar = (i: number, campo: string, val: any) => setItems((c) => c.map((it, idx) => idx === i ? { ...it, [campo]: val } : it));

  return (
    <div className="space-y-4">
      <Boton
        variante="secundario"
        onClick={onBack}
        icono={
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        }
      >
        Volver a eventos
      </Boton>
      <Tarjeta>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-lg font-semibold text-tinta">{ev.nombre}</p>
            <p className="break-words text-sm text-tinta/60">{tipoLabel(ev.tipo)}{ev.cliente?.nombre ? ` · ${ev.cliente.nombre} (DNI ${ev.cliente.dni})` : ' · sin cliente asociado'}{ev.fecha ? ` · ${fecha(ev.fecha, 'completa')}` : ''}</p>
          </div>
          <Etiqueta tono={ESTADO_TONO[ev.estado] ?? 'neutro'} className="shrink-0">{estadoLabel(ev.estado)}</Etiqueta>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Campo etiqueta="Invitados" className="w-32">
            <Entrada type="number" inputMode="numeric" value={invitados} onChange={(e) => setInvitados(e.target.value)} />
          </Campo>
          <Boton variante="secundario" onClick={sugerir} cargando={sugiriendo}>{sugiriendo ? 'Pensando…' : 'Sugerir bebidas (IA)'}</Boton>
        </div>
      </Tarjeta>

      {/* La propuesta de bebidas, como Placa roja (pedido de Leandro, 2/10/2026:
          "siempre que se detallen productos vamos a usar el paquete gráfico de
          pedidos y lista de precio"). La cantidad va en el círculo y se sigue
          corrigiendo abajo de cada renglón; el total, en la píldora negra. */}
      <PlacaRoja
        titulo="Propuesta"
        sub={ev.nombre}
        renglones={items.map((it, i) => ({
          cantidad: it.cantidad,
          nombre: it.descripcion,
          detalle: `${numero(it.cantidad, 2)} × ${pesos(it.precio_unitario)}`,
          importe: pesos(Number(it.cantidad) * Number(it.precio_unitario)),
          acciones: (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-tinta/60">
                Cantidad
                <span className="w-24 shrink-0">
                  <Entrada type="number" inputMode="decimal" value={it.cantidad} onChange={(e) => editar(i, 'cantidad', Number(e.target.value))} aria-label={`Cantidad de ${it.descripcion}`} className="text-center" />
                </span>
              </label>
              <button
                onClick={() => setItems((c) => c.filter((_, idx) => idx !== i))}
                aria-label={`Quitar ${it.descripcion}`}
                className={unir('ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-marca-suave hover:text-marca-hondo', FOCO)}
              >
                <IconoCerrar className="size-5" />
              </button>
            </div>
          ),
        }))}
        total={items.length > 0 ? { etiqueta: 'Total', valor: pesos(total) } : undefined}
        pie={items.length === 0 ? 'Sin ítems. Usá la sugerencia de IA o agregá productos.' : undefined}
        acciones={
          // la placa recorta lo que se le sale (overflow-hidden por las puntas
          // redondeadas): los resultados van debajo del campo, no flotando encima
          <div className="w-full min-w-0 space-y-1">
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Agregar producto…" aria-label="Agregar producto" />
            {res.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
                {res.map((p) => (
                  <button
                    key={p.sku}
                    onClick={() => agregar(p)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-tinta hover:bg-crema-claro focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca"
                  >
                    <span className="min-w-0 break-words">{p.nombre}</span><span className="importe shrink-0 text-tinta/60">{pesos(p.precio)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      {msg && <Aviso tono={tonoMsg(msg)}>{sinTilde(msg)}</Aviso>}
      <div className="flex flex-wrap items-center gap-2">
        <Selector value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado del evento" className="w-full sm:w-auto">
          {ESTADO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Selector>
        <Boton variante="secundario" onClick={guardar} cargando={guardando}>{guardando ? 'Guardando…' : 'Guardar propuesta'}</Boton>
        <a href={`/api/eventos/${ev.id}/presupuesto`} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante: 'secundario' })}>Descargar PDF</a>
        <Boton onClick={enviar} cargando={enviando} disabled={enviando || !ev.cliente_id} title={!ev.cliente_id ? 'El evento no tiene cliente asociado' : ''}>{enviando ? 'Enviando…' : 'Enviar al cliente'}</Boton>
      </div>
    </div>
  );
}
