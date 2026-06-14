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
    <div ref={cont} className="relative w-full max-w-md">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res && setAbierto(true)}
        placeholder="Buscar producto, cliente o comprobante…"
        className="w-full rounded-full border border-black/15 bg-[#F0EBE2]/50 px-4 py-2 text-sm text-black outline-none focus:border-[#B82D25] focus:bg-white"
      />
      {abierto && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl bg-white shadow-xl border border-black/10 overflow-hidden max-h-[70vh] overflow-y-auto">
          {cargando && todos.length === 0 && <p className="px-4 py-3 text-sm text-black/40">Buscando…</p>}
          {!cargando && todos.length === 0 && <p className="px-4 py-3 text-sm text-black/40">Sin resultados para “{q}”.</p>}
          {GRUPOS.map(([clave, label]) => {
            const items = res?.[clave] ?? [];
            if (!items.length) return null;
            return (
              <div key={clave}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-black/35 uppercase">{label}</p>
                {items.map((it, i) => (
                  <button key={i} onClick={() => ir(it.href)} className="w-full text-left px-4 py-2 hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">
                    <p className="text-sm text-black truncate">{it.titulo}</p>
                    <p className="text-xs text-black/45 truncate">{it.sub}</p>
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
