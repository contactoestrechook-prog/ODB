"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos } from "../../lib/tipos";

export default function CarritoPage() {
  const { items, setCantidad, quitar, total, listo } = useCarrito();

  if (listo && items.length === 0) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-4 text-center">
        <div>
          <div className="text-6xl mb-4">🛒</div>
          <h1 className="text-xl font-bold text-[#2A201C]">Tu carrito está vacío</h1>
          <p className="text-[#9B9088] mt-1">Agregá productos del catálogo y aparecen acá.</p>
          <Link href="/catalogo" className="inline-block mt-6 rounded-full bg-[#B82D25] text-white font-semibold px-6 py-3 hover:bg-[#932A1F]">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-[#2A201C] mb-5">Tu carrito</h1>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.sku} className="flex items-center gap-4 bg-white rounded-2xl border border-black/5 p-3">
              <div className="w-16 h-16 rounded-xl bg-[#ebe3d6] overflow-hidden shrink-0 grid place-items-center">
                {r.imagenUrl ? <img src={r.imagenUrl} alt={r.nombre} className="w-full h-full object-cover" /> : <span className="text-2xl font-bold text-black/15">{r.nombre[0]}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#2A201C] line-clamp-2">{r.nombre}</p>
                <p className="text-sm text-[#B82D25] font-bold mt-0.5">{pesos(r.precio)}</p>
              </div>
              <div className="flex items-center rounded-full border border-black/15">
                <button onClick={() => setCantidad(r.sku, r.cantidad - 1)} className="w-8 h-9 grid place-items-center text-lg hover:text-[#B82D25]" aria-label="Menos">–</button>
                <span className="w-7 text-center text-sm font-semibold">{r.cantidad}</span>
                <button onClick={() => setCantidad(r.sku, r.cantidad + 1)} className="w-8 h-9 grid place-items-center text-lg hover:text-[#B82D25]" aria-label="Más">+</button>
              </div>
              <button onClick={() => quitar(r.sku)} className="text-[#9B9088] hover:text-[#B82D25] p-2" aria-label="Quitar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="lg:sticky lg:top-20 h-fit bg-white rounded-2xl border border-black/5 p-5">
          <h2 className="font-semibold text-[#2A201C] mb-3">Resumen</h2>
          <div className="flex justify-between text-sm text-[#5f554d] mb-1"><span>Subtotal</span><span>{pesos(total)}</span></div>
          <div className="flex justify-between text-sm text-[#9B9088] mb-3"><span>Envío</span><span>se calcula en el checkout</span></div>
          <div className="flex justify-between font-bold text-lg text-[#2A201C] border-t border-black/5 pt-3"><span>Total</span><span>{pesos(total)}</span></div>
          <Link href="/checkout" className="block text-center mt-5 rounded-full bg-[#B82D25] text-white font-semibold py-3 hover:bg-[#932A1F]">Finalizar compra</Link>
          <Link href="/catalogo" className="block text-center mt-2 text-sm text-[#5f554d] hover:text-[#B82D25]">Seguir comprando</Link>
        </div>
      </div>
    </div>
  );
}
