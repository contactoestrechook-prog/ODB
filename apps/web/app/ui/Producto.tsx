"use client";

import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos, descuentoPct, type Producto as P } from "../../lib/tipos";
import { IcoMas } from "./Iconos";
import { FotoProducto } from "./FotoProducto";
import { fotosCandidatas } from "../../lib/fotos";

function Tag({ children, tono }: { children: React.ReactNode; tono: "ink" | "rojo" | "socio" }) {
  const c = tono === "rojo" ? "bg-rojo text-white" : tono === "socio" ? "bg-white text-rojo ring-1 ring-rojo/30" : "bg-ink text-white";
  return <span className={`text-[11px] font-extrabold rounded-full px-2.5 py-1 leading-none ${c}`}>{children}</span>;
}

// Tarjeta "placa roja": placa crema con el pozo blanco de la foto adentro (los
// packshots vienen sobre blanco, así el producto queda recortado). Todo lo que
// es texto vive DEBAJO de la foto, nunca encima, y nada tiene ancho fijo: en
// celular, con dos columnas, el precio y el botón no entraban lado a lado y el
// texto se salía de la tarjeta; por eso ahí el botón queda solo con el "+".
export function Producto({ p, grande = false }: { p: P; grande?: boolean }) {
  const { agregar } = useCarrito();
  const pct = descuentoPct(p);
  const sinStock = p.stockTotal != null && p.stockTotal <= 0;

  return (
    <div className="group flex flex-col min-w-0 rounded-[20px] bg-crema p-2.5 sm:p-3">
      <Link
        href={`/producto/${p.sku}`}
        className={`relative block overflow-hidden rounded-[14px] bg-white ${grande ? "aspect-square" : "aspect-[4/5]"}`}
      >
        <FotoProducto
          imagenUrl={p.imagenUrl}
          fotos={fotosCandidatas(p.nombre, p.sku)}
          className="transition-transform duration-[600ms] ease-out group-hover:scale-[1.05]"
        />
        {(sinStock || pct != null || p.descuentoComunidad) && (
          <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
            {sinStock ? <Tag tono="ink">Sin stock</Tag> : pct != null ? <Tag tono="rojo">−{pct}%</Tag> : null}
            {p.descuentoComunidad && <Tag tono="socio">Precio socio</Tag>}
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col min-w-0 px-1 pt-3">
        {p.categoria && <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-rojo">{p.categoria}</p>}
        <Link
          href={`/producto/${p.sku}`}
          className={`mt-1 block leading-snug text-ink hover:text-rojo transition-colors line-clamp-2 [overflow-wrap:anywhere] ${grande ? "text-[15px] min-h-[2.6em]" : "text-[13.5px] min-h-[2.6em]"}`}
        >
          {p.nombre}
        </Link>

        <div className="mt-auto pt-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0 leading-none">
            {pct != null && <p className="text-[12px] text-humo line-through mb-1">{pesos(p.precioLista)}</p>}
            <p className={`marca font-extrabold text-ink truncate ${grande ? "text-[22px] sm:text-[24px]" : "text-[19px] sm:text-[21px]"}`}>{pesos(p.precio)}</p>
          </div>
          {!sinStock && p.precio != null && (
            <button
              onClick={() => agregar(p)}
              aria-label={`Agregar ${p.nombre}`}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 rounded-full bg-ink px-3 sm:px-3.5 text-[12.5px] font-bold text-white hover:bg-rojo active:scale-95 transition-colors"
            >
              <IcoMas size={15} />
              <span className="hidden sm:inline">Agregar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
