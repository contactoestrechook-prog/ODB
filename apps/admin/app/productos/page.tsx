import { Header } from '../ui/Header';

const API = process.env.API_URL ?? 'http://localhost:3001';

type Producto = {
  sku: string;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  precio: number | null;
  stockTotal: number;
  stockPorSucursal: { sucursal_id: string; cantidad: number; stock_minimo: number }[];
  esAlcohol: boolean;
};

const pesos = (n: number | null) =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR');

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string }>;
}) {
  const { buscar } = await searchParams;
  const url = `${API}/productos${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''}`;
  let productos: Producto[] = [];
  let error: string | null = null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    productos = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/productos" />

      <div className="max-w-5xl mx-auto p-6">
        <form className="mb-4 flex gap-2">
          <input
            type="search"
            name="buscar"
            defaultValue={buscar ?? ''}
            placeholder="Buscar por nombre o escanear código de barras…"
            className="flex-1 rounded-full border border-[#B82D25] bg-white px-4 py-2 text-sm text-black outline-none focus:ring-2 focus:ring-[#B82D25]/40"
          />
          <button
            type="submit"
            className="rounded-full bg-[#B82D25] px-6 py-2 text-sm font-medium text-white hover:bg-[#932A1F]"
          >
            Buscar
          </button>
        </form>

        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}). ¿Está corriendo en {API}?
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white">
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium text-right">Precio</th>
                  <th className="px-4 py-3 font-medium text-right">Stock S1</th>
                  <th className="px-4 py-3 font-medium text-right">Stock S2</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => {
                  const [s1, s2] = p.stockPorSucursal;
                  return (
                    <tr key={p.sku} className="border-b border-black/5 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.nombre}</p>
                        <p className="text-xs text-black/50">
                          {p.sku} {p.marca ? `· ${p.marca}` : ''}
                          {p.esAlcohol && <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-[10px] text-white">+18</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-black/70">{p.categoria ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium">{pesos(p.precio)}</td>
                      {[s1, s2].map((s, i) => (
                        <td key={i} className="px-4 py-3 text-right">
                          <span
                            className={
                              s && Number(s.cantidad) <= Number(s.stock_minimo)
                                ? 'rounded-full bg-[#B82D25] px-2 py-0.5 text-xs font-medium text-white'
                                : 'text-black/70'
                            }
                          >
                            {s ? Math.round(Number(s.cantidad)) : '—'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {productos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-black/50">
                      Sin resultados para «{buscar}»
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-black/40">
          {productos.length} producto{productos.length === 1 ? '' : 's'} · conectado a Supabase (región San Pablo)
        </p>
      </div>
    </main>
  );
}
