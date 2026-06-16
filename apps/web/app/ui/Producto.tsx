"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos, descuentoPct, type Producto as P } from "../../lib/tipos";

export function Producto({ p }: { p: P }) {
  const { agregar } = useCarrito();
  const pct = descuentoPct(p);
  const sinStock = p.stockTotal != null && p.stockTotal <= 0;

  return (
    <div className="group bg-white rounded-2xl overflow-hidden border border-black/5 hover:shadow-lg transition-shadow flex flex-col">
      <Link href={`/producto/${p.sku}`} className="block relative aspect-square bg-[#ebe3d6]">
        {p.imagenUrl ? (
          <img src={p.imagenUrl} alt={p.nombre} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-5xl font-bold text-black/15">{(p.nombre ?? "?")[0]}</div>
        )}
        {sinStock ? (
          <span className="absolute top-2 left-2 bg-black/70 text-white text-[11px] rounded-lg px-2 py-0.5">Sin stock</span>
        ) : pct != null ? (
          <span className="absolute top-2 left-2 bg-[#B82D25] text-white text-xs font-bold rounded-lg px-2 py-0.5">-{pct}%</span>
        ) : null}
        {p.descuentoComunidad && (
          <span className="absolute top-2 right-2 bg-[#1A1412] text-[#C9A96E] text-[10px] font-semibold tracking-wide rounded-lg px-2 py-1">COMUNIDAD</span>
        )}
      </Link>
      <div className="p-3 flex flex-col flex-1">
        <Link href={`/producto/${p.sku}`} className="text-sm text-[#2A201C] font-medium line-clamp-2 min-h-[2.5rem] leading-snug hover:text-[#B82D25]">
          {p.nombre}
        </Link>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            {pct != null ? (
              <>
                <p className="text-lg font-bold text-[#B82D25] leading-none">{pesos(p.precio)}</p>
                <p className="text-xs text-[#9B9088] line-through">{pesos(p.precioLista)}</p>
              </>
            ) : (
              <p className="text-lg font-bold text-[#2A201C] leading-none">{pesos(p.precio)}</p>
            )}
          </div>
          {!sinStock && p.precio != null && (
            <button
              onClick={() => agregar(p)}
              aria-label="Agregar al carrito"
              className="shrink-0 w-9 h-9 rounded-full bg-[#B82D25] text-white grid place-items-center hover:bg-[#932A1F] active:scale-95 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
