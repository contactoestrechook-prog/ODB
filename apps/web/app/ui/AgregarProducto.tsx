"use client";

import { useState } from "react";
import { useCarrito } from "../../lib/carrito";
import type { Producto } from "../../lib/tipos";

export function AgregarProducto({ p }: { p: Producto }) {
  const { agregar } = useCarrito();
  const [n, setN] = useState(1);
  const [ok, setOk] = useState(false);

  const sinStock = p.stockTotal != null && p.stockTotal <= 0;
  if (sinStock) return <p className="rounded-xl bg-[#ebe3d6] px-4 py-3 text-sm text-[#5f554d]">Sin stock por ahora.</p>;
  if (p.precio == null) return <p className="rounded-xl bg-[#ebe3d6] px-4 py-3 text-sm text-[#5f554d]">Precio a confirmar — consultanos.</p>;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center rounded-full border border-black/15 bg-white">
        <button onClick={() => setN((v) => Math.max(1, v - 1))} className="w-10 h-11 grid place-items-center text-xl text-[#2A201C] hover:text-[#B82D25]" aria-label="Menos">–</button>
        <span className="w-8 text-center font-semibold">{n}</span>
        <button onClick={() => setN((v) => v + 1)} className="w-10 h-11 grid place-items-center text-xl text-[#2A201C] hover:text-[#B82D25]" aria-label="Más">+</button>
      </div>
      <button
        onClick={() => { agregar(p, n); setOk(true); setTimeout(() => setOk(false), 1500); }}
        className="flex-1 min-w-[180px] rounded-full bg-[#B82D25] text-white font-semibold px-6 py-3 hover:bg-[#932A1F] active:scale-[0.99] transition"
      >
        {ok ? "Agregado ✓" : "Agregar al carrito"}
      </button>
    </div>
  );
}
