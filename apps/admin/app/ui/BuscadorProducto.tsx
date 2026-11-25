'use client';

// El buscador de productos con precio de lista y stock de la sucursal: lo más parecido
// primero. Nació en Presupuestos (25/11/2026) y lo usa también «Sumar un producto» en el
// detalle del pedido (25/11/2026: el cliente agregó algo con el pedido ya cargado).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Campo, Entrada, unir, FOCO } from './kit';
import { pesos } from '../lib/formato';

export type Encontrado = { productoId: string; sku: string | null; nombre: string; precio: number | null; stock: number | null };

const cant = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 3 }));

export function BuscadorProducto({ sucursalId, onElegir, etiqueta = 'Agregar producto', sinStockNo = false }: {
  sucursalId: string;
  onElegir: (e: Encontrado) => void;
  etiqueta?: string;
  /** Si no hay stock, no se puede elegir (un pedido reserva lo que lleva). */
  sinStockNo?: boolean;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Encontrado[] | null>(null);
  const turno = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) return;
    const mio = ++turno.current;
    const t = setTimeout(() => {
      fetch(`/api/presupuestos?recurso=productos&q=${encodeURIComponent(texto)}&sucursalId=${encodeURIComponent(sucursalId)}`, { cache: 'no-store' })
        .then(async (r) => { const d = await r.json(); if (mio === turno.current) setRes(r.ok && Array.isArray(d) ? d : []); })
        .catch(() => mio === turno.current && setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sucursalId]);

  // con menos de dos letras no se muestra nada (sin tocar el estado desde el efecto)
  const mostrar = q.trim().length >= 2 ? res : null;
  const visibles = useMemo(() => (mostrar ?? []).slice(0, 12), [mostrar]);
  const sePuede = (e: Encontrado) => e.precio != null && !(sinStockNo && e.stock != null && e.stock <= 0);
  return (
    <div className="space-y-2">
      <Campo etiqueta={etiqueta}>
        <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código" autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'Enter' && visibles[0] && sePuede(visibles[0])) { e.preventDefault(); onElegir(visibles[0]); setQ(''); } }} />
      </Campo>
      {mostrar !== null && (
        visibles.length ? (
          <ul className="max-h-72 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.08] bg-white">
            {visibles.map((e) => (
              <li key={e.productoId}>
                <button type="button" disabled={!sePuede(e)} onClick={() => { onElegir(e); setQ(''); }}
                  className={unir('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-crema-claro disabled:cursor-not-allowed disabled:opacity-50', FOCO)}>
                  <span className="min-w-0 flex-1 break-words text-tinta">{e.nombre}{e.sku ? <span className="text-tinta/50"> · {e.sku}</span> : null}</span>
                  {e.stock != null && <span className={unir('shrink-0 text-xs', e.stock > 0 ? 'text-tinta/60' : 'font-semibold text-marca')}>{e.stock > 0 ? `hay ${cant(e.stock)}` : 'sin stock'}</span>}
                  <span className="importe w-24 shrink-0 text-right font-semibold text-tinta">{e.precio != null ? pesos(e.precio) : 'sin precio'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-tinta/60">No encontré «{q.trim()}».</p>
      )}
    </div>
  );
}
