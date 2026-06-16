import Link from "next/link";
import { notFound } from "next/navigation";
import { apiJson } from "../../../lib/api";
import { pesos, descuentoPct, type Producto as P } from "../../../lib/tipos";
import { AgregarProducto } from "../../ui/AgregarProducto";

export const dynamic = "force-dynamic";

export default async function ProductoPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const p = await apiJson<P | null>(`/productos/${encodeURIComponent(sku)}`, null);
  if (!p || !p.nombre) notFound();
  const prod = p as P;
  const pct = descuentoPct(prod);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <nav className="text-sm text-[#9B9088] mb-5">
        <Link href="/" className="hover:text-[#B82D25]">Inicio</Link> <span className="mx-1">/</span>
        <Link href="/catalogo" className="hover:text-[#B82D25]">Catálogo</Link>
        {prod.categoria && <> <span className="mx-1">/</span> <span>{prod.categoria}</span></>}
      </nav>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white rounded-3xl border border-black/5 overflow-hidden aspect-square grid place-items-center">
          {prod.imagenUrl ? (
            <img src={prod.imagenUrl} alt={prod.nombre} className="w-full h-full object-cover" />
          ) : (
            <span className="text-8xl font-bold text-black/10">{(prod.nombre ?? "?")[0]}</span>
          )}
        </div>

        <div>
          {prod.marca && <p className="text-sm text-[#9B9088] uppercase tracking-wide">{prod.marca}</p>}
          <h1 className="text-2xl sm:text-3xl font-bold text-[#2A201C] mt-1">{prod.nombre}</h1>

          <div className="flex items-center gap-2 mt-3">
            {prod.descuentoComunidad && <span className="bg-[#1A1412] text-[#C9A96E] text-xs font-semibold rounded-lg px-2.5 py-1">PRECIO COMUNIDAD</span>}
            {pct != null && <span className="bg-[#B82D25] text-white text-xs font-bold rounded-lg px-2.5 py-1">-{pct}%</span>}
            {prod.categoria && <span className="bg-[#ebe3d6] text-[#5f554d] text-xs rounded-lg px-2.5 py-1">{prod.categoria}</span>}
          </div>

          <div className="mt-5 flex items-end gap-3">
            <span className="text-3xl font-bold text-[#2A201C]">{pesos(prod.precio)}</span>
            {pct != null && <span className="text-lg text-[#9B9088] line-through">{pesos(prod.precioLista)}</span>}
          </div>

          <div className="mt-6">
            <AgregarProducto p={prod} />
          </div>

          <div className="mt-8 border-t border-black/5 pt-5 space-y-2 text-sm text-[#5f554d]">
            <div className="flex items-center gap-2"><span>🛵</span> Envío a domicilio desde O.D.B Central</div>
            <div className="flex items-center gap-2"><span>🏬</span> Retiro en el local (pick-up)</div>
            <div className="flex items-center gap-2"><span>💳</span> Pago con Mercado Pago</div>
          </div>
        </div>
      </div>
    </div>
  );
}
