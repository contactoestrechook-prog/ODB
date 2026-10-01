'use client';

import { useCallback, useEffect, useState } from 'react';

// Difusiones · O.D.B — campañas por listas y mensajes programados de la línea
// de WhatsApp. Hasta el 1/10/2026 esta pantalla se llamaba "RESPONDE · WhatsApp"
// y tenía una pestaña Charlas que mezclaba las del simulador con las reales:
// las conversaciones están en RESPONDE (/responde), una sola vez.
const fechaHora = (v?: string | null) => (v ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const bonito = (t: string) => (t.length === 13 && t.startsWith('549') ? `+54 9 ${t.slice(3, 5)} ${t.slice(5, 9)}-${t.slice(9)}` : `+${t}`);

async function post(body: any) {
  const r = await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j };
}

// ============================================================================
export function BandejaWhatsapp({ puedeApagarLinea }: { puedeApagarLinea: boolean }) {
  const [tab, setTab] = useState<'difusiones' | 'programados'>('difusiones');
  const [linea, setLinea] = useState<any>({ bot_activo: true });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rl = await fetch('/api/responde?recurso=linea&linea=pedidos', { cache: 'no-store' });
      if (rl.ok) setLinea(await rl.json());
    } catch { /* sin red: mantiene lo que hay */ }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 8000); return () => clearInterval(t); }, [cargar]);

  async function botLinea(activo: boolean) {
    if (ocupado) return;
    if (!activo && !window.confirm('¿Apagar RESPONDE en TODAS las conversaciones? Nadie recibe respuesta automática hasta que lo vuelvas a encender.')) return;
    setOcupado(true);
    try { await post({ accion: 'botLinea', linea: 'pedidos', activo }); await cargar(); } finally { setOcupado(false); }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F0EBE2]">
      <header className="bg-black px-4 pb-2 pt-4 text-[#F0EBE2]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#C9A96E] font-bold">Difusiones · O.D.B</p>
            <p className="text-lg font-black leading-tight">{linea?.numero_legible ?? '11 2281-2200'}</p>
          </div>
          <div className="text-right">
            <p className={`text-[11px] font-bold uppercase ${linea?.bot_activo === false ? 'text-amber-300' : 'text-emerald-400'}`}>
              {linea?.bot_activo === false ? '● Pausado en todas' : '● Atendiendo'}
            </p>
            {puedeApagarLinea && (
              <button onClick={() => botLinea(linea?.bot_activo === false)} disabled={ocupado}
                className="mt-1 rounded-full border border-white/25 px-2.5 py-0.5 text-[11px] text-white/80 disabled:opacity-40">
                {linea?.bot_activo === false ? 'Encender en todas' : 'Pausar en todas'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-1 border-b border-white/10">
          {([['difusiones', 'Difusiones'], ['programados', 'Programados']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-[#E14A3C] text-white' : 'border-transparent text-white/50'}`}>{l}</button>
          ))}
        </div>
      </header>

      {tab === 'programados' && <Programados />}
      {tab === 'difusiones' && <Difusiones puede={puedeApagarLinea} />}
    </div>
  );
}

// ============================================================================
function Programados() {
  const [items, setItems] = useState<any[]>([]);
  const cargar = useCallback(async () => {
    const r = await fetch('/api/responde?recurso=programados', { cache: 'no-store' });
    if (r.ok) setItems(await r.json());
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 15000); return () => clearInterval(t); }, [cargar]);
  async function cancelar(id: string) {
    if (!window.confirm('¿Cancelar este mensaje programado?')) return;
    await post({ accion: 'cancelarProgramado', id }); cargar();
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {items.length === 0 && <p className="px-6 py-14 text-center text-sm text-black/45">No hay mensajes programados. Desde una charla, el reloj 🕒 programa uno.</p>}
      {items.map((m) => (
        <div key={m.id} className="border-b border-black/5 bg-white px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{bonito(m.telefono)}</p>
            <span className="text-[11px] font-semibold text-[#B82D25]">{fechaHora(m.enviar_en)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-black/65">{m.texto}</p>
          {m.error && <p className="mt-0.5 text-[11px] text-[#932A1F]">Falló: {m.error}</p>}
          <button onClick={() => cancelar(m.id)} className="mt-1 text-xs text-black/45 underline">Cancelar</button>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
function Difusiones({ puede }: { puede: boolean }) {
  const [hist, setHist] = useState<any[]>([]);
  const [base, setBase] = useState<any[]>([]);
  const [armando, setArmando] = useState(false);
  const [texto, setTexto] = useState('');
  const [titulo, setTitulo] = useState('');
  const [segmento, setSegmento] = useState<'todos' | 'activo' | 'enfriándose' | 'dormido'>('todos');
  const [origen, setOrigen] = useState<'todos' | 'cliente' | 'agenda'>('todos');
  const [barrio, setBarrio] = useState<string>('todos');
  const [soloNuevos, setSoloNuevos] = useState(true);
  const [listas, setListas] = useState<any[]>([]);
  const [listaId, setListaId] = useState<string>('');
  const [telsLista, setTelsLista] = useState<Set<string> | null>(null);
  const [programarPara, setProgramarPara] = useState<string>('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/responde?recurso=difusiones', { cache: 'no-store' });
    if (r.ok) setHist(await r.json());
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 10000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { if (armando && !base.length) fetch('/api/responde?recurso=base').then((r) => r.ok ? r.json() : []).then(setBase); }, [armando, base.length]);
  useEffect(() => { if (armando && !listas.length) fetch('/api/responde?recurso=listas').then((r) => r.ok ? r.json() : []).then(setListas); }, [armando, listas.length]);
  useEffect(() => {
    if (!listaId) { setTelsLista(null); return; }
    fetch(`/api/responde?recurso=listaTelefonos&id=${listaId}`)
      .then((r) => r.ok ? r.json() : { telefonos: [] })
      .then((d) => setTelsLista(new Set(d.telefonos ?? [])));
  }, [listaId]);

  // La lista se ARMA con filtros: estado de relación, origen (cliente real vs
  // agenda), barrio, y "sin difusiones previas" — que es lo que hace que las
  // campañas grandes salgan en tandas: hoy 300, mañana el filtro trae a los
  // que faltan. El tope de 300 por tanda lo controla también el servidor.
  const barrios = Array.from(new Set(base.map((b) => b.barrio).filter(Boolean))).sort() as string[];
  const filtrados = base.filter((b) =>
    (!telsLista || telsLista.has(b.telefono_wa)) &&
    (segmento === 'todos' ? true : b.estado_relacion === segmento) &&
    (origen === 'todos' ? true : b.origen === origen) &&
    (barrio === 'todos' ? true : b.barrio === barrio) &&
    (!soloNuevos || !b.ultima_difusion),
  );
  const destinatarios = filtrados.slice(0, 300);
  const recortada = filtrados.length > 300;

  async function enviar() {
    if (!texto.trim() || !destinatarios.length || enviando) return;
    if (!window.confirm(`¿Enviar a ${destinatarios.length} contacto(s)? Sale con pausa entre mensajes.`)) return;
    setEnviando(true); setAviso('');
    const r = await post({ accion: 'difusion', linea: 'pedidos', titulo, texto, telefonos: destinatarios.map((d) => d.telefono_wa), ...(programarPara ? { programadaPara: new Date(programarPara).toISOString() } : {}) });
    if (r.ok) { setAviso(r.programadaPara ? `Difusión programada: ${r.total} destinatarios.` : `Difusión en marcha: ${r.total} destinatarios.`); setTexto(''); setTitulo(''); setProgramarPara(''); setArmando(false); cargar(); }
    else setAviso(r?.message ?? 'No se pudo crear la difusión');
    setEnviando(false);
  }

  if (!puede) return <p className="px-6 py-14 text-center text-sm text-black/45">Las difusiones las manda gerencia.</p>;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="bg-white px-4 py-3">
        {!armando ? (
          <button onClick={() => setArmando(true)} className="w-full rounded-lg bg-[#B82D25] py-2.5 text-sm font-medium text-white">Nueva difusión</button>
        ) : (
          <div className="space-y-2">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título interno (ej: Oferta vinos agosto)" className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#B82D25]" />
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="El mensaje que van a recibir…" className="w-full resize-none rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#B82D25]" />
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-black/50">Lista:</span>
              <select value={listaId} onChange={(e) => setListaId(e.target.value)} className="rounded-full bg-black/5 px-2.5 py-1 text-black/70 outline-none max-w-[260px]">
                <option value="">toda la base</option>
                {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre} ({l.miembros})</option>)}
              </select>
              {listaId && telsLista === null && <span className="text-black/40">cargando lista…</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-black/50">Relación:</span>
              {(['todos', 'activo', 'enfriándose', 'dormido'] as const).map((s) => (
                <button key={s} onClick={() => setSegmento(s)} className={`rounded-full px-2.5 py-1 ${segmento === s ? 'bg-black text-white' : 'bg-black/5 text-black/70'}`}>{s}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-black/50">Origen:</span>
              {([['todos', 'todos'], ['cliente', 'clientes reales'], ['agenda', 'agenda']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setOrigen(v)} className={`rounded-full px-2.5 py-1 ${origen === v ? 'bg-black text-white' : 'bg-black/5 text-black/70'}`}>{l}</button>
              ))}
              {barrios.length > 0 && (
                <select value={barrio} onChange={(e) => setBarrio(e.target.value)} className="rounded-full bg-black/5 px-2.5 py-1 text-black/70 outline-none">
                  <option value="todos">todos los barrios</option>
                  {barrios.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-black/70">
                <input type="checkbox" checked={soloNuevos} onChange={(e) => setSoloNuevos(e.target.checked)} />
                solo sin difusiones previas (arma las tandas)
              </label>
              <span className="ml-auto font-semibold">
                {destinatarios.length} destinatario(s){recortada ? ` · tanda de 300 (quedan ${filtrados.length - 300} para la próxima)` : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-black/50">Enviar:</span>
              <label className="flex items-center gap-1.5 text-black/70">
                <input type="radio" name="cuando" checked={!programarPara} onChange={() => setProgramarPara('')} /> ahora
              </label>
              <label className="flex items-center gap-1.5 text-black/70">
                <input type="radio" name="cuando" checked={!!programarPara} onChange={() => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); setProgramarPara(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)); }} /> programar:
              </label>
              {programarPara !== '' && (
                <input type="datetime-local" value={programarPara} onChange={(e) => setProgramarPara(e.target.value)} className="rounded-lg border border-black/15 px-2 py-1" />
              )}
            </div>
            <p className="text-[11px] text-black/45">Solo a quien dio permiso. Sale de a uno con pausa para cuidar el número; el tope es 300 por tanda — mañana el filtro trae a los que faltan.</p>
            <div className="flex gap-2">
              <button onClick={enviar} disabled={enviando || !texto.trim() || !destinatarios.length} className="flex-1 rounded-lg bg-[#B82D25] py-2 text-sm font-medium text-white disabled:opacity-40">{enviando ? 'Enviando…' : 'Enviar'}</button>
              <button onClick={() => setArmando(false)} className="rounded-lg border border-black/15 px-3 py-2 text-sm">Cancelar</button>
            </div>
          </div>
        )}
        {aviso && <p className="mt-2 text-xs text-black/60">{aviso}</p>}
      </div>
      {hist.map((d: any) => d.programada_para && !d.despachada_en ? (
        <div key={d.id} className="border-b border-black/5 px-4 py-3 bg-amber-50/60">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">🕒 {d.titulo || 'Difusión programada'}</p>
            <span className="text-xs font-medium text-amber-800">
              programada · {new Date(d.programada_para).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} hs
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-black/55">{d.texto}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-black/45">{d.total} destinatario(s)</span>
            <button
              onClick={async () => { if (window.confirm('¿Cancelar esta difusión programada?')) { await post({ accion: 'cancelarDifusion', id: d.id }); cargar(); } }}
              className="text-xs text-red-700 underline">Cancelar</button>
          </div>
        </div>
      ) : (
        <div key={d.id} className="border-b border-black/5 bg-white px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{d.titulo || '(sin título)'}</p>
            <span className="text-[11px] text-black/40">{fechaHora(d.creado_en)}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-black/60">{d.texto}</p>
          <p className="mt-1 text-[11px] text-black/50">
            {d.enviados}/{d.total} enviados{d.fallidos ? ` · ${d.fallidos} fallidos` : ''}{d.terminada_en ? ' · terminada' : ' · en curso…'}
          </p>
        </div>
      ))}
    </div>
  );
}
