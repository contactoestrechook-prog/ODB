'use client';

import { useEffect, useRef, useState } from 'react';
import { hora } from '../lib/formato';
import { BotonMicrofono } from './BotonMicrofono';
import { AreaTexto, Aviso, Boton, unir } from './kit';
import { nombrePropio, type MensajePedido } from './salon/comun';

// LA CHARLA DEL PEDIDO entre quien lo arma y la caja (Juan Pablo, 20/11/2026: «si
// le tienen que hacer una consulta a la persona que se los asignó… tiene que
// estar previsto desde la app»). La usan el armado («Preguntarle a…»), el
// detalle del pedido en Pedidos y la ventana de la caja. Cada mensaje queda en
// el pedido con quién lo escribió, le aparece al otro lado en su pantalla y le
// llega por WhatsApp.

const primerNombre = (n?: string | null) => nombrePropio(n).split(' ')[0] || '';

export async function mandarMensaje(pedidoId: string, texto: string): Promise<{ mensajes: MensajePedido[]; avisado: string | null }> {
  const r = await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mensaje', pedidoId, texto }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message ?? 'No pude mandar el mensaje');
  return { mensajes: Array.isArray(d?.mensajes) ? d.mensajes : [], avisado: d?.avisado ?? null };
}

export function marcarVistos(pedidoId: string) {
  return fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mensajes-vistos', pedidoId }) }).catch(() => null);
}

export function CharlaPedido({ pedidoId, miLado, mensajes: dados, otro, onCambio, vacio, etiquetaCampo, autoFoco = false }: {
  pedidoId: string;
  /** de qué lado escribe esta persona */
  miLado: 'armado' | 'caja';
  /** si ya vienen con el pedido (el armado); si no, se piden al abrir */
  mensajes?: MensajePedido[];
  /** a quién le llega lo que escriba (para decirlo) */
  otro?: string | null;
  onCambio?: (m: MensajePedido[]) => void;
  /** qué decir cuando todavía no hay mensajes */
  vacio?: string;
  etiquetaCampo: string;
  autoFoco?: boolean;
}) {
  const [propios, setPropios] = useState<MensajePedido[] | null>(dados ?? null);
  const [texto, setTexto] = useState('');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mandado, setMandado] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const mensajes = dados ?? propios;

  // sin los mensajes a mano (detalle del pedido), se piden; y se refrescan solos
  useEffect(() => {
    if (dados) return;
    let vivo = true;
    const traer = () => fetch(`/api/salon?recurso=mensajes&pedidoId=${encodeURIComponent(pedidoId)}`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json().catch(() => null); if (vivo && r.ok && Array.isArray(d)) setPropios(d); else if (vivo && !r.ok) setPropios((x) => x ?? []); })
      .catch(() => { if (vivo) setPropios((x) => x ?? []); });
    traer();
    const t = setInterval(traer, 8000);
    return () => { vivo = false; clearInterval(t); };
  }, [dados, pedidoId]);

  // lo que escribió el otro lado, al tenerlo a la vista, queda visto
  const sinVer = (mensajes ?? []).filter((m) => m.lado !== miLado && !m.vistoEn).length;
  useEffect(() => { if (sinVer > 0) marcarVistos(pedidoId); }, [sinVer, pedidoId]);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'nearest' }); }, [mensajes?.length]);

  async function mandar() {
    const t = texto.trim();
    if (!t || mandando) return;
    setMandando(true); setError(null); setMandado(null);
    try {
      const r = await mandarMensaje(pedidoId, t);
      setTexto('');
      setPropios(r.mensajes);
      onCambio?.(r.mensajes);
      setMandado(r.avisado ? `Mandado. A ${primerNombre(r.avisado)} le aparece en su pantalla y le llega por WhatsApp.` : 'Mandado. Queda en el pedido y le aparece a la caja.');
    } catch (e: any) { setError(e.message); }
    finally { setMandando(false); }
  }

  return (
    <div className="space-y-3">
      {mensajes === null ? <p className="text-sm text-tinta/60">Buscando los mensajes…</p>
        : mensajes.length === 0 ? (vacio ? <p className="text-sm text-tinta/70">{vacio}</p> : null)
          : (
            <ol className="max-h-64 space-y-2 overflow-y-auto pr-1" aria-label="Mensajes del pedido">
              {mensajes.map((m) => {
                const mio = m.lado === miLado;
                return (
                  <li key={m.id} className={unir('flex', mio ? 'justify-end' : 'justify-start')}>
                    <div className={unir('max-w-[85%] rounded-2xl px-3 py-2 text-sm', mio ? 'bg-tinta text-white' : 'bg-crema-hondo text-tinta')}>
                      <p className={unir('text-xs font-semibold', mio ? 'text-white/70' : 'text-tinta/60')}>
                        {primerNombre(m.deNombre) || (m.lado === 'armado' ? 'Quien arma' : 'La caja')} · {hora(m.creadoEn)}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words">{m.texto}</p>
                    </div>
                  </li>
                );
              })}
              <div ref={fin} />
            </ol>
          )}
      <div className="flex items-end gap-2">
        <AreaTexto rows={2} autoFocus={autoFoco} value={texto} maxLength={600} onChange={(e) => { setTexto(e.target.value); setMandado(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); } }}
          aria-label={etiquetaCampo} className="min-h-16 flex-1" />
        <BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Dictar el mensaje" />
      </div>
      <Boton anchoCompleto onClick={mandar} cargando={mandando} disabled={!texto.trim()}>
        {otro ? `Mandárselo a ${primerNombre(otro)}` : 'Mandar'}
      </Boton>
      {mandado && <p role="status" className="text-sm font-medium text-ok">{mandado}</p>}
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
