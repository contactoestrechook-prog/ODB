import Link from 'next/link';
import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';

type Producto = {
  imagenUrl: string | null;
  sku: string;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  stockTotal: number;
  stockPorSucursal: { sucursal_id: string; cantidad: number; stock_minimo: number }[];
  esAlcohol: boolean;
};

type Respuesta = {
  total: number;
  pagina: number;
  paginas: number;
  items: Producto[];
};

type Filtros = {
  categorias: { id: string; nombre: string }[];
  marcas: { id: string; nombre: string }[];
};

const pesos = (n: number | null) =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR');

export const dynamic = 'force-dynamic';

type Params = {
  buscar?: string;
  categoriaId?: string;
  marcaId?: string;
  filtro?: string;
  orden?: string;
  pagina?: string;
};

const qs = (p: Params, cambios: Partial<Params>) => {
  const merged = { ...p, ...cambios };
  const partes = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  return partes.length ? `?${partes.join('&')}` : '';
};

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  let datos: Respuesta = { total: 0, pagina: 1, paginas: 1, items: [] };
  let filtros: Filtros = { categorias: [], marcas: [] };
  let error: string | null = null;
  try {
    const [rp, rf] = await Promise.all([
      apiFetch(`/productos${qs(params, {})}`),
      apiFetch('/catalogo/filtros'),
    ]);
    if (!rp.ok) throw new Error(`API respondió ${rp.status}`);
    datos = await rp.json();
    if (rf.ok) filtros = await rf.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const select =
    'rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black outline-none focus:border-[#B82D25]';

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/productos" />
      <div className="max-w-6xl mx-auto p-6">
        <form className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="buscar"
            defaultValue={params.buscar ?? ''}
            placeholder="Nombre, SKU o código de barras…"
            className="flex-1 min-w-48 rounded-full border border-[#B82D25] bg-white px-4 py-2 text-sm text-black outline-none focus:ring-2 focus:ring-[#B82D25]/40"
          />
          <select name="categoriaId" defaultValue={params.categoriaId ?? ''} className={select}>
            <option value="">Categoría</option>
            {filtros.categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select name="marcaId" defaultValue={params.marcaId ?? ''} className={select}>
            <option value="">Marca</option>
            {filtros.marcas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          <select name="filtro" defaultValue={params.filtro ?? ''} className={select}>
            <option value="">Estado</option>
            <option value="bajo_minimo">Bajo mínimo</option>
            <option value="promo">En promoción</option>
            <option value="sin_stock">Sin stock</option>
          </select>
          <select name="orden" defaultValue={params.orden ?? ''} className={select}>
            <option value="">A → Z</option>
            <option value="nombre_desc">Z → A</option>
            <option value="recientes">Más nuevos</option>
          </select>
          <button
            type="submit"
            className="rounded-full bg-[#B82D25] px-5 py-2 text-sm font-medium text-white hover:bg-[#932A1F]"
          >
            Filtrar
          </button>
          {(params.buscar || params.categoriaId || params.marcaId || params.filtro || params.orden) && (
            <Link href="/productos" className="text-xs text-black/50 underline">
              limpiar
            </Link>
          )}
        </form>

        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        ) : (
          <>
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
                  {datos.items.map((p) => {
                    const [s1, s2] = p.stockPorSucursal;
                    return (
                      <tr key={p.sku} className="border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/40">
                        <td className="px-4 py-3">
                          <Link href={`/productos/${p.sku}`} className="flex items-center gap-3">
                            {p.imagenUrl ? (
                              <img src={p.imagenUrl} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
                            ) : (
                              <span className="h-10 w-10 rounded-lg bg-[#F0EBE2] shrink-0 flex items-center justify-center text-black/30 text-xs">
                                foto
                              </span>
                            )}
                            <span>
                            <p className="font-medium hover:text-[#932A1F]">{p.nombre}</p>
                            <p className="text-xs text-black/50">
                              {p.sku} {p.marca ? `· ${p.marca}` : ''}
                              {p.esAlcohol && (
                                <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-[10px] text-white">+18</span>
                              )}
                            </p>
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-black/70">{p.categoria ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {p.descuento ? (
                            <>
                              <p className="text-xs text-black/40 line-through">{pesos(p.precioLista)}</p>
                              <p className="font-medium text-[#B82D25]" title={p.descuento}>{pesos(p.precio)}</p>
                            </>
                          ) : (
                            <p className="font-medium">{pesos(p.precio)}</p>
                          )}
                        </td>
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
                  {datos.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-black/50">
                        Sin resultados con estos filtros
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <p className="text-xs text-black/40">
                {datos.total.toLocaleString('es-AR')} productos · página {datos.pagina} de {datos.paginas}
              </p>
              <div className="flex gap-2">
                {datos.pagina > 1 && (
                  <Link
                    href={`/productos${qs(params, { pagina: String(datos.pagina - 1) })}`}
                    className="rounded-full border border-black/20 bg-white px-4 py-1.5 text-xs text-black hover:border-black"
                  >
                    ← Anterior
                  </Link>
                )}
                {datos.pagina < datos.paginas && (
                  <Link
                    href={`/productos${qs(params, { pagina: String(datos.pagina + 1) })}`}
                    className="rounded-full bg-black px-4 py-1.5 text-xs text-white"
                  >
                    Siguiente →
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
