import Link from "next/link";
import { LlamarMozoBoton } from "../LlamarMozoBoton";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

type Item = { id: string; nombre: string; descripcion: string | null; precio: number; imagenUrl: string | null };
type Categoria = { id: string; nombre: string; items: Item[] };

async function obtenerCarta(): Promise<{ categorias: Categoria[] }> {
  const res = await fetch(`${API}/carta`, { cache: "no-store" });
  if (!res.ok) return { categorias: [] };
  return res.json();
}

const formatoPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default async function CartaPage({ searchParams }: { searchParams: Promise<{ mesa?: string }> }) {
  const { categorias } = await obtenerCarta();
  const { mesa } = await searchParams;

  return (
    <div className="entrar pb-20">
      <h1 className="display text-2xl font-bold mb-1">Nuestra carta</h1>
      <p className="text-faint text-sm mb-4">Gran Caminito · Puerto Iguazú</p>
      <Link
        href="/anfitrion"
        className="inline-block text-xs font-semibold px-3 py-2 rounded-lg border border-line mb-8"
      >
        ¿No sabés qué elegir? Preguntale al Anfitrión 🥩
      </Link>

      {categorias.length === 0 && (
        <p className="text-dim text-sm">La carta todavía no está cargada.</p>
      )}

      <div className="flex flex-col gap-9">
        {categorias.map((cat) => (
          <section key={cat.id}>
            <h2 className="text-[10px] tracking-[0.14em] uppercase text-accent font-bold mb-3">{cat.nombre}</h2>
            <div className="flex flex-col gap-4">
              {cat.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-4 border-b border-line pb-4">
                  <div>
                    <h3 className="font-semibold text-sm">{item.nombre}</h3>
                    {item.descripcion && <p className="text-faint text-xs mt-1">{item.descripcion}</p>}
                  </div>
                  <div className="font-mono text-sm font-bold whitespace-nowrap tabular-nums">
                    {formatoPesos.format(item.precio)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {mesa && <LlamarMozoBoton token={mesa} flotante />}
    </div>
  );
}
