"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos, descuentoPct, type Producto as P } from "../../lib/tipos";
import { IcoMas } from "./Iconos";

function Tag({ children, tono }: { children: React.ReactNode; tono: "ink" | "rojo" | "oro" }) {
  const c =
    tono === "rojo" ? "bg-rojo text-crema"
    : tono === "oro" ? "bg-ink/85 text-dorado-claro border border-dorado/40"
    : "bg-ink/85 text-crema";
  return <span className={`text-[10px] tracking-[0.12em] uppercase font-semibold rounded px-2 py-1 ${c}`}>{children}</span>;
}

export function Producto({ p }: { p: P }) {
  const { agregar } = useCarrito();
  const pct = descuentoPct(p);
  const sinStock = p.stockTotal != null && p.stockTotal <= 0;

  return (
    <div className="group">
      <Link href={`/producto/${p.sku}`} className="block relative overflow-hidden rounded-[10px] bg-crema aspect-[4/5]">
        {p.imagenUrl ? (
          <img src={p.imagenUrl} alt={p.nombre} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#efe7d9]">
            <span className="display text-6xl font-semibold text-ink/12">{(p.nombre ?? "?")[0]}</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {sinStock ? <Tag tono="ink">Sin stock</Tag> : pct != null ? <Tag tono="rojo">−{pct}%</Tag> : null}
          {p.descuentoComunidad && <Tag tono="oro">Socio</Tag>}
        </div>
      </Link>

      <div className="pt-3.5">
        {p.categoria && <p className="kicker text-dorado">{p.categoria}</p>}
        <Link href={`/producto/${p.sku}`} className="block mt-1 text-[14px] leading-snug text-tinta hover:text-rojo transition-colors line-clamp-2 min-h-[2.5rem]">
          {p.nombre}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="leading-none">
            <span className="display text-[19px] font-semibold text-ink">{pesos(p.precio)}</span>
            {pct != null && <span className="ml-2 text-xs text-humo line-through">{pesos(p.precioLista)}</span>}
          </div>
          {!sinStock && p.precio != null && (
            <button
              onClick={() => agregar(p)}
              aria-label={`Agregar ${p.nombre}`}
              className="shrink-0 w-9 h-9 grid place-items-center rounded-full border border-tinta/20 text-tinta hover:bg-ink hover:text-crema hover:border-ink active:scale-95 transition-colors"
            >
              <IcoMas size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
