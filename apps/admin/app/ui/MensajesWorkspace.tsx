'use client';

import { useEffect, useState } from 'react';
import { fechaHora } from '../lib/formato';
import {
  AreaTexto,
  Aviso,
  Boton,
  Cargando,
  Chips,
  Entrada,
  Etiqueta,
  FOCO,
  Kpi,
  Pestanas,
  Selector,
  Tarjeta,
  Vacio,
  unir,
  type TonoEtiqueta,
} from './kit';

const TABS = [['solicitudes', 'Solicitudes'], ['enviar', 'Enviar'], ['automaticas', 'Automáticas'], ['historial', 'Historial']] as const;
const ESTADOS: [string, string][] = [['', 'Todas'], ['abierta', 'Abiertas'], ['en_proceso', 'En proceso'], ['resuelta', 'Resueltas'], ['cerrada', 'Cerradas']];
const ESTADO_TONO: Record<string, TonoEtiqueta> = {
  abierta: 'atencion', en_proceso: 'info', resuelta: 'ok', cerrada: 'neutro',
};
const TIPO_LABEL: Record<string, string> = { devolucion: 'Devolución', consulta: 'Consulta', pedido: 'Pedido especial', reclamo: 'Reclamo' };
const TIPO_NOTIF: Record<string, string> = { solicitud: 'Respuesta', manual: 'Envío manual', cumple: 'Cumpleaños', reactivacion: 'Reactivación', general: 'General' };
const fecha = (iso?: string) => fechaHora(iso, { vacio: '' });

