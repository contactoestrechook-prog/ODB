'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// RESPONDE · O.D.B — la app del empleado virtual, para el celular de quien
// atiende. Charlas (pausar el bot, contestar, devolver), ficha y notas del
// contacto, mensajes programados y difusiones. Un solo lugar, marca RESPONDE.
type Conv = {
  linea: string; telefono: string; nombre: string | null; actualizado_en: string;
  ultimo: string; ultimoRol: string | null; pausada: boolean; derivada: boolean;
  derivadaMotivo: string | null; sinLeer: boolean; turnos: number;
};

const hora = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');
const fechaCorta = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v); const hoy = new Date();
  return d.toDateString() === hoy.toDateString() ? hora(v) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};
const fechaHora = (v?: string | null) => (v ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const bonito = (t: string) => (t.length === 13 && t.startsWith('549') ? `+54 9 ${t.slice(3, 5)} ${t.slice(5, 9)}-${t.slice(9)}` : `+${t}`);
const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

async function post(body: any) {
  const r = await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j };
}

// ============================================================================
export function BandejaWhatsapp({ puedeApagarLinea }: { puedeApagarLinea: boolean }) {
  const [tab, setTab] = useState<'chats' | 'programados' | 'difusiones'>('chats');
  const [convs, setConvs] = useState<Conv[]>([]);
  const [filtro, setFiltro] = useState<'todas' | 'pausadas' | 'sinleer'>('todas');
  const [sel, setSel] = useState<Conv | null>(null);
  const [linea, setLinea] = useState<any>({ bot_activo: true });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [rc, rl] = await Promise.all([
        fetch('/api/responde?recurso=conversaciones', { cache: 'no-store' }),
        fetch('/api/responde?recurso=linea&linea=pedidos', { cache: 'no-store' }),
      ]);
      if (rc.ok) setConvs(await rc.json());
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

  const lista = convs.filter((c) => filtro === 'todas' ? true : filtro === 'pausadas' ? c.pausada : c.sinLeer);
  const nSinLeer = convs.filter((c) => c.sinLeer).length;
  const nPausadas = convs.filter((c) => c.pausada).length;

  if (sel) return <Charla conv={sel} onVolver={() => { setSel(null); cargar(); }} onCambio={cargar} />;

  return (
    <div className="flex h-[100dvh] flex-col bg-[#F0EBE2]">
      <header className="bg-black px-4 pb-2 pt-4 text-[#F0EBE2]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#C9A96E] font-bold">RESPONDE<span className="text-[#E14A3C]">.</span> · O.D.B</p>
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
          {([['chats', 'Charlas'], ['programados', 'Programados'], ['difusiones', 'Difusiones']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-[#E14A3C] text-white' : 'border-transparent text-white/50'}`}>{l}</button>
          ))}
        </div>
      </header>

      {tab === 'chats' && (
        <>
          <div className="flex gap-1.5 bg-black px-4 pb-3 pt-2">
            {([['todas', `Todas (${convs.length})`], ['sinleer', `Sin leer (${nSinLeer})`], ['pausadas', `Pausadas (${nPausadas})`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${filtro === k ? 'bg-[#F0EBE2] text-black' : 'bg-white/10 text-white/70'}`}>{l}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {lista.length === 0 && (
              <p className="px-6 py-14 text-center text-sm text-black/45">
                {filtro === 'todas' ? 'Todavía no hay conversaciones.' : filtro === 'sinleer' ? 'Nada sin leer.' : 'Ninguna charla pausada.'}
              </p>
            )}
            {lista.map((c) => (
              <button key={c.linea + c.telefono} onClick={() => setSel(c)}
                className="flex w-full items-start gap-3 border-b border-black/5 bg-white px-4 py-3 text-left active:bg-[#F0EBE2]">
                <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${c.sinLeer ? 'bg-[#B82D25]' : 'bg-transparent'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-[15px] ${c.sinLeer ? 'font-bold text-black' : 'font-medium text-black/85'}`}>{c.nombre ?? bonito(c.telefono)}</p>
                    <span className="shrink-0 text-[11px] text-black/40">{fechaCorta(c.actualizado_en)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-black/55">{c.ultimoRol === 'assistant' ? '🤖 ' : ''}{c.ultimo || '(sin mensajes)'}</p>
                  {(c.pausada || c.derivada) && (
                    <p className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                      {c.pausada ? '⏸ pausado' : '🟡 derivada'}{c.derivadaMotivo ? ` · ${c.derivadaMotivo}` : ''}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'programados' && <Programados />}
      {tab === 'difusiones' && <Difusiones puede={puedeApagarLinea} />}
    </div>
  );
}

// ============================================================================
function Charla({ conv, onVolver, onCambio }: { conv: Conv; onVolver: () => void; onCambio: () => void }) {
  const [c, setC] = useState<Conv>(conv);
  const [detalle, setDetalle] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [panel, setPanel] = useState<'ficha' | 'programar' | null>(null);
  const [ficha, setFicha] = useState<any>(null);
  const [nota, setNota] = useState('');
  const [progTexto, setProgTexto] = useState('');
  const [progCuando, setProgCuando] = useState('');
  const finRef = useRef<HTMLDivElement>(null);

  const cargarDetalle = useCallback(async () => {
    const r = await fetch(`/api/responde?recurso=detalle&linea=${c.linea}&telefono=${c.telefono}`, { cache: 'no-store' });
    if (r.ok) setDetalle(await r.json());
  }, [c.linea, c.telefono]);

  useEffect(() => {
    cargarDetalle();
    post({ accion: 'leida', linea: c.linea, telefono: c.telefono }).catch(() => null);
    const t = setInterval(cargarDetalle, 6000);
    return () => clearInterval(t);
  }, [cargarDetalle, c.linea, c.telefono]);
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [detalle]);

  async function abrirFicha() {
    setPanel(panel === 'ficha' ? null : 'ficha');
    if (!ficha) {
      const r = await fetch(`/api/responde?recurso=ficha&telefono=${c.telefono}`, { cache: 'no-store' });
      if (r.ok) { const f = await r.json(); setFicha(f); setNota(f?.contacto?.notas_equipo ?? ''); }
    }
  }

  async function accion(a: 'pausar' | 'devolver') {
    if (ocupado) return;
    setOcupado(true); setAviso('');
    try {
      const r = await post({ accion: a, linea: c.linea, telefono: c.telefono });
      if (!r.ok) setAviso('No se pudo cambiar el estado');
      setC((x) => ({ ...x, pausada: a === 'pausar' }));
      onCambio();
    } finally { setOcupado(false); }
  }

  async function responder() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setAviso('');
    try {
      const r = await post({ linea: c.linea, telefono: c.telefono, texto: t });
      if (!r.ok) { setAviso(r?.message ?? 'No se pudo enviar'); return; }
      if (r?.enviado === false) setAviso(`Quedó en el hilo pero no salió (${r.motivo ?? 'sin conexión'}). Reintentá.`);
      setTexto(''); setC((x) => ({ ...x, pausada: true }));
      await cargarDetalle(); onCambio();
    } catch { setAviso('No se pudo enviar'); }
    finally { setEnviando(false); }
  }

  async function guardarNota() {
    const r = await post({ accion: 'nota', telefono: c.telefono, nota });
    setAviso(r.ok ? 'Nota guardada' : 'No se pudo guardar la nota');
  }

  async function programar() {
    if (!progTexto.trim() || !progCuando) return;
    const r = await post({ accion: 'programar', linea: c.linea, telefono: c.telefono, texto: progTexto, enviarEn: new Date(progCuando).toISOString() });
    if (r.ok) { setAviso(`Programado para ${fechaHora(r.enviar_en)}`); setProgTexto(''); setProgCuando(''); setPanel(null); }
    else setAviso(r?.message ?? 'No se pudo programar');
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#ECE5DD]">
      <header className="flex items-center gap-2 bg-black px-3 py-2.5 text-[#F0EBE2]">
        <button onClick={onVolver} className="rounded-lg px-2 py-1 text-lg leading-none">‹</button>
        <button onClick={abrirFicha} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold">{c.nombre ?? bonito(c.telefono)}</p>
          <p className="text-[11px] text-white/55">{c.nombre ? bonito(c.telefono) : 'tocar para ver la ficha'}</p>
        </button>
        <button onClick={() => setPanel(panel === 'programar' ? null : 'programar')} title="Programar mensaje" className="rounded-lg px-2 py-1 text-base">🕒</button>
        {c.pausada ? (
          <button onClick={() => accion('devolver')} disabled={ocupado} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">▶ Que siga</button>
        ) : (
          <button onClick={() => accion('pausar')} disabled={ocupado} className="rounded-full bg-[#B82D25] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">⏸ Pausar</button>
        )}
      </header>

      <div className={`px-3 py-1.5 text-center text-[11px] font-medium ${c.pausada ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
        {c.pausada ? 'RESPONDE está pausado en esta charla: la atendés vos.' : 'RESPONDE está atendiendo esta charla.'}
      </div>

      {panel === 'ficha' && (
        <div className="border-b border-black/10 bg-white px-4 py-3 text-sm">
          {!ficha ? <p className="text-black/45">Cargando ficha…</p> : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <span><b>Tipo:</b> {ficha.contacto?.tipo === 'proveedor' ? '🚚 Proveedor' : ficha.cliente ? '🛒 Cliente' : 'Sin identificar'}</span>
                {ficha.cliente?.dni && <span><b>DNI:</b> {ficha.cliente.dni}</span>}
                {ficha.cliente?.tipo && <span><b>Segmento:</b> {ficha.cliente.tipo}</span>}
                {ficha.compras && <span><b>Compras:</b> {ficha.compras.cantidad} · {pesos(ficha.compras.gastado)}{ficha.compras.ultima ? ` · última ${fechaCorta(ficha.compras.ultima)}` : ''}</span>}
                {ficha.contacto?.notas && <span className="basis-full text-black/60"><b>Dijo el bot:</b> {ficha.contacto.notas}</span>}
              </div>
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Notas del equipo sobre este contacto…"
                className="mt-2 w-full resize-none rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#B82D25]" />
              <button onClick={guardarNota} className="mt-1 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white">Guardar nota</button>
            </>
          )}
        </div>
      )}

      {panel === 'programar' && (
        <div className="border-b border-black/10 bg-white px-4 py-3 text-sm space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/50">Programar un mensaje</p>
          <textarea value={progTexto} onChange={(e) => setProgTexto(e.target.value)} rows={2} placeholder="Texto que le va a llegar…"
            className="w-full resize-none rounded-lg border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#B82D25]" />
          <div className="flex items-center gap-2">
            <input type="datetime-local" value={progCuando} onChange={(e) => setProgCuando(e.target.value)} className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" />
            <button onClick={programar} disabled={!progTexto.trim() || !progCuando} className="rounded-lg bg-[#B82D25] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Programar</button>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!detalle && <p className="py-10 text-center text-sm text-black/40">Cargando…</p>}
        {detalle?.burbujas?.map((b: any, i: number) => (
          <div key={i} className={`flex ${b.rol === 'user' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[84%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[14px] leading-snug shadow-sm ${b.rol === 'user' ? 'rounded-bl-sm bg-white' : 'rounded-br-sm bg-[#DCF8C6]'}`}>{b.texto}</div>
          </div>
        ))}
        <div ref={finRef} />
      </div>

      <div className="border-t border-black/10 bg-white p-2">
        {aviso && <p className="mb-1 px-1 text-xs text-[#932A1F]">{aviso}</p>}
        <div className="flex items-end gap-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); responder(); } }}
            rows={1} placeholder={c.pausada ? 'Escribí tu respuesta…' : 'Escribir pausa a RESPONDE en esta charla…'}
            className="max-h-32 flex-1 resize-none rounded-2xl border border-black/15 px-3.5 py-2.5 text-[15px] text-black outline-none focus:border-[#B82D25]" />
          <button onClick={responder} disabled={enviando || !texto.trim()} className="h-11 w-11 shrink-0 rounded-full bg-[#B82D25] text-white active:scale-95 disabled:opacity-40">➤</button>
        </div>
      </div>
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
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/responde?recurso=difusiones', { cache: 'no-store' });
    if (r.ok) setHist(await r.json());
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 10000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { if (armando && !base.length) fetch('/api/responde?recurso=base').then((r) => r.ok ? r.json() : []).then(setBase); }, [armando, base.length]);

  const destinatarios = base.filter((b) => segmento === 'todos' ? true : b.estado_relacion === segmento);

  async function enviar() {
    if (!texto.trim() || !destinatarios.length || enviando) return;
    if (!window.confirm(`¿Enviar a ${destinatarios.length} contacto(s)? Sale con pausa entre mensajes.`)) return;
    setEnviando(true); setAviso('');
    const r = await post({ accion: 'difusion', linea: 'pedidos', titulo, texto, telefonos: destinatarios.map((d) => d.telefono_wa) });
    if (r.ok) { setAviso(`Difusión en marcha: ${r.total} destinatarios.`); setTexto(''); setTitulo(''); setArmando(false); cargar(); }
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
              <span className="text-black/50">A:</span>
              {(['todos', 'activo', 'enfriándose', 'dormido'] as const).map((s) => (
                <button key={s} onClick={() => setSegmento(s)} className={`rounded-full px-2.5 py-1 ${segmento === s ? 'bg-black text-white' : 'bg-black/5 text-black/70'}`}>{s}</button>
              ))}
              <span className="ml-auto font-semibold">{destinatarios.length} destinatario(s)</span>
            </div>
            <p className="text-[11px] text-black/45">Solo a quien dio permiso para recibir novedades. Sale de a uno, con pausa, para cuidar el número.</p>
            <div className="flex gap-2">
              <button onClick={enviar} disabled={enviando || !texto.trim() || !destinatarios.length} className="flex-1 rounded-lg bg-[#B82D25] py-2 text-sm font-medium text-white disabled:opacity-40">{enviando ? 'Enviando…' : 'Enviar'}</button>
              <button onClick={() => setArmando(false)} className="rounded-lg border border-black/15 px-3 py-2 text-sm">Cancelar</button>
            </div>
          </div>
        )}
        {aviso && <p className="mt-2 text-xs text-black/60">{aviso}</p>}
      </div>
      {hist.map((d) => (
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
