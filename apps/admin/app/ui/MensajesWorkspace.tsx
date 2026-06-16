'use client';

import { useEffect, useState } from 'react';

const ROJO = '#B82D25';
const TABS = [['solicitudes', 'Solicitudes'], ['enviar', 'Enviar'], ['automaticas', 'Automáticas'], ['historial', 'Historial']] as const;
const ESTADOS: [string, string][] = [['', 'Todas'], ['abierta', 'Abiertas'], ['en_proceso', 'En proceso'], ['resuelta', 'Resueltas'], ['cerrada', 'Cerradas']];
const ESTADO_BADGE: Record<string, string> = {
  abierta: 'bg-amber-100 text-amber-800', en_proceso: 'bg-blue-100 text-blue-800',
  resuelta: 'bg-green-100 text-green-800', cerrada: 'bg-black/10 text-black/60',
};
const TIPO_LABEL: Record<string, string> = { devolucion: 'Devolución', consulta: 'Consulta', pedido: 'Pedido especial', reclamo: 'Reclamo' };
const TIPO_NOTIF: Record<string, string> = { solicitud: 'Respuesta', manual: 'Envío manual', cumple: 'Cumpleaños', reactivacion: 'Reactivación', general: 'General' };
const fecha = (iso?: string) => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export function MensajesWorkspace({ resumen, solicitudesInicial }: { resumen: any; solicitudesInicial: any[] }) {
  const [tab, setTab] = useState('solicitudes');
  const [kpi, setKpi] = useState(resumen ?? {});

  // --- solicitudes ---
  const [sols, setSols] = useState<any[]>(solicitudesInicial ?? []);
  const [filtro, setFiltro] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [resp, setResp] = useState('');
  const [estadoSel, setEstadoSel] = useState('resuelta');
  const [guardando, setGuardando] = useState(false);

  const cargarSols = async (estado = filtro) => {
    const r = await fetch(`/api/solicitudes${estado ? `?estado=${estado}` : ''}`);
    if (r.ok) setSols(await r.json());
  };
  const refrescarKpi = async () => { const r = await fetch('/api/mensajes/resumen'); if (r.ok) setKpi(await r.json()); };
  useEffect(() => { if (tab === 'solicitudes') cargarSols(); }, [filtro]);

  const responder = async (id: string) => {
    if (guardando) return;
    setGuardando(true);
    try {
      await fetch(`/api/solicitudes/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: estadoSel, respuesta: resp }),
      });
      setAbierto(null); setResp('');
      await cargarSols(); await refrescarKpi();
    } finally { setGuardando(false); }
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Solicitudes abiertas', kpi?.solicitudes?.abiertas ?? 0],
          ['En proceso', kpi?.solicitudes?.enProceso ?? 0],
          ['Notificaciones', kpi?.notificaciones?.total ?? 0],
          ['% leídas', (kpi?.notificaciones?.pctLeidas ?? 0) + '%'],
        ].map(([l, v]: any, i) => (
          <div key={l} className={`rounded-xl p-4 ${i === 0 ? 'bg-[#B82D25] text-white' : 'bg-white'}`}>
            <p className={`text-xs ${i === 0 ? 'text-white/80' : 'text-black/50'}`}>{l}</p>
            <p className={`text-xl font-semibold ${i === 0 ? 'text-white' : 'text-black'}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>
        ))}
      </div>

      {/* ---------- SOLICITUDES ---------- */}
      {tab === 'solicitudes' && (
        <div className="space-y-4">
          <div className="flex gap-1.5 flex-wrap">
            {ESTADOS.map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`px-3 py-1.5 text-xs font-medium rounded-full border ${filtro === k ? 'border-[#B82D25] bg-white text-black' : 'border-black/10 text-black/50 hover:text-black'}`}>{label}</button>
            ))}
          </div>
          {sols.length === 0 ? (
            <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">No hay solicitudes para este filtro.</p>
          ) : sols.map((s) => (
            <div key={s.id} className="rounded-xl bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-black">{s.asunto || TIPO_LABEL[s.tipo]}</p>
                  <p className="text-xs text-black/45 mt-0.5">{TIPO_LABEL[s.tipo] ?? s.tipo} · {s.cliente?.nombre ?? 'Cliente'} (DNI {s.cliente?.dni ?? '—'}) · {fecha(s.creado_en)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADO_BADGE[s.estado] ?? ''}`}>{ESTADOS.find((e) => e[0] === s.estado)?.[1] ?? s.estado}</span>
              </div>
              <p className="text-sm text-black/70 mt-2">{s.mensaje}</p>
              {s.respuesta && (
                <div className="mt-3 rounded-lg bg-[#F0EBE2] p-3 border-l-2 border-[#B82D25]">
                  <p className="text-[11px] font-semibold text-[#B82D25] mb-0.5">Respuesta enviada {s.respondido_en ? `· ${fecha(s.respondido_en)}` : ''}</p>
                  <p className="text-sm text-black/80">{s.respuesta}</p>
                </div>
              )}
              {abierto === s.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Escribí la respuesta para el cliente…" rows={3} className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={estadoSel} onChange={(e) => setEstadoSel(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none">
                      <option value="en_proceso">Marcar en proceso</option>
                      <option value="resuelta">Marcar resuelta</option>
                      <option value="cerrada">Cerrar</option>
                    </select>
                    <button onClick={() => responder(s.id)} disabled={guardando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F] disabled:opacity-50">{guardando ? 'Enviando…' : 'Responder y notificar'}</button>
                    <button onClick={() => { setAbierto(null); setResp(''); }} className="text-sm text-black/45 hover:text-black">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setAbierto(s.id); setResp(s.respuesta ?? ''); setEstadoSel(s.estado === 'abierta' ? 'resuelta' : s.estado); }} className="mt-3 text-sm font-medium text-[#B82D25] hover:underline">{s.respuesta ? 'Editar / cambiar estado' : 'Responder →'}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'enviar' && <Enviar onSent={refrescarKpi} />}
      {tab === 'automaticas' && <Automaticas />}
      {tab === 'historial' && <Historial />}
    </div>
  );
}

// ---------- ENVIAR ----------
function Enviar({ onSent }: { onSent: () => void }) {
  const [destino, setDestino] = useState<'segmento' | 'todos' | 'cliente'>('segmento');
  const [segmentos, setSegmentos] = useState<any[]>([]);
  const [segmento, setSegmento] = useState('');
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [cliente, setCliente] = useState<any>(null);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { fetch('/api/mensajes/segmentos').then((r) => r.json()).then((d) => { setSegmentos(Array.isArray(d) ? d : []); if (Array.isArray(d) && d[0]) setSegmento(d[0].tipo); }).catch(() => {}); }, []);
  useEffect(() => {
    if (destino !== 'cliente' || q.length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(q)}`); if (r.ok) { const d = await r.json(); setResultados(Array.isArray(d) ? d.slice(0, 6) : (d.items ?? []).slice(0, 6)); } }, 250);
    return () => clearTimeout(t);
  }, [q, destino]);

  const enviar = async () => {
    if (!titulo.trim() || !cuerpo.trim() || enviando) return;
    setEnviando(true); setMsg(null);
    try {
      const body: any = { destino, titulo, cuerpo };
      if (destino === 'segmento') body.segmento = segmento;
      if (destino === 'cliente') body.clienteId = cliente?.id;
      const r = await fetch('/api/mensajes/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo enviar');
      setMsg(`✓ Enviado a ${d.enviados} cliente${d.enviados === 1 ? '' : 's'}.`);
      setTitulo(''); setCuerpo(''); onSent();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setEnviando(false); }
  };

  const segActual = segmentos.find((s) => s.tipo === segmento);
  return (
    <div className="rounded-xl bg-white p-5 max-w-2xl space-y-4">
      <div>
        <p className="text-sm font-medium text-black mb-2">¿A quién?</p>
        <div className="flex gap-2 flex-wrap">
          {[['segmento', 'Un segmento'], ['todos', 'Todos'], ['cliente', 'Un cliente']].map(([k, l]) => (
            <button key={k} onClick={() => setDestino(k as any)} className={`px-3.5 py-2 text-sm rounded-full border ${destino === k ? 'border-[#B82D25] bg-[#B82D25] text-white' : 'border-black/15 text-black/60 hover:text-black'}`}>{l}</button>
          ))}
        </div>
      </div>

      {destino === 'segmento' && (
        <div className="flex flex-wrap gap-2">
          {segmentos.map((s) => (
            <button key={s.tipo} onClick={() => setSegmento(s.tipo)} className={`px-3 py-2 rounded-lg border text-left ${segmento === s.tipo ? 'border-[#B82D25] bg-white' : 'border-black/10 bg-white'}`}>
              <span className="text-sm font-medium text-black capitalize">{s.tipo}</span>
              <span className="block text-xs text-black/45">{s.total} clientes</span>
            </button>
          ))}
        </div>
      )}
      {destino === 'todos' && <p className="text-sm text-black/55">Se enviará a todos los clientes que aceptan recibir novedades.</p>}
      {destino === 'cliente' && (
        <div>
          {cliente ? (
            <div className="flex items-center justify-between rounded-lg border border-[#B82D25] bg-white px-3 py-2">
              <span className="text-sm text-black">{cliente.nombre} · DNI {cliente.dni}</span>
              <button onClick={() => { setCliente(null); setQ(''); }} className="text-xs text-black/45 hover:text-black">Cambiar</button>
            </div>
          ) : (
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre o DNI…" className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
              {resultados.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white shadow-lg overflow-hidden">
                  {resultados.map((c) => (
                    <button key={c.id} onClick={() => { setCliente(c); setResultados([]); }} className="block w-full text-left px-3 py-2 text-sm text-black hover:bg-[#F0EBE2]">{c.nombre ?? c.razon_social ?? 'Cliente'} · DNI {c.dni ?? '—'}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ej: Llegó tu vino favorito 🍷)" className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
      <textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder="Mensaje…" rows={3} className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]" />
      {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-green-700' : 'text-[#932A1F]'}`}>{msg}</p>}
      <div className="flex items-center gap-3">
        <button onClick={enviar} disabled={enviando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar notificación'}</button>
        <span className="text-xs text-black/45">
          {destino === 'segmento' ? `≈ ${segActual?.total ?? 0} clientes` : destino === 'todos' ? 'Todos los suscriptos' : cliente ? '1 cliente' : 'Elegí un cliente'}
        </span>
      </div>
    </div>
  );
}

// ---------- AUTOMÁTICAS ----------
function Automaticas() {
  const [prev, setPrev] = useState<any>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cargar = () => fetch('/api/mensajes/automaticas').then((r) => r.json()).then(setPrev).catch(() => {});
  useEffect(() => { cargar(); }, []);
  const correr = async () => {
    if (corriendo) return; setCorriendo(true); setMsg(null);
    try { const r = await fetch('/api/mensajes/automaticas/correr', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Error'); setMsg(`✓ Enviadas: ${d.cumple ?? 0} de cumpleaños, ${d.reactivacion ?? 0} de reactivación.`); cargar(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); } finally { setCorriendo(false); }
  };
  const REGLAS = [
    { t: '🎂 Cumpleaños', d: 'Cada día a las 9:00 se saluda a los clientes que cumplen años (con un regalo). Necesita cargar la fecha de nacimiento del cliente.', n: prev?.cumpleanosHoy },
    { t: '🍷 Reactivación', d: `Clientes que compraron alguna vez pero no en los últimos ${prev?.dias ?? 45} días reciben un recordatorio con las ofertas.`, n: prev?.inactivos },
  ];
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        {REGLAS.map((r) => (
          <div key={r.t} className="rounded-xl bg-white p-4">
            <p className="text-sm font-semibold text-black">{r.t}</p>
            <p className="text-xs text-black/55 mt-1 leading-relaxed">{r.d}</p>
            <p className="text-2xl font-semibold text-[#B82D25] mt-2">{r.n ?? 0}</p>
            <p className="text-xs text-black/45">recibirían hoy</p>
          </div>
        ))}
      </div>
      {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-green-700' : 'text-[#932A1F]'}`}>{msg}</p>}
      <button onClick={correr} disabled={corriendo} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{corriendo ? 'Enviando…' : 'Correr automáticas ahora'}</button>
      <p className="text-xs text-black/40">Corren solas todos los días a las 9:00 (ART). Este botón es para dispararlas manualmente.</p>
    </div>
  );
}

// ---------- HISTORIAL ----------
function Historial() {
  const [lista, setLista] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  useEffect(() => { fetch('/api/mensajes/historial').then((r) => r.json()).then((d) => { setLista(Array.isArray(d) ? d : []); setCargando(false); }).catch(() => setCargando(false)); }, []);
  if (cargando) return <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">Cargando…</p>;
  if (!lista.length) return <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">Todavía no se envió ninguna notificación.</p>;
  return (
    <div className="rounded-xl bg-white overflow-hidden divide-y divide-black/5">
      {lista.map((n) => (
        <div key={n.id} className="px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-black">{n.titulo}</p>
            <p className="text-xs text-black/55 truncate">{n.cuerpo}</p>
            <p className="text-[11px] text-black/40 mt-0.5">{n.cliente?.nombre ?? 'Cliente'} · {fecha(n.creado_en)}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="rounded-full bg-black/[0.06] text-black/60 text-[11px] px-2 py-0.5">{TIPO_NOTIF[n.tipo] ?? n.tipo}</span>
            <p className={`text-[11px] mt-1 ${n.leida ? 'text-green-700' : 'text-black/35'}`}>{n.leida ? 'Leída' : 'No leída'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