// Los mensajes de éxito llegan con "✓ " adelante: se muestran en un aviso
// verde y sin el tilde (el aviso ya trae su ícono).
const tonoMsg = (msg: string) => (msg.startsWith('✓') ? 'ok' : 'error');
const sinTilde = (msg: string) => msg.replace(/^✓\s*/, '');

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

  const abiertas = kpi?.solicitudes?.abiertas ?? 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta={<span className="whitespace-normal">Solicitudes abiertas</span>} valor={abiertas} tono={Number(abiertas) > 0 ? 'atencion' : 'neutro'} />
        <Kpi etiqueta="En proceso" valor={kpi?.solicitudes?.enProceso ?? 0} />
        <Kpi etiqueta={<span className="whitespace-normal">Notificaciones</span>} valor={kpi?.notificaciones?.total ?? 0} />
        <Kpi etiqueta="% leídas" valor={(kpi?.notificaciones?.pctLeidas ?? 0) + '%'} />
      </div>

      <Pestanas
        etiquetaAccesible="Secciones de mensajes"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {/* ---------- SOLICITUDES ---------- */}
      {tab === 'solicitudes' && (
        <div className="space-y-3">
          <Chips
            etiquetaAccesible="Estado de la solicitud"
            valor={filtro}
            onCambiar={setFiltro}
            opciones={ESTADOS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
          />
          {sols.length === 0 ? (
            <Vacio titulo="No hay solicitudes para este filtro." texto="Probá con otro estado o con Todas." />
          ) : sols.map((s) => (
            <Tarjeta key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-semibold text-tinta">{s.asunto || TIPO_LABEL[s.tipo]}</p>
                  <p className="mt-0.5 break-words text-sm text-tinta/60">{TIPO_LABEL[s.tipo] ?? s.tipo} · {s.cliente?.nombre ?? 'Cliente'} (DNI {s.cliente?.dni ?? '—'}) · {fecha(s.creado_en)}</p>
                </div>
                <Etiqueta tono={ESTADO_TONO[s.estado] ?? 'neutro'} className="shrink-0">{ESTADOS.find((e) => e[0] === s.estado)?.[1] ?? s.estado}</Etiqueta>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-tinta/80">{s.mensaje}</p>
              {s.respuesta && (
                <div className="mt-3 rounded-xl border-l-2 border-marca bg-crema-claro p-3">
                  <p className="mb-0.5 text-xs font-semibold text-marca-hondo">Respuesta enviada {s.respondido_en ? `· ${fecha(s.respondido_en)}` : ''}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-tinta/80">{s.respuesta}</p>
                </div>
              )}
              {abierto === s.id ? (
                <div className="mt-3 space-y-3">
                  <AreaTexto value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Escribí la respuesta para el cliente…" rows={3} aria-label="Respuesta para el cliente" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Selector value={estadoSel} onChange={(e) => setEstadoSel(e.target.value)} aria-label="Estado de la solicitud" className="w-full sm:w-auto">
                      <option value="en_proceso">Marcar en proceso</option>
                      <option value="resuelta">Marcar resuelta</option>
                      <option value="cerrada">Cerrar</option>
                    </Selector>
                    <Boton onClick={() => responder(s.id)} cargando={guardando}>{guardando ? 'Enviando…' : 'Responder y notificar'}</Boton>
                    <Boton variante="fantasma" onClick={() => { setAbierto(null); setResp(''); }}>Cancelar</Boton>
                  </div>
                </div>
              ) : (
                <Boton
                  variante="secundario"
                  tamano="chico"
                  className="mt-3"
                  onClick={() => { setAbierto(s.id); setResp(s.respuesta ?? ''); setEstadoSel(s.estado === 'abierta' ? 'resuelta' : s.estado); }}
                >
                  {s.respuesta ? 'Editar / cambiar estado' : 'Responder'}
                </Boton>
              )}
            </Tarjeta>
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
    <Tarjeta className="max-w-2xl space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-tinta">¿A quién?</p>
        <Chips
          etiquetaAccesible="Destino de la notificación"
          valor={destino}
          onCambiar={(k) => setDestino(k as any)}
          opciones={[{ valor: 'segmento', etiqueta: 'Un segmento' }, { valor: 'todos', etiqueta: 'Todos' }, { valor: 'cliente', etiqueta: 'Un cliente' }]}
        />
      </div>

      {destino === 'segmento' && (
        <div className="flex flex-wrap gap-2">
          {segmentos.map((s) => (
            <button
              key={s.tipo}
              onClick={() => setSegmento(s.tipo)}
              aria-pressed={segmento === s.tipo}
              className={unir(
                'min-h-11 min-w-0 rounded-xl border bg-white px-3 py-2 text-left transition-colors',
                FOCO,
                segmento === s.tipo ? 'border-marca ring-1 ring-marca' : 'border-black/15 hover:border-black/25',
              )}
            >
              <span className="block text-sm font-medium capitalize text-tinta">{s.tipo}</span>
              <span className="block text-xs text-tinta/60">{s.total} clientes</span>
            </button>
          ))}
        </div>
      )}
      {destino === 'todos' && <p className="text-sm text-tinta/70">Se enviará a todos los clientes que aceptan recibir novedades.</p>}
      {destino === 'cliente' && (
        <div>
          {cliente ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-marca bg-white px-3 py-2">
              <span className="min-w-0 break-words text-sm text-tinta">{cliente.nombre} · DNI {cliente.dni}</span>
              <Boton variante="fantasma" tamano="chico" onClick={() => { setCliente(null); setQ(''); }}>Cambiar</Boton>
            </div>
          ) : (
            <div className="relative">
              <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre o DNI…" aria-label="Buscar cliente" />
              {resultados.length > 0 && (
                <div className="absolute z-contenido mt-1 w-full overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-flotante">
                  {resultados.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setCliente(c); setResultados([]); }}
                      className={unir('block min-h-11 w-full px-3 py-2 text-left text-sm text-tinta hover:bg-crema-claro', 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca')}
                    >
                      {c.nombre ?? c.razon_social ?? 'Cliente'} · DNI {c.dni ?? '—'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ej: Llegó tu vino favorito 🍷)" aria-label="Título" />
      <AreaTexto value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder="Mensaje…" rows={3} aria-label="Mensaje" />
      {msg && <Aviso tono={tonoMsg(msg)}>{sinTilde(msg)}</Aviso>}
      <div className="flex flex-wrap items-center gap-3">
        <Boton onClick={enviar} cargando={enviando}>{enviando ? 'Enviando…' : 'Enviar notificación'}</Boton>
        <span className="text-sm text-tinta/60">
          {destino === 'segmento' ? `≈ ${segActual?.total ?? 0} clientes` : destino === 'todos' ? 'Todos los suscriptos' : cliente ? '1 cliente' : 'Elegí un cliente'}
        </span>
      </div>
    </Tarjeta>
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
    { t: 'Cumpleaños', d: 'Cada día a las 9:00 se saluda a los clientes que cumplen años (con un regalo). Necesita cargar la fecha de nacimiento del cliente.', n: prev?.cumpleanosHoy },
    { t: 'Reactivación', d: `Clientes que compraron alguna vez pero no en los últimos ${prev?.dias ?? 45} días reciben un recordatorio con las ofertas.`, n: prev?.inactivos },
  ];
  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {REGLAS.map((r) => (
          <Tarjeta key={r.t}>
            <p className="text-base font-semibold text-tinta">{r.t}</p>
            <p className="mt-1 text-sm leading-relaxed text-tinta/70">{r.d}</p>
            <p className="importe mt-3 text-2xl font-semibold text-tinta">{r.n ?? 0}</p>
            <p className="text-xs text-tinta/60">recibirían hoy</p>
          </Tarjeta>
        ))}
      </div>
      {msg && <Aviso tono={tonoMsg(msg)}>{sinTilde(msg)}</Aviso>}
      <Boton onClick={correr} cargando={corriendo}>{corriendo ? 'Enviando…' : 'Correr automáticas ahora'}</Boton>
      <p className="text-sm text-tinta/60">Corren solas todos los días a las 9:00 (ART). Este botón es para dispararlas manualmente.</p>
    </div>
  );
}

// ---------- HISTORIAL ----------
function Historial() {
  const [lista, setLista] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  useEffect(() => { fetch('/api/mensajes/historial').then((r) => r.json()).then((d) => { setLista(Array.isArray(d) ? d : []); setCargando(false); }).catch(() => setCargando(false)); }, []);
  if (cargando) return <Tarjeta><Cargando bloque /></Tarjeta>;
  if (!lista.length) return <Vacio titulo="Todavía no se envió ninguna notificación." texto="Las que mandes desde Enviar o las automáticas quedan registradas acá." />;
  return (
    <Tarjeta relleno={false} className="divide-y divide-black/[0.06] overflow-hidden">
      {lista.map((n) => (
        <div key={n.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-tinta">{n.titulo}</p>
            <p className="truncate text-sm text-tinta/70">{n.cuerpo}</p>
            <p className="mt-0.5 text-xs text-tinta/60">{n.cliente?.nombre ?? 'Cliente'} · {fecha(n.creado_en)}</p>
          </div>
          <div className="shrink-0 text-right">
            <Etiqueta>{TIPO_NOTIF[n.tipo] ?? n.tipo}</Etiqueta>
            <p className={unir('mt-1 text-xs', n.leida ? 'text-ok' : 'text-tinta/60')}>{n.leida ? 'Leída' : 'No leída'}</p>
          </div>
        </div>
      ))}
    </Tarjeta>
  );
}
