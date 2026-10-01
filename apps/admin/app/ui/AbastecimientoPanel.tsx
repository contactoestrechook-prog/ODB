'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { NotaDePedido, type Armada, type EstadoNota, type Propuesta } from './NotaDePedido';

// "Qué comprar": la foto de lo que falta y el agente de abastecimiento.
// La alerta no es un número fijo: cruza ritmo de venta, stock y plazo de
// entrega del proveedor (ver apps/api/src/abastecimiento).
type Mensaje = { rol: 'usuario' | 'asistente'; texto: string; ordenes?: number[]; propuestas?: Propuesta[] };
type Resumen = {
  porSucursal: Record<string, { sin_stock?: number; no_llega?: number; menos_de_12?: number }>;
  proveedoresUrgentes: { proveedor: string; urgentes: number; faltan: string[] }[];
  sinProveedor: number;
  ventasHasta: string | null;
  stockActualizado: string | null;
};

const fecha = (v?: string | null) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const miles = (n?: number) => (n ?? 0).toLocaleString('es-AR');

// El agente no ve la pantalla. Al mensaje que se manda se le antepone cómo
// están ahora las notas que él propuso (lo tildado y lo corregido) y las órdenes
// que ya se armaron, para que no proponga ni arme dos veces.
type OrdenArmada = Armada & { proveedor: string; sucursal: string };
function contextoDeNotas(notas: EstadoNota[], ordenes: OrdenArmada[]): string {
  const lineas: string[] = [];
  for (const n of notas) {
    const t = n.items.filter((i) => i.tildado && i.cantidad > 0).map((i) => `${i.sku}×${i.cantidad}`);
    const sin = n.items.filter((i) => !(i.tildado && i.cantidad > 0)).map((i) => i.sku);
    if (!t.length && !sin.length) continue;
    lineas.push(`- Nota ${n.proveedor} · ${n.sucursal}: ${t.length ? `tildado ${t.join(', ')}` : 'nada tildado'}${sin.length ? `; sin tildar ${sin.join(', ')}` : ''}`);
  }
  for (const o of ordenes) {
    lineas.push(`- Orden #${o.numero ?? '?'} YA ARMADA (a aprobar) para ${o.proveedor} · ${o.sucursal}: ${(o.pedidos ?? []).map((p) => `${p.sku}×${p.cantidad}`).join(', ')}`);
  }
  return lineas.length ? `[Cómo está la pantalla ahora — es contexto, no lo repitas]\n${lineas.join('\n')}\n\n` : '';
}

const SUCURSALES = ['Saint Thomas', 'Santa Inés'];
const PROVEEDORES_VISIBLES = 6;

const SUGERENCIAS = [
  '¿Qué vinos se me terminan antes de que lleguen?',
  '¿Qué está sin stock y se vende todos los días?',
  '¿A qué proveedores les falta cargar datos para poder comprarles?',
];

