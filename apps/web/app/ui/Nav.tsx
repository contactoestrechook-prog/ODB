"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import type { Cliente } from "../../lib/sesion";
import { IcoBuscar, IcoUsuario, IcoCarrito } from "./Iconos";

// Cabecera "placa roja": blanca y limpia, el buscador es el protagonista
// (11.000 productos: la mayoría entra buscando algo) y las acciones son las
// píldoras del kit de marca.
export function Nav({ cliente }: { cliente: Cliente | null }) {
  const { unidades } = useCarrito();
  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-linea">
      <div className="bg-rojo text-white text-center text-[11px] font-semibold tracking-[0.14em] uppercase py-1.5 px-4">
        Envío a domicilio · Retiro en el local<span className="hidden sm:inline"> · Precios de socio</span>
      </div>

      <div className="max-w-7xl mx-auto px-5 lg:px-8">
        <div className="flex items-center gap-4 lg:gap-6 h-[72px]">
          <Link href="/" className="shrink-0" aria-label="Inicio">
            <img src="/odb-logo.png" alt="O.D.B Premium Market" className="h-10 w-auto" />
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-[14px] font-semibold text-ink">
            <Link href="/catalogo" className="rounded-full px-3.5 py-2 hover:bg-crema transition-colors">Catálogo</Link>
            <Link href="/catalogo?filtro=promo" className="rounded-full px-3.5 py-2 hover:bg-crema transition-colors">Ofertas</Link>
            <Link href="/#como-comprar" className="rounded-full px-3.5 py-2 hover:bg-crema transition-colors">Cómo comprar</Link>
          </nav>

          <form action="/catalogo" className="hidden md:flex flex-1 min-w-0 max-w-xl items-center gap-2.5 rounded-full border-2 border-ink px-4 h-11 focus-within:border-rojo transition-colors">
            <IcoBuscar size={18} className="text-humo shrink-0" />
            <input name="q" placeholder="¿Qué estás buscando? Jamón crudo, malbec, chocolate…" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-humo" />
          </form>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Link href="/#app" className="hidden md:inline-flex items-center gap-2 rounded-full border-2 border-ink px-4 h-11 text-[13px] font-bold text-ink hover:bg-ink hover:text-white transition-colors" aria-label="Descargá la app ODB">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
              App
            </Link>
            <Link href={cliente ? "/cuenta" : "/ingresar"} className="hidden sm:inline-flex items-center gap-2 rounded-full border-2 border-ink px-4 h-11 text-[13px] font-bold text-ink hover:bg-ink hover:text-white transition-colors">
              <IcoUsuario size={17} /> {cliente ? "Mi cuenta" : "Comunidad ODB"}
            </Link>
            <Link href={cliente ? "/cuenta" : "/ingresar"} className="sm:hidden grid place-items-center w-11 h-11 rounded-full border-2 border-ink text-ink" aria-label="Mi cuenta">
              <IcoUsuario size={18} />
            </Link>
            <Link href="/carrito" className="inline-flex items-center gap-2 rounded-full bg-rojo px-4 h-11 text-[13px] font-bold text-white hover:bg-rojo-osc transition-colors" aria-label="Carrito">
              <IcoCarrito size={18} />
              <span className="hidden sm:inline">Carrito</span>
              {unidades > 0 && <span className="bg-white text-rojo rounded-full min-w-[20px] h-5 px-1.5 grid place-items-center text-[11px] font-extrabold">{unidades}</span>}
            </Link>
          </div>
        </div>

        <form action="/catalogo" className="md:hidden flex items-center gap-2.5 rounded-full border-2 border-ink px-4 h-11 mb-3">
          <IcoBuscar size={18} className="text-humo shrink-0" />
          <input name="q" placeholder="Buscar vinos, fiambres, almacén…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-humo" />
        </form>
      </div>
    </header>
  );
}
