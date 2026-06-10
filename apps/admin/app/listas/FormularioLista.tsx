'use client';

import { useState } from 'react';

type Item = {
  codigo: string | null;
  descripcion: string;
  precio: number;
  match: {
    sku: string;
    nombre: string;
    costoActual: number | null;
    variacionPct: number | null;
    metodo: string;
  } | null;
};

type Resultado = { metodo: string; total: number; conMatch: number; items: Item[] };

const pesos = (n: number | null) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

const METODO_LABEL: Record<string, string> = {
  codigo_proveedor: 'por código',
  codigo_barras: 'por barras',
  similitud: 'por nombre',
};

export function FormularioLista({
  proveedores,
}: {
  proveedores: { id: string; razon_social: string }[];
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function analizar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setResultado(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/listas', { method: 'POST', body: form });
    const datos = await res.json();
    if (res.ok) setResultado(datos);
    else setError(datos.message ?? 'No se pudo analizar el archivo');
    setCargando(false);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-5">
        <h2 className="font-medium text-black mb-1">Actualizar lista de precios</h2>
        <p className="text-sm text-black/50 mb-4">
          Subí el PDF o Excel del proveedor: el sistema lo lee, lo cruza con el catálogo y te
          muestra las diferencias antes de aplicar nada.
        </p>
        <form onSubmit={analizar} className="flex flex-wrap items-center gap-3">
          <select
            name="proveedorId"
            required
            className="rounded-lg border border-black/15 px-3 py-2 text-sm text-black bg-white"
          >
            <option value="">Proveedor…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.razon_social}
              </option>
            ))}
          </select>
          <input
            type="file"
            name="archivo"
            required
            accept=".pdf,.xlsx,.xls,.csv"
            className="text-sm text-black/70 file:mr-3 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:text-white"
          />
          <button
            type="submit"
            disabled={cargando}
            className="rounded-full bg-[#B82D25] px-6 py-2 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-60"
          >
            {cargando ? 'Analizando…' : 'Analizar'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-[#932A1F]">{error}</p>}
      </section>

      {resultado && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
            <h2 className="font-medium text-black">Propuesta de actualización</h2>
            <span className="text-xs text-black/50">
              {resultado.conMatch} de {resultado.total} renglones reconocidos
            </span>
          </div>
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Renglón del proveedor</th>
                <th className="px-4 py-2 font-medium">Producto en ODB</th>
                <th className="px-4 py-2 font-medium text-right">Costo actual</th>
                <th className="px-4 py-2 font-medium text-right">Costo nuevo</th>
                <th className="px-4 py-2 font-medium text-right">Variación</th>
              </tr>
            </thead>
            <tbody>
              {resultado.items.map((i, idx) => (
                <tr key={idx} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <p>{i.descripcion}</p>
                    {i.codigo && <p className="text-xs text-black/40">{i.codigo}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {i.match ? (
                      <>
                        <p className="font-medium">{i.match.nombre}</p>
                        <p className="text-xs text-black/40">
                          {i.match.sku} · {METODO_LABEL[i.match.metodo] ?? i.match.metodo}
                        </p>
                      </>
                    ) : (
                      <span className="rounded-full bg-[#F0EBE2] px-2.5 py-0.5 text-xs text-[#932A1F]">
                        sin matchear: resolver a mano
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-black/70">
                    {pesos(i.match?.costoActual ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{pesos(i.precio)}</td>
                  <td className="px-4 py-3 text-right">
                    {i.match?.variacionPct != null ? (
                      <span
                        className={
                          'rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          (i.match.variacionPct > 0
                            ? 'bg-[#B82D25] text-white'
                            : 'bg-[#F0EBE2] text-black')
                        }
                      >
                        {i.match.variacionPct > 0 ? '+' : ''}
                        {i.match.variacionPct} %
                      </span>
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-black/40 border-t border-black/5">
            Esto actualiza costos de compra, no precios de venta. Para aplicar hace falta la clave
            de escritura del backend.
          </p>
        </section>
      )}
    </div>
  );
}
