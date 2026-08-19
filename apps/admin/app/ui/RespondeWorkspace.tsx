'use client';

import { useCallback, useEffect, useState } from 'react';
import BotSimulador from './BotSimulador';

// RESPONDE — el empleado virtual de MetoGroup, empotrado en ODB.
// Bandeja de conversaciones reales (WhatsApp + simulador), métricas y prueba
// en vivo. El cerebro es el mismo bot que atiende pedidos y proveedores.
const fechaHora = (v?: string | null) => (v ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function RespondeWorkspace({ resumenInicial, conversacionesInicial, sinClave }: { resumenInicial: any; conversacionesInicial: any[]; sinClave?: boolean }) {
  const [tab, setTab] = useState<'app' | 'bandeja' | 'probar'>('app');
  const [resumen, setResumen] = useState<any>(resumenInicial ?? {});
  const [convs, setConvs] = useState<any[]>(conversacionesInicial ?? []);
  const [sel, setSel] = useState<any>(null); // {linea, telefono}
  const [detalle, setDetalle] = useState<any>(null);
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState('');

  // la bandeja respira sola: se actualiza cada 12 segundos
  const refrescar = useCallback(async () => {
    try {
      const [rc, rr] = await Promise.all([
        fetch('/api/responde?recurso=conversaciones'),
        fetch('/api/responde?recurso=resumen'),
      ]);
      if (rc.ok) setConvs(await rc.json());
      if (rr.ok) setResumen(await rr.json());
    } catch { /* mantiene lo que hay */ }
  }, []);
  useEffect(() => {
    const t = setInterval(refrescar, 12000);
    return () => clearInterval(t);
  }, [refrescar]);

  useEffect(() => {
    if (!sel) { setDetalle(null); return; }
    let vivo = true;
    (async () => {
      const r = await fetch(`/api/responde?recurso=detalle&linea=${sel.linea}&telefono=${sel.telefono}`);
      if (r.ok && vivo) setDetalle(await r.json());
    })();
    return () => { vivo = false; };
  }, [sel]);

  // Contestar desde acá sale por el número del local (vía el puente) y deja al
  // bot callado en esa conversación hasta que se la devuelvan.
  async function responder() {
    const texto = respuesta.trim();
    if (!sel || !texto || enviando) return;
    setEnviando(true);
    setAvisoEnvio('');
    try {
      const r = await fetch('/api/responde', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linea: sel.linea, telefono: sel.telefono, texto }),
      });
      const j = await r.json();
      if (!r.ok) { setAvisoEnvio(j?.message ?? 'No se pudo enviar'); return; }
      if (j?.enviado === false) setAvisoEnvio(`Quedó en el hilo pero el envío falló (${j.motivo ?? 'puente caído'}). Reintentá.`);
      setRespuesta('');
      const d = await fetch(`/api/responde?recurso=detalle&linea=${sel.linea}&telefono=${sel.telefono}`);
      if (d.ok) setDetalle(await d.json());
      refrescar();
    } catch {
      setAvisoEnvio('No se pudo enviar');
    } finally {
      setEnviando(false);
    }
  }

  async function devolverAlBot() {
    if (!sel) return;
    await fetch('/api/responde', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'devolver', linea: sel.linea, telefono: sel.telefono }),
    });
    refrescar();
    setAvisoEnvio('El bot vuelve a atender esta conversación.');
  }

  return (
    <div className="space-y-4">
      {/* identidad RESPONDE */}
      <div className="rounded-2xl bg-black text-[#F0EBE2] p-5 relative overflow-hidden">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#C9A96E] font-bold">Etapa 00 · Atención automatizada</p>
        <div className="flex items-end justify-between gap-4 mt-1 flex-wrap">
          <div>
            <h1 className="text-2xl font-black tracking-tight">RESPONDE<span className="text-[#E14A3C]">.</span></h1>
            <p className="text-xs text-white/60 mt-0.5">El primer empleado que nunca se cansa · atiende, organiza y vende · <span className="text-white/80">by MetoGroup</span></p>
          </div>
          <div className="flex gap-5">
            {[['Conversaciones', resumen.conversaciones ?? 0], ['Activas hoy', resumen.activasHoy ?? 0], ['Respuestas', Math.floor((resumen.turnos ?? 0) / 2)]].map(([l, v]: any) => (
              <div key={l} className="text-right">
                <p className="text-xl font-black tabular-nums leading-none">{v}</p>
                <p className="text-[10px] text-white/50 uppercase tracking-wide mt-1">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 border-b border-black/10">
        {[['app', 'La app RESPONDE'], ['bandeja', 'Bandeja del empleado ODB'], ['probar', 'Hablar con el empleado']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'app' && (
        <div className="rounded-xl overflow-hidden bg-white border border-black/10">
          {/* La app RESPONDE tal cual está desplegada (misma versión, mismo backend
              de MetoGroup y mismo login): servida desde este panel para poder
              empotrarla. WhatsApp real: chats, difusiones, programados, contactos. */}
          {/* con la key configurada en el servidor entra derecho: el que ya está
              logueado en ODB no tiene por qué ver otro cartel de contraseña */}
          <iframe
            src={sinClave ? '/responde-app.html?key=odb' : '/responde-app.html'}
            title="RESPONDE · MetoGroup"
            className="w-full border-0"
            style={{ height: 'calc(100vh - 290px)', minHeight: 480 }}
          />
        </div>
      )}

      {tab === 'probar' && (
        <div className="pt-1">
          <p className="text-xs text-black/50 mb-3">Es el mismo empleado que atiende WhatsApp: catálogo real, pedidos reales, cava real y cobro con link de Mercado Pago. Ojo: los pedidos que confirmes acá son reales.</p>
          <BotSimulador />
        </div>
      )}

      {tab === 'bandeja' && (
        <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-4 items-start">
          {/* lista de conversaciones */}
          <div className="rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/10 flex items-center justify-between">
              <p className="text-sm font-medium text-black">Conversaciones</p>
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-700 font-bold uppercase tracking-wide">
                <i className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse inline-block" /> En vivo
              </span>
            </div>
            {convs.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-black/40">Todavía no hay conversaciones. Probá el empleado en la otra pestaña o esperá el primer WhatsApp.</p>
            )}
            <div className="max-h-[60vh] overflow-y-auto">
              {convs.map((c) => (
                <button key={c.linea + c.telefono} onClick={() => setSel({ linea: c.linea, telefono: c.telefono })}
                  className={`w-full text-left px-4 py-3 border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/60 ${sel?.telefono === c.telefono && sel?.linea === c.linea ? 'bg-[#F0EBE2]' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-black">+{c.telefono}</p>
                    <span className="text-[10px] text-black/40">{fechaHora(c.actualizado_en)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-black/55 truncate flex-1">{c.ultimoRol === 'assistant' ? '🤖 ' : ''}{c.ultimo || '(sin mensajes)'}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${c.linea === 'pedidos' ? 'bg-[#B82D25]/10 text-[#B82D25]' : 'bg-black/10 text-black/60'}`}>{c.linea}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* detalle de la conversación */}
          <div className="rounded-xl bg-white overflow-hidden min-h-[300px]">
            {!sel ? (
              <div className="grid place-items-center h-full py-16 text-center px-6">
                <div>
                  <p className="text-3xl mb-2">💬</p>
                  <p className="text-sm text-black/45">Elegí una conversación para ver cómo trabajó el empleado.</p>
                </div>
              </div>
            ) : !detalle ? (
              <p className="px-4 py-10 text-center text-sm text-black/40">Cargando…</p>
            ) : (
              <>
                <div className="px-4 py-2.5 border-b border-black/10 flex items-center justify-between">
                  <p className="text-sm font-medium text-black">+{sel.telefono} · línea {sel.linea}</p>
                  <span className="text-[10px] text-black/40">{detalle.burbujas.length} mensajes</span>
                </div>
                <div className="max-h-[46vh] overflow-y-auto p-4 space-y-2 bg-[#ECE5DD]/60">
                  {detalle.burbujas.map((b: any, i: number) => (
                    <div key={i} className={`flex ${b.rol === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[82%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-snug shadow-sm ${b.rol === 'user' ? 'rounded-bl-sm bg-white' : 'rounded-br-sm bg-[#DCF8C6]'}`}>
                        {b.texto}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Contestar como persona: sale por el número del local y deja al
                    bot callado en esta conversación hasta que se la devuelvan. */}
                <div className="border-t border-black/10 p-3 space-y-2">
                  {avisoEnvio && <p className="text-xs text-[#932A1F]">{avisoEnvio}</p>}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={respuesta}
                      onChange={(e) => setRespuesta(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); responder(); } }}
                      rows={2}
                      placeholder="Escribí tu respuesta… (Enter envía, Shift+Enter salta de línea)"
                      className="flex-1 resize-none rounded-lg border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
                    />
                    <button
                      onClick={responder}
                      disabled={enviando || !respuesta.trim()}
                      className="rounded-lg bg-[#B82D25] px-4 py-2.5 text-sm font-medium text-white active:scale-95 disabled:opacity-40"
                    >
                      {enviando ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                  <button onClick={devolverAlBot} className="text-xs text-black/45 underline">
                    Listo, que siga el bot
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
