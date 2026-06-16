"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos } from "../../lib/tipos";
import { IcoCarrito, IcoMas, IcoMenos } from "../ui/Iconos";

export default function CarritoPage() {
  const { items, setCantidad, quitar, total, listo } = useCarrito();

  if (listo && items.length === 0) {
    return (
      <div className="min-h-[68vh] grid place-items-center px-5 text-center">
        <div>
          <span className="inline-grid place-items-center w-16 h-16 rounded-full border border-linea text-humo mb-5"><IcoCarrito size={26} /></span>
          <h1 className="display text-2xl font-semibold text-ink">Tu carrito está vacío</h1>
          <p className="text-humo mt-1.5">Agregá productos del catálogo y aparecen acá.</p>
          <Link href="/catalogo" className="inline-block mt-7 rounded-full bg-ink text-crema font-semibold px-7 py-3.5 hover:bg-vino transition-colors">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-5 lg:px-8 py-10">
      <p className="kicker text-dorado">Tu pedido</p>
      <h1 className="display text-3xl sm:text-4xl font-semibold text-ink mt-1.5 mb-7 tracking-tight">Carrito</h1>

      <div className="grid lg:grid-cols-[1fr_340px] gap-10">
        <div className="divide-y divide-linea border-y border-linea">
          {items.map((r) => (
            <div key={r.sku} className="flex items-center gap-4 py-4">
              <div className="w-16 h-20 rounded-lg bg-crema overflow-hidden shrink-0 grid place-items-center">
                {r.imagenUrl ? <img src={r.imagenUrl} alt={r.nombre} className="w-full h-full object-cover" /> : <span className="display text-2xl text-ink/15">{r.nombre[0]}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink line-clamp-2">{r.nombre}</p>
                <p className="display text-base font-semibold text-ink mt-1">{pesos(r.precio)}</p>
              </div>
              <div className="flex items-center border border-tinta/20 rounded-full">
                <button onClick={() => setCantidad(r.sku, r.cantidad - 1)} className="w-8 h-9 grid place-items-center text-tinta hover:text-rojo" aria-label="Menos"><IcoMenos size={14} /></button>
                <span className="w-6 text-center text-sm font-semibold">{r.cantidad}</span>
                <button onClick={() => setCantidad(r.sku, r.cantidad + 1)} className="w-8 h-9 grid place-items-center text-tinta hover:text-rojo" aria-label="Más"><IcoMas size={14} /></button>
              </div>
              <button onClick={() => quitar(r.sku)} className="text-humo hover:text-rojo p-2 transition-colors text-xs" aria-label="Quitar">Quitar</button>
            </div>
          ))}
        </div>

        <div className="lg:sticky lg:top-28 h-fit border border-linea rounded-xl p-6 bg-crema">
          <p className="kicker text-dorado mb-4">Resumen</p>
          <div className="flex justify-between text-sm text-tinta/75 mb-2"><span>Subtotal</span><span>{pesos(total)}</span></div>
          <div className="flex justify-between text-sm text-humo mb-4"><span>Envío</span><span>se calcula al finalizar</span></div>
          <div className="flex justify-between items-baseline border-t border-linea pt-4"><span className="font-semibold text-ink">Total</span><span className="display text-2xl font-semibold text-ink">{pesos(total)}</span></div>
          <Link href="/checkout" className="block text-center mt-6 rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors">Finalizar compra</Link>
          <Link href="/catalogo" className="block text-center mt-3 text-sm text-humo subraya">Seguir comprando</Link>
        </div>
      </div>
    </div>
  );
}
