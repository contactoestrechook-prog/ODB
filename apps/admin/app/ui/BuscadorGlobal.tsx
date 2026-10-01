'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { titulo: string; sub: string; href: string };
type Resultados = { productos: Item[]; clientes: Item[]; comprobantes: Item[] };

const GRUPOS: [keyof Resultados, string][] = [
  ['productos', 'Productos'], ['clientes', 'Clientes'], ['comprobantes', 'Comprobantes'],
];

export function BuscadorGlobal() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Resultados | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const cont = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    setCargando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`);
        if (r.ok) { setRes(await r.json()); setAbierto(true); }
      } finally { setCargando(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (cont.current && !cont.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const ir = (href: string) => { setAbierto(false); setQ(''); setRes(null); router.push(href); };
  const todos = res ? [...res.productos, ...res.clientes, ...res.comprobantes] : [];

  return (
    // a lo ancho en el celular; el ancho en escritorio lo pone la cabecera
    <div ref={cont} className="relative w-full">
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-tinta/60" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />
      </svg>
      <input
        type="search"
        enterKeyHint="search"
        aria-label="Buscar producto, cliente o comprobante"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res && setAbierto(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setAbierto(false); }}
        placeholder="Buscar producto, cliente o comprobante…"
        className="min-h-11 w-full appearance-none rounded-full border border-black/15 bg-crema-claro py-2 pl-10 pr-4 text-base text-tinta outline-none transition-[border-color,box-shadow,background-color] placeholder:text-tinta/40 focus:border-marca/60 focus:bg-white focus:ring-4 focus:ring-marca/15 sm:min-h-10 sm:text-sm"
      />
      {abierto && q.trim().length >= 2 && (
        <div className="absolute z-barra mt-1.5 max-h-[70dvh] w-full overflow-hidden overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-flotante">
          {cargando && todos.length === 0 && <p className="px-4 py-3 text-sm text-tinta/60">Buscando…</p>}
          {!cargando && todos.length === 0 && <p className="px-4 py-3 text-sm text-tinta/60">Sin resultados para “{q}”.</p>}
          {GRUPOS.map(([clave, label]) => {
            const items = res?.[clave] ?? [];
            if (!items.length) return null;
            return (
              <div key={clave}>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">{label}</p>
                {items.map((it, i) => (
                  <button key={i} type="button" onClick={() => ir(it.href)} className="block min-h-11 w-full border-b border-black/[0.06] px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none">
                    <p className="min-w-0 break-words text-sm text-tinta">{it.titulo}</p>
                    <p className="min-w-0 break-words text-xs text-tinta/60">{it.sub}</p>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
