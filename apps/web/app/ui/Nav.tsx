"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import type { Cliente } from "../../lib/sesion";
import { IcoBuscar, IcoUsuario, IcoCarrito } from "./Iconos";

export function Nav({ cliente }: { cliente: Cliente | null }) {
  const { unidades } = useCarrito();
  return (
    <header className="sticky top-0 z-50">
      <div className="bg-ink text-crema/75 text-center text-[10.5px] tracking-[0.22em] uppercase py-2 px-4">
        Envío a domicilio · Retiro en el local · <span className="text-dorado-claro">Comunidad&nbsp;ODB</span>
      </div>

      <div className="bg-crema/95 backdrop-blur-md border-b border-linea">
        <div className="max-w-7xl mx-auto px-5 lg:px-8">
          <div className="flex items-center gap-6 h-[70px]">
            <Link href="/" className="shrink-0 leading-none">
              <div className="display text-[26px] font-semibold tracking-tight text-ink">O.D.B</div>
              <div className="kicker text-dorado mt-0.5">Premium Market</div>
            </Link>

            <nav className="hidden lg:flex items-center gap-8 ml-6 text-[13.5px] text-tinta/80">
              <Link href="/catalogo" className="subraya py-1">Catálogo</Link>
              <Link href="/catalogo?filtro=promo" className="subraya py-1">Ofertas</Link>
              <Link href={cliente ? "/cuenta" : "/ingresar"} className="subraya py-1">Comunidad ODB</Link>
            </nav>

            <form action="/catalogo" className="hidden md:flex flex-1 max-w-xs ml-auto items-center gap-2.5 border-b border-tinta/20 focus-within:border-dorado transition-colors pb-2">
              <IcoBuscar size={17} className="text-humo" />
              <input name="q" placeholder="Buscar" className="bg-transparent text-sm flex-1 outline-none placeholder:text-humo/70" />
            </form>

            <div className="flex items-center gap-0.5 ml-auto md:ml-2 text-tinta">
              <Link href={cliente ? "/cuenta" : "/ingresar"} className="p-2.5 hover:text-rojo transition-colors" aria-label="Mi cuenta"><IcoUsuario size={20} /></Link>
              <Link href="/carrito" className="relative p-2.5 hover:text-rojo transition-colors" aria-label="Carrito">
                <IcoCarrito size={20} />
                {unidades > 0 && <span className="absolute top-1 right-1 bg-rojo text-crema text-[10px] font-bold rounded-full min-w-[16px] h-4 grid place-items-center px-1">{unidades}</span>}
              </Link>
            </div>
          </div>

          <form action="/catalogo" className="md:hidden flex items-center gap-2.5 border-t border-linea py-3">
            <IcoBuscar size={18} className="text-humo" />
            <input name="q" placeholder="Buscar vinos, fiambres, almacén…" className="bg-transparent text-sm flex-1 outline-none placeholder:text-humo/70" />
          </form>
        </div>
      </div>
    </header>
  );
}
