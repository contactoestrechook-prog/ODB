"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { porKilo, pesos } from "../../lib/tipos";
import { IcoCarrito, IcoMas, IcoMenos } from "../ui/Iconos";
import { ROTULO, Titulo } from "../ui/Titulo";

export default function CarritoPage() {
  const { items, setCantidad, quitar, total, listo } = useCarrito();

  if (listo && items.length === 0) {
    return (
      <div className="min-h-[68vh] grid place-items-center px-5 text-center">
        <div className="min-w-0">
          <span className="inline-grid place-items-center w-16 h-16 rounded-full border border-linea text-humo mb-5"><IcoCarrito size={26} /></span>
          <Titulo como="h1" a="Tu carrito está vacío" className="text-[28px] sm:text-[34px]" />
          <p className="text-humo mt-1.5">Agregá productos del catálogo y aparecen acá.</p>
          <Link href="/catalogo" className="inline-block mt-7 rounded-full bg-ink text-crema font-semibold px-7 py-3.5 hover:bg-vino transition-colors">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-5 lg:px-8 py-10">
      <p className={`${ROTULO} text-rojo`}>Tu pedido</p>
      <Titulo como="h1" a="Carrito" className="text-[36px] sm:text-[44px] mt-2 mb-7" />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-10">
        {/* Cada renglón: la foto a la izquierda y, al lado, el nombre a todo el
            ancho con el precio; el contador y "Quitar" van en su propia línea.
            Antes iba todo en una fila y al nombre le quedaban ~80 px en celular. */}
        <div className="min-w-0 divide-y divide-linea border-y border-linea">
          {items.map((r) => (
            <div key={r.sku} className="flex items-start gap-3 sm:gap-4 py-4 min-w-0">
              <div className="relative w-16 h-20 rounded-lg bg-white ring-1 ring-linea overflow-hidden shrink-0">
                {/* object-contain como FotoProducto: son botellas y paquetes
                    verticales; con object-cover se les cortaba el cuello y la base */}
                {r.imagenUrl
                  ? <img src={r.imagenUrl} alt="" width={64} height={80} className="absolute inset-0 w-full h-full object-contain p-1" />
                  : <span aria-hidden className="absolute inset-0 grid place-items-center marca text-2xl font-extrabold text-ink/15">{r.nombre[0]}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink line-clamp-2 [overflow-wrap:anywhere]">{r.nombre}</p>
                <p className="marca text-base font-extrabold text-ink mt-1 whitespace-nowrap">
                  {pesos(r.precio)}{porKilo(r) && <span className="text-[12px] font-bold text-humo"> / kg</span>}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex items-center border border-tinta/20 rounded-full">
                    <button onClick={() => setCantidad(r.sku, r.cantidad - 1)} className="w-9 h-9 grid place-items-center text-tinta hover:text-rojo" aria-label={`Uno menos de ${r.nombre}`}><IcoMenos size={14} /></button>
                    <span className="min-w-6 px-1 text-center text-sm font-semibold tabular-nums">{r.cantidad}</span>
                    <button onClick={() => setCantidad(r.sku, r.cantidad + 1)} className="w-9 h-9 grid place-items-center text-tinta hover:text-rojo" aria-label={`Uno más de ${r.nombre}`}><IcoMas size={14} /></button>
                  </div>
                  <button onClick={() => quitar(r.sku)} className="text-humo hover:text-rojo py-2 transition-colors text-xs font-semibold" aria-label={`Quitar ${r.nombre}`}>Quitar</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="lg:sticky lg:top-28 h-fit min-w-0 border border-linea rounded-xl p-6 bg-crema">
          <p className={`${ROTULO} text-rojo mb-4`}>Resumen</p>
          <div className="flex justify-between gap-3 text-sm text-tinta/75 mb-2"><span>Subtotal</span><span className="whitespace-nowrap">{pesos(total)}</span></div>
          {/* el envío es sin cargo (regla fija de ODB, 18/9/2026): nunca "se calcula aparte" */}
          <div className="flex justify-between gap-3 text-sm text-humo mb-4"><span>Envío</span><span>sin cargo</span></div>
          <div className="flex flex-wrap justify-between items-baseline gap-x-3 border-t border-linea pt-4"><span className="font-semibold text-ink">Total</span><span className="marca text-2xl font-extrabold text-ink whitespace-nowrap">{pesos(total)}</span></div>
          <Link href="/checkout" className="block text-center mt-6 rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors">Finalizar compra</Link>
          <Link href="/catalogo" className="block text-center mt-3 text-sm text-humo subraya">Seguir comprando</Link>
        </div>
      </div>
    </div>
  );
}
