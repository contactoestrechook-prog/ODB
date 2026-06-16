"use client";

import { useState } from "react";
import { useCarrito } from "../../lib/carrito";
import type { Producto } from "../../lib/tipos";
import { IcoMas, IcoMenos } from "./Iconos";

export function AgregarProducto({ p }: { p: Producto }) {
  const { agregar } = useCarrito();
  const [n, setN] = useState(1);
  const [ok, setOk] = useState(false);

  const sinStock = p.stockTotal != null && p.stockTotal <= 0;
  if (sinStock) return <p className="border border-linea rounded-lg px-4 py-3.5 text-sm text-humo bg-crema">Sin stock por ahora.</p>;
  if (p.precio == null) return <p className="border border-linea rounded-lg px-4 py-3.5 text-sm text-humo bg-crema">Precio a confirmar — escribinos y te lo pasamos.</p>;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center border border-tinta/20 rounded-full">
        <button onClick={() => setN((v) => Math.max(1, v - 1))} className="w-11 h-12 grid place-items-center text-tinta hover:text-rojo transition-colors" aria-label="Menos"><IcoMenos size={16} /></button>
        <span className="w-7 text-center font-semibold">{n}</span>
        <button onClick={() => setN((v) => v + 1)} className="w-11 h-12 grid place-items-center text-tinta hover:text-rojo transition-colors" aria-label="Más"><IcoMas size={16} /></button>
      </div>
      <button
        onClick={() => { agregar(p, n); setOk(true); setTimeout(() => setOk(false), 1500); }}
        className="flex-1 min-w-[200px] rounded-full bg-ink text-crema text-sm font-semibold px-7 py-3.5 hover:bg-vino transition-colors"
      >
        {ok ? "Agregado al carrito ✓" : "Agregar al carrito"}
      </button>
    </div>
  );
}
