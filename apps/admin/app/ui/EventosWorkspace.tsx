'use client';

import { useEffect, useState } from 'react';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const TIPO: [string, string][] = [['cumpleanos', 'Cumpleaños'], ['casamiento', 'Casamiento'], ['corporativo', 'Corporativo'], ['fin_de_ano', 'Fin de año'], ['otro', 'Otro']];
const ESTADO: [string, string][] = [['prospecto', 'Prospecto'], ['propuesta', 'Propuesta'], ['confirmado', 'Confirmado'], ['realizado', 'Realizado'], ['cancelado', 'Cancelado']];
const ESTADO_BADGE: Record<string, string> = { prospecto: 'bg-amber-100 text-amber-800', propuesta: 'bg-blue-100 text-blue-800', confirmado: 'bg-green-100 text-green-800', realizado: 'bg-black/10 text-black/60', cancelado: 'bg-red-100 text-red-800' };
const tipoLabel = (t: string) => TIPO.find((x) => x[0] === t)?.[1] ?? t;
const estadoLabel = (e: string) => ESTADO.find((x) => x[0] === e)?.[1] ?? e;
const isoEnDias = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

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
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Oportunidades 60d', kpi?.oportunidades ?? 0], ['Propuestas', kpi?.propuestas ?? 0], ['Confirmados', kpi?.confirmados ?? 0], ['Pipeline', pesos(kpi?.pipeline)]].map(([l, v]: any, i) => (
          <div key={l} className={`rounded-xl p-4 ${i === 0 ? 'bg-[#B82D25] text-white' : 'bg-white'}`}>
            <p className={`text-xs ${i === 0 ? 'text-white/80' : 'text-black/50'}`}>{l}</p>
            <p className={`text-xl font-semibold ${i === 0 ? 'text-white' : 'text-black'}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {[['oportunidades', 'Oportunidades'], ['pipeline', 'Eventos']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>
        ))}
      </div>

      {tab === 'oportunidades' && (
        <div className="space-y-3">
          <p className="text-sm text-black/55">Clientes que cumplen años en los próximos 60 días. Armales una propuesta para su festejo.</p>
          {op.length === 0 ? (
            <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">No hay cumpleaños próximos. Cargá fechas de nacimiento de tus clientes para ver oportunidades.</p>
          ) : op.map((o) => (
            <div key={o.cliente_id} className="rounded-xl bg-white p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-black">{o.nombre ?? 'Cliente'} <span className="text-black/40 font-normal">· DNI {o.dni}</span></p>
                <p className="text-xs text-black/50 mt-0.5">Cumple en <b className="text-[#B82D25]">{o.dias} días</b> · {new Date(o.fecha_nacimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}</p>
              </div>
              <button onClick={() => crearDesdeCumple(o)} className="shrink-0 rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">{o.tiene_evento ? 'Ver propuesta' : 'Armar propuesta →'}</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'pipeline' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {[['', 'Todos'], ...ESTADO].map(([k, label]) => (
                <button key={k} onClick={() => setFiltro(k)} className={`px-3 py-1.5 text-xs font-medium rounded-full border ${filtro === k ? 'border-[#B82D25] bg-white text-black' : 'border-black/10 text-black/50 hover:text-black'}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setNuevo(true)} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">+ Nuevo evento</button>
          </div>
          {nuevo && <NuevoEvento onClose={() => setNuevo(false)} onCreated={(id) => { setNuevo(false); refrescar(); abrir(id); }} />}
          {evs.length === 0 ? (
            <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">No hay eventos{filtro ? ' en este estado' : ''}.</p>
          ) : evs.map((e) => (
            <button key={e.id} onClick={() => abrir(e.id)} className="w-full text-left rounded-xl bg-white p-4 flex items-center justify-between gap-3 hover:bg-black/[0.02]">
              <div>
                <p className="text-sm font-semibold text-black">{e.nombre}</p>
                <p className="text-xs text-black/50 mt-0.5">{tipoLabel(e.tipo)}{e.cliente?.nombre ? ` · ${e.cliente.nombre}` : ''}{e.fecha ? ` · ${new Date(e.fecha).toLocaleDateString('es-AR')}` : ''}{e.invitados ? ` · ${e.invitados} inv.` : ''}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADO_BADGE[e.estado] ?? ''}`}>{estadoLabel(e.estado)}</span>
                {Number(e.presupuesto) > 0 && <p className="text-sm font-semibold text-black mt-1">{pesos(e.presupuesto)}</p>}
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
    <div className="rounded-xl bg-white p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none">
          {TIPO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del evento" className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none" />
        <input type="number" value={invitados} onChange={(e) => setInvitados(e.target.value)} placeholder="Invitados" className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none" />
      </div>
      <div className="flex gap-2">
        <button onClick={crear} disabled={guardando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F] disabled:opacity-50">{guardando ? 'Creando…' : 'Crear evento'}</button>
        <button onClick={onClose} className="text-sm text-black/45 hover:text-black">Cancelar</button>
      </div>
    </div>
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
      <button onClick={onBack} className="text-sm text-black/50 hover:text-black">← Volver</button>
      <div className="rounded-xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-black">{ev.nombre}</p>
            <p className="text-sm text-black/50">{tipoLabel(ev.tipo)}{ev.cliente?.nombre ? ` · ${ev.cliente.nombre} (DNI ${ev.cliente.dni})` : ' · sin cliente asociado'}{ev.fecha ? ` · ${new Date(ev.fecha).toLocaleDateString('es-AR')}` : ''}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADO_BADGE[ev.estado] ?? ''}`}>{estadoLabel(ev.estado)}</span>
        </div>
        <div className="flex items-end gap-3 mt-4 flex-wrap">
          <label className="text-sm text-black/60">Invitados
            <input type="number" value={invitados} onChange={(e) => setInvitados(e.target.value)} className="block mt-1 w-28 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
          </label>
          <button onClick={sugerir} disabled={sugiriendo} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{sugiriendo ? 'Pensando…' : '✨ Sugerir bebidas (IA)'}</button>
        </div>
      </div>

      <div className="rounded-xl bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-black">Propuesta</h3>
          <span className="text-lg font-semibold text-black">{pesos(total)}</span>
        </div>
        {items.length === 0 ? <p className="text-sm text-black/40 py-4 text-center">Sin ítems. Usá la sugerencia de IA o agregá productos.</p> : (
          <div className="divide-y divide-black/5">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm text-black">{it.descripcion}</span>
                <input type="number" value={it.cantidad} onChange={(e) => editar(i, 'cantidad', Number(e.target.value))} className="w-16 rounded-lg border border-black/15 px-2 py-1 text-sm text-black text-center outline-none" />
                <span className="w-24 text-right text-sm text-black/60">{pesos(it.precio_unitario)}</span>
                <span className="w-28 text-right text-sm font-medium text-black">{pesos(Number(it.cantidad) * Number(it.precio_unitario))}</span>
                <button onClick={() => setItems((c) => c.filter((_, idx) => idx !== i))} className="text-black/30 hover:text-[#B82D25] text-lg leading-none">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Agregar producto…" className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
          {res.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white shadow-lg overflow-hidden">
              {res.map((p) => (
                <button key={p.sku} onClick={() => agregar(p)} className="flex w-full items-center justify-between px-3 py-2 text-sm text-black hover:bg-[#F0EBE2]"><span>{p.nombre}</span><span className="text-black/45">{pesos(p.precio)}</span></button>
              ))}
            </div>
          )}
        </div>
      </div>

      {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-green-700' : 'text-[#932A1F]'}`}>{msg}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none">
          {ESTADO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button onClick={guardar} disabled={guardando} className="rounded-full bg-black text-white text-sm font-medium px-4 py-2 hover:bg-black/80 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar propuesta'}</button>
        <a href={`/api/eventos/${ev.id}/presupuesto`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#B82D25] text-[#B82D25] text-sm font-medium px-4 py-2 hover:bg-[#B82D25]/10">Descargar PDF</a>
        <button onClick={enviar} disabled={enviando || !ev.cliente_id} title={!ev.cliente_id ? 'El evento no tiene cliente asociado' : ''} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F] disabled:opacity-40">{enviando ? 'Enviando…' : 'Enviar al cliente'}</button>
      </div>
    </div>
  );
}
