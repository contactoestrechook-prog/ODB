"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import type { Cliente } from "../../lib/sesion";

export function Nav({ cliente }: { cliente: Cliente | null }) {
  const { unidades } = useCarrito();
  return (
    <header className="sticky top-0 z-40 bg-[#1A1412] text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 sm:gap-5">
        <Link href="/" className="shrink-0 leading-none">
          <span className="text-lg font-bold tracking-[0.3em]">O.D.B</span>
          <span className="hidden sm:inline text-[10px] tracking-[0.2em] text-[#C9A96E] ml-2">PREMIUM MARKET</span>
        </Link>

        <form action="/catalogo" className="flex-1 max-w-xl">
          <div className="flex items-center gap-2 bg-white/10 rounded-full px-4 py-2">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50 shrink-0"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input name="q" placeholder="Buscar vinos, fiambres, almacén…" className="bg-transparent flex-1 text-sm outline-none placeholder:text-white/40" />
          </div>
        </form>

        <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
          {cliente ? (
            <Link href="/cuenta" className="flex items-center gap-2 rounded-full px-3 py-2 text-sm hover:bg-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0114 0" /></svg>
              <span className="hidden sm:inline">{cliente.nombre?.split(" ")[0] ?? "Mi cuenta"}</span>
            </Link>
          ) : (
            <Link href="/ingresar" className="rounded-full px-3 py-2 text-sm hover:bg-white/10">Ingresar</Link>
          )}
          <Link href="/carrito" aria-label="Carrito" className="relative rounded-full p-2 hover:bg-white/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 7h13l-1.5 9H7.5L6 7zM6 7L5 4H3" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>
            {unidades > 0 && <span className="absolute -top-0.5 -right-0.5 bg-[#B82D25] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] grid place-items-center px-1">{unidades}</span>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