export function AbastecimientoPanel() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const [sucursal, setSucursal] = useState(SUCURSALES[0]);
  const [notas, setNotas] = useState<{ propuestas: Propuesta[]; sinProveedor: number } | null>(null);
  const [errorNotas, setErrorNotas] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [errorResumen, setErrorResumen] = useState(false);
  // productos ya pedidos desde cualquier nota de esta pantalla ("sucursalId:sku")
  const [yaPedidos, setYaPedidos] = useState<Set<string>>(new Set());
  const ordenesRef = useRef<OrdenArmada[]>([]);
  const notasChat = useRef(new Map<string, EstadoNota>());
  const finRef = useRef<HTMLDivElement>(null);

  const alArmar = useCallback((o: OrdenArmada & { sucursalId: string }) => {
    ordenesRef.current = [...ordenesRef.current, o];
    setYaPedidos((s) => new Set([...s, ...(o.pedidos ?? []).map((p) => `${o.sucursalId}:${p.sku}`)]));
  }, []);

  useEffect(() => {
    fetch('/api/abastecimiento?que=resumen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? setResumen(j) : setErrorResumen(true)))
      .catch(() => setErrorResumen(true));
  }, []);
  const [recargar, setRecargar] = useState(0);
  useEffect(() => {
    // si se cambia de sucursal antes de que llegue la respuesta, la vieja se descarta
    let vigente = true;
    setNotas(null);
    setErrorNotas('');
    setVerTodas(false);
    fetch(`/api/abastecimiento?que=propuestas&sucursal=${encodeURIComponent(sucursal)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.message ?? 'No pude armar lo sugerido');
        if (vigente) setNotas({ propuestas: j.propuestas ?? [], sinProveedor: j.sinProveedor ?? 0 });
      })
      .catch((e) => { if (vigente) setErrorNotas(e instanceof Error ? e.message : 'No pude armar lo sugerido'); });
    return () => { vigente = false; };
  }, [sucursal, recargar]);
  // al mandar un mensaje se baja hasta el final; no al abrir la pestaña
  useEffect(() => { if (mensajes.length) finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [mensajes, pensando]);

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
        body: JSON.stringify({
          mensajes: conversacion.map((m, i) => ({
            rol: m.rol,
            texto: i === conversacion.length - 1 ? contextoDeNotas([...notasChat.current.values()], ordenesRef.current) + m.texto : m.texto,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'El agente no pudo contestar');
      setMensajes([...conversacion, { rol: 'asistente', texto: j.respuesta, ordenes: j.ordenes?.length ? j.ordenes : undefined, propuestas: j.propuestas?.length ? j.propuestas : undefined }]);
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
            : <p className="text-sm text-black/45">{errorResumen ? 'No pude calcular el resumen. Recargá la página para reintentar.' : 'Calculando…'}</p>}
        </div>
        {resumen && (
          <p className="text-xs text-black/55">
            Stock al {fecha(resumen.stockActualizado)} · ritmo de venta con datos hasta {fecha(resumen.ventasHasta)}
            {ventasViejas && <span className="text-[#932A1F]"> — dato viejo: las cantidades son orientativas hasta cargar el reporte de ventas reciente del sistema viejo</span>}
            {resumen.sinProveedor > 0 && <> · {miles(resumen.sinProveedor)} productos en alerta sin proveedor habitual</>}
          </p>
        )}
      </div>

      <section aria-labelledby="sugerido" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
          <div className="min-w-0">
            <h2 id="sugerido" className="text-lg font-semibold text-black">Sugerido para comprar</h2>
            <p className="text-[12.5px] text-black/55">Una nota de pedido por proveedor. Tildá lo que vas a pedir y ajustá las cantidades.</p>
          </div>
          <div role="group" aria-label="Sucursal" className="flex rounded-full bg-white p-1 ring-1 ring-black/10">
            {SUCURSALES.map((s) => (
              <button key={s} aria-pressed={sucursal === s} onClick={() => setSucursal(s)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${sucursal === s ? 'bg-[#141414] text-white' : 'text-black/55 hover:text-black'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {errorNotas && (
          <p className="rounded-lg bg-[#B82D25]/10 border border-[#B82D25]/30 px-3 py-2 text-sm text-[#932A1F]">
            {errorNotas}{' '}
            <button onClick={() => setRecargar((n) => n + 1)} className="font-medium underline underline-offset-2">Reintentar</button>
          </p>
        )}
        {!notas && !errorNotas && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.06]">
                <div className="h-[62px] bg-[#141414]" /><div className="h-[3px] bg-[#C9A96E]" />
                <div className="space-y-3 p-5">{[0, 1, 2].map((j) => <div key={j} className="h-9 rounded-lg bg-black/[0.04] motion-safe:animate-pulse" />)}</div>
              </div>
            ))}
          </div>
        )}
        {notas && notas.propuestas.length === 0 && (
          <p className="rounded-2xl bg-white px-5 py-6 text-sm text-black/55">No hay nada para reponer en {sucursal} con proveedor habitual. Si te falta algo puntual, preguntale al agente acá abajo.</p>
        )}
        {notas?.propuestas.slice(0, verTodas ? undefined : PROVEEDORES_VISIBLES).map((p) => (
          <NotaDePedido key={`${sucursal}:${p.clave}`} propuesta={p} yaPedidos={yaPedidos} onArmada={alArmar} />
        ))}
        {notas && notas.propuestas.length > PROVEEDORES_VISIBLES && !verTodas && (
          <button onClick={() => setVerTodas(true)}
            className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-black/60 ring-1 ring-black/[0.06] hover:text-black">
            Ver {notas.propuestas.length - PROVEEDORES_VISIBLES} proveedor{notas.propuestas.length - PROVEEDORES_VISIBLES === 1 ? '' : 'es'} más
          </button>
        )}
        {notas && notas.sinProveedor > 0 && (
          <p className="text-[12.5px] text-black/55">
            Hay {miles(notas.sinProveedor)} productos urgentes sin proveedor habitual: no entran en ninguna nota.{' '}
            <button onClick={() => enviar(`¿A quién le compro lo urgente que no tiene proveedor habitual en ${sucursal}?`)} className="font-medium text-[#B82D25] underline underline-offset-2">Preguntale al agente</button>.
          </p>
        )}
      </section>

      {error && <p className="rounded-lg bg-[#B82D25]/10 border border-[#B82D25]/30 px-3 py-2 text-sm text-[#932A1F]">{error}</p>}

      <div className="rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10">
          <p className="text-sm font-medium text-black">Agente de compras</p>
          <p className="text-xs text-black/50 mt-0.5">
            Para algo puntual: un rubro, un producto o qué hacer con lo que no tiene proveedor. Lo que propone te llega como nota de pedido para tildar.
          </p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-3">
          {mensajes.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button key={s} onClick={() => enviar(s)} className="rounded-lg bg-[#F0EBE2] px-3 py-2 text-left text-sm text-black/75 hover:bg-[#E6DFD3]">{s}</button>
              ))}
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.rol === 'usuario' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${m.rol === 'usuario' ? 'bg-black text-[#F0EBE2]' : 'bg-[#F0EBE2] text-black'}`}>
                {m.texto}
                {m.ordenes && (
                  <a href="/aprobaciones" className="mt-2 block text-xs font-semibold text-[#B82D25] underline">
                    {m.ordenes.length === 1 ? `Orden #${m.ordenes[0]}` : `Órdenes #${m.ordenes.join(', #')}`} creada{m.ordenes.length > 1 ? 's' : ''}: ver en Aprobaciones
                  </a>
                )}
              </div>
              {m.propuestas && (
                <div className="mt-2 w-full space-y-3">
                  {m.propuestas.map((p) => (
                    <NotaDePedido
                      key={`${i}:${p.clave}`}
                      propuesta={p}
                      yaPedidos={yaPedidos}
                      onArmada={alArmar}
                      onCambio={(e) => notasChat.current.set(`${i}:${p.clave}`, e)}
                    />
                  ))}
                </div>
              )}
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
