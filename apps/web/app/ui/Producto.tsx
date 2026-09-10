"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos, descuentoPct, type Producto as P } from "../../lib/tipos";
import { IcoMas } from "./Iconos";
import { FotoProducto } from "./FotoProducto";
import { fotosCandidatas } from "../../lib/fotos";

function Tag({ children, tono }: { children: React.ReactNode; tono: "ink" | "rojo" | "oro" }) {
  const c =
    tono === "rojo" ? "bg-rojo text-crema"
    : tono === "oro" ? "bg-ink/85 text-dorado-claro border border-dorado/40"
    : "bg-ink/85 text-crema";
  return <span className={`text-[10px] tracking-[0.12em] uppercase font-semibold rounded px-2 py-1 ${c}`}>{children}</span>;
}

// La tarjeta manda la foto: las del catálogo son packshots sobre blanco, así que
// el cuadro va blanco (no crema) para que el producto quede recortado contra el
// fondo y no se vea el rectángulo de la imagen. `grande` la usa la primera fila
// del catálogo, que es la que abre la góndola.
export function Producto({ p, grande = false }: { p: P; grande?: boolean }) {
  const { agregar } = useCarrito();
  const pct = descuentoPct(p);
  const sinStock = p.stockTotal != null && p.stockTotal <= 0;

  return (
    <div className="group">
      <Link
        href={`/producto/${p.sku}`}
        className={`block relative overflow-hidden rounded-xl bg-white ring-1 ring-tinta/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow duration-300 group-hover:shadow-[0_10px_30px_rgba(0,0,0,0.10)] ${grande ? "aspect-square" : "aspect-[4/5]"}`}
      >
        <FotoProducto
          imagenUrl={p.imagenUrl}
          fotos={fotosCandidatas(p.nombre, p.sku)}
          className="transition-transform duration-[600ms] ease-out group-hover:scale-[1.06]"
        />
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {sinStock ? <Tag tono="ink">Sin stock</Tag> : pct != null ? <Tag tono="rojo">−{pct}%</Tag> : null}
          {p.descuentoComunidad && <Tag tono="oro">Socio</Tag>}
        </div>
      </Link>

      <div className="pt-3.5">
        {p.categoria && <p className="kicker text-dorado">{p.categoria}</p>}
        <Link
          href={`/producto/${p.sku}`}
          className={`block mt-1 leading-snug text-tinta hover:text-rojo transition-colors line-clamp-2 ${grande ? "text-[15px] min-h-[2.6rem]" : "text-[14px] min-h-[2.5rem]"}`}
        >
          {p.nombre}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="leading-none">
            <span className={`display font-semibold text-ink ${grande ? "text-[22px]" : "text-[19px]"}`}>{pesos(p.precio)}</span>
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
