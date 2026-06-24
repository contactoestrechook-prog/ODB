'use client';

import { useState } from 'react';
import Link from 'next/link';

type Item = { href: string; label: string; icono: string };
type Grupo = { titulo: string; items: Item[] };

export function MobileMenu({ grupos, iconos, activo, titulo }: { grupos: Grupo[]; iconos: Record<string, string>; activo: string; titulo: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      {/* barra superior móvil */}
      <header className="lg:hidden bg-[#121212] px-4 py-3 sticky top-0 z-40 flex items-center justify-between">
        <button onClick={() => setAbierto(true)} aria-label="Menú" className="flex items-center gap-2 text-white">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-sm font-medium">{titulo}</span>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="h-7 w-auto" />
      </header>

      {/* cajón lateral */}
      {abierto && (
        <div className="lg:hidden fixed inset-0 z-50 flex" onClick={() => setAbierto(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="relative w-72 max-w-[85%] h-full bg-[#121212] text-white flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="h-9 w-auto" />
              <button onClick={() => setAbierto(false)} aria-label="Cerrar" className="text-white/60 hover:text-white">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
              {grupos.map((g) => (
                <div key={g.titulo}>
                  <p className="px-3 mb-1 text-[10px] font-semibold tracking-[0.18em] text-white/30 uppercase">{g.titulo}</p>
                  {g.items.map((i) => {
                    const esActivo = i.href === activo;
                    return (
                      <Link key={i.href} href={i.href} onClick={() => setAbierto(false)}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm mb-0.5 ${esActivo ? 'bg-[#B82D25] text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
                        <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] shrink-0 ${esActivo ? 'text-white' : 'text-white/40'}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={iconos[i.icono]} /></svg>
                        {i.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <a href="/api/salir" className="px-6 py-4 border-t border-white/10 text-[13px] text-white/50 hover:text-white">Cerrar sesión</a>
          </aside>
        </div>
      )}
    </>
  );
}
