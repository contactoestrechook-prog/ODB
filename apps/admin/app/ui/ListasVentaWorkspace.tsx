'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Las 4 listas de venta. Minorista es la base (precio inicial de cada producto).
// Las demás se calculan como un % sobre Minorista (editable), y "regenerar"
// recalcula sus precios. El nombre de cada lista también es editable.

type Lista = {
  id: string; nombre: string; ajustePct: number; esBase: boolean; activa: boolean; productosConPrecio: number;
};

const btn = 'rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F] disabled:opacity-50';
const btnGhost = 'rounded-full border border-black/15 text-sm px-4 py-2 hover:bg-black/5 disabled:opacity-50';
const input = 'rounded-lg border border-black/15 px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function ListasVentaWorkspace({ inicial }: { inicial: Lista[] }) {
  const router = useRouter();
  const [listas, setListas] = useState<Lista[]>(inicial);
  const [edit, setEdit] = useState<Record<string, { nombre: string; ajustePct: number }>>({});
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const campo = (id: string, base: Lista, k: 'nombre' | 'ajustePct', v: any) =>
    setEdit((e) => ({ ...e, [id]: { nombre: e[id]?.nombre ?? base.nombre, ajustePct: e[id]?.ajustePct ?? base.ajustePct, [k]: v } }));
  const valor = (l: Lista, k: 'nombre' | 'ajustePct') => (edit[l.id]?.[k] ?? l[k]) as any;

  async function recargar() {
    const r = await fetch('/api/listas-venta', { cache: 'no-store' });
    if (r.ok) setListas(await r.json());
    setEdit({});
    router.refresh();
  }

  async function guardar(l: Lista) {
    setOcupado(l.id);
    try {
      const r = await fetch('/api/listas-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: l.id, nombre: valor(l, 'nombre'), ajustePct: Number(valor(l, 'ajustePct')) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo guardar');
      setEstado({ tipo: 'ok', texto: 'Lista actualizada' });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
    setOcupado(null);
  }

  async function regenerar(l: Lista) {
    if (!window.confirm(`Regenerar los precios de "${l.nombre}" desde Minorista ${l.ajustePct >= 0 ? '+' : ''}${l.ajustePct}%? Reemplaza los precios actuales de esta lista.`)) return;
    setOcupado(l.id);
    try {
      const r = await fetch('/api/listas-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: l.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo regenerar');
      setEstado({ tipo: 'ok', texto: `${d.generados} precios generados en "${l.nombre}"` });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
    setOcupado(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-black">Listas de precios de venta</h1>
        <p className="text-sm text-black/50 mt-0.5">Minorista es el precio base de cada producto. Las otras listas se calculan como un % sobre Minorista — editá el nombre y el %, y regenerá sus precios.</p>
      </div>

      {estado && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${estado.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-[#B82D25]'}`}>{estado.texto}</div>
      )}

      <div className="space-y-3">
        {listas.map((l) => (
          <div key={l.id} className="rounded-xl bg-white p-4 border border-black/[0.05]">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={valor(l, 'nombre')}
                onChange={(e) => campo(l.id, l, 'nombre', e.target.value)}
                className={input + ' flex-1 min-w-[10rem] font-medium'}
              />
              {l.esBase ? (
                <span className="text-xs rounded-full bg-black text-white px-3 py-1.5 whitespace-nowrap">★ Precio base</span>
              ) : (
                <label className="flex items-center gap-1.5 text-sm text-black/60 whitespace-nowrap">
                  Minorista
                  <input
                    type="number"
                    value={valor(l, 'ajustePct')}
                    onChange={(e) => campo(l.id, l, 'ajustePct', e.target.value)}
                    className={input + ' w-20 text-right'}
                  />
                  %
                </label>
              )}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/5">
              <span className="text-xs text-black/45">{l.productosConPrecio.toLocaleString('es-AR')} productos con precio</span>
              <div className="flex items-center gap-2">
                <button onClick={() => guardar(l)} disabled={ocupado === l.id} className={btnGhost}>Guardar</button>
                {!l.esBase && (
                  <button onClick={() => regenerar(l)} disabled={ocupado === l.id} className={btn}>
                    {ocupado === l.id ? 'Generando…' : 'Regenerar precios'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-black/40">
        Al regenerar, cada producto toma su precio Minorista actual y se le aplica el %. Si después cambiás precios Minorista, volvé a regenerar para actualizarlas.
      </p>
    </div>
  );
}
