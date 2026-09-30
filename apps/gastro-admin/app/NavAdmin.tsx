"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cerrarSesion } from "./lib/api";

// Agrupada por quién la usa: el dueño mira NEGOCIO, el salón vive en
// OPERACIÓN. En el teléfono es una fila deslizable; los grupos son el mapa.
const GRUPOS: { titulo: string; links: { href: string; label: string; icono: string }[] }[] = [
  {
    titulo: "Operación",
    links: [
      { href: "/piso-vivo", label: "Piso Vivo", icono: "🔥" },
      { href: "/encargado", label: "Encargado", icono: "🪑" },
      { href: "/mozo", label: "Mozo", icono: "🤵" },
      { href: "/cocina", label: "Cocina", icono: "👨‍🍳" },
      { href: "/espera", label: "Espera", icono: "⏳" },
    ],
  },
  {
    titulo: "Negocio",
    links: [
      { href: "/", label: "Resumen", icono: "📊" },
      { href: "/compras", label: "Compras", icono: "🚚" },
      { href: "/clientes", label: "Clientes", icono: "👥" },
      { href: "/resenas", label: "Reseñas", icono: "⭐" },
    ],
  },
  {
    titulo: "Ajustes",
    links: [
      { href: "/carta", label: "Carta", icono: "📖" },
      { href: "/configuracion", label: "Config", icono: "⚙️" },
    ],
  },
];

export function NavAdmin() {
  const path = usePathname();
  return (
    <nav className="border-b border-line pb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold display text-base flex items-center justify-center">
            N
          </span>
          <div>
            <p className="display font-bold text-sm leading-tight">Gran Caminito</p>
            <p className="text-faint text-[10px] leading-tight">NÚCLEO Gastro</p>
          </div>
        </div>
        <button onClick={() => { cerrarSesion(); window.location.reload(); }} className="text-faint text-xs">
          Salir
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-0.5 -mx-5 px-5">
        {GRUPOS.map((g) => (
          <div key={g.titulo} className="flex-none">
            <p className="text-[9px] tracking-[0.12em] uppercase text-faint font-bold mb-1.5">{g.titulo}</p>
            <div className="flex gap-1">
              {g.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap ${
                    path === l.href ? "bg-card font-semibold border border-line" : "text-dim border border-transparent"
                  }`}
                >
                  <span className="text-[13px] leading-none">{l.icono}</span>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
