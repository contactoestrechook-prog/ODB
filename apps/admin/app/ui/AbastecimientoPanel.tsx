'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';

// "Qué comprar": la foto de lo que falta y el agente de abastecimiento.
// La alerta no es un número fijo: cruza ritmo de venta, stock y plazo de
// entrega del proveedor (ver apps/api/src/abastecimiento).
type Mensaje = { rol: 'usuario' | 'asistente'; texto: string; ordenes?: number[] };
type Resumen = {
  porSucursal: Record<string, { sin_stock?: number; no_llega?: number; menos_de_12?: number }>;
  proveedoresUrgentes: { proveedor: string; urgentes: number; faltan: string[] }[];
  sinProveedor: number;
  ventasHasta: string | null;
  stockActualizado: string | null;
};

const fecha = (v?: string | null) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const miles = (n?: number) => (n ?? 0).toLocaleString('es-AR');

const SUGERENCIAS = [
  '¿Qué no llega a tiempo en Saint Thomas?',
  '¿Qué está sin stock y se vende todos los días?',
  '¿A qué proveedores les falta cargar datos para poder comprarles?',
];

export function AbastecimientoPanel() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/abastecimiento?que=resumen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setResumen(j))
      .catch(() => null);
  }, []);
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes, pensando]);

  const ventasViejas = resumen?.ventasHasta ? Date.now() - new Date(resumen.ventasHasta).getTime() > 30 * 86400_000 : true;

  async function enviar(textoDirecto?: string) {
    const cuerpo = (textoDirecto ?? texto).trim();
    if (!cuerpo || pensando) return;
    const conversacion: Mensaje[] = [...mensajes, { rol: 'usuario', texto: cuerpo }];
    setMensajes(conversacion);
    setTexto('');
    setError('');
    setPensando(true);
    try {
      const r = await fetch('/api/abastecimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: conversacion.map(({ rol, texto }) => ({ rol, texto })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'El agente no pudo contestar');
      setMensajes([...conversacion, { rol: 'asistente', texto: j.respuesta, ordenes: j.ordenes?.length ? j.ordenes : undefined }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El agente no pudo contestar');
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {resumen
            ? Object.entries(resumen.porSucursal).map(([suc, a]) => (
                <div key={suc} className="rounded-lg border border-black/10 px-3 py-2">
                  <p className="text-sm font-medium text-black">{suc}</p>
                  <p className="mt-1 text-xs text-black/65">
                    <span className="font-semibold text-[#B82D25]">{miles(a.sin_stock)}</span> sin stock ·{' '}
                    <span className="font-semibold text-[#B82D25]">{miles(a.no_llega)}</span> no llegan a tiempo ·{' '}
                    <span className="font-semibold">{miles(a.menos_de_12)}</span> con menos de 12
                  </p>
                </div>
              ))
            : <p className="text-sm text-black/45">Calculando…</p>}
        </div>
        {resumen && (
          <p className="text-xs text-black/55">
            Stock al {fecha(resumen.stockActualizado)} · ritmo de venta con datos hasta {fecha(resumen.ventasHasta)}
            {ventasViejas && <span className="text-[#932A1F]"> — dato viejo: las cantidades son orientativas hasta cargar el reporte de ventas reciente del sistema viejo</span>}
            {resumen.sinProveedor > 0 && <> · {miles(resumen.sinProveedor)} productos en alerta sin proveedor habitual</>}
          </p>
        )}
        {!!resumen?.proveedoresUrgentes.length && (
          <div className="flex flex-wrap gap-1.5">
            {resumen.proveedoresUrgentes.map((p) => (
              <button key={p.proveedor} onClick={() => enviar(`Armame la propuesta de compra para ${p.proveedor}`)}
                title={p.faltan.length ? `Le falta: ${p.faltan.join(', ')}` : 'Proveedor completo'}
                className="rounded-full border border-black/15 px-2.5 py-1 text-xs hover:bg-[#F0EBE2]">
                {p.proveedor} · {p.urgentes}{p.faltan.length ? ' ⚠️' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-[#B82D25]/10 border border-[#B82D25]/30 px-3 py-2 text-sm text-[#932A1F]">{error}</p>}

      <div className="rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10">
          <p className="text-sm font-medium text-black">Agente de compras</p>
          <p className="text-xs text-black/50 mt-0.5">
            Cruza ritmo de venta, stock y plazo de entrega. Propone; la orden la arma cuando le decís que sí, y la aprueba el dueño.
          </p>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-4 space-y-3">
          {mensajes.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button key={s} onClick={() => enviar(s)} className="rounded-lg bg-[#F0EBE2] px-3 py-2 text-left text-sm text-black/75 hover:bg-[#E6DFD3]">{s}</button>
              ))}
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} className={`flex ${m.rol === 'usuario' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${m.rol === 'usuario' ? 'bg-black text-[#F0EBE2]' : 'bg-[#F0EBE2] text-black'}`}>
                {m.texto}
                {m.ordenes && (
                  <a href="/aprobaciones" className="mt-2 block text-xs font-semibold text-[#B82D25] underline">
                    {m.ordenes.length === 1 ? `Orden #${m.ordenes[0]}` : `Órdenes #${m.ordenes.join(', #')}`} creada{m.ordenes.length > 1 ? 's' : ''}: ver en Aprobaciones
                  </a>
                )}
              </div>
            </div>
          ))}
          {pensando && <p className="text-sm text-black/40">Revisando stock, ventas y proveedores…</p>}
          <div ref={finRef} />
        </div>
        <div className="border-t border-black/10 p-3">
          <div className="flex items-end gap-2">
            <BotonMicrofono onTexto={setTexto} titulo="Dictarle al agente" />
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              rows={2}
              placeholder="Preguntale qué falta, qué pedir o a quién…"
              className="flex-1 resize-none rounded-lg border border-black/15 px-3 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
            />
            <button onClick={() => enviar()} disabled={pensando || !texto.trim()}
              className="rounded-lg bg-[#B82D25] px-4 py-2.5 text-sm font-medium text-white active:scale-95 disabled:opacity-40">
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
