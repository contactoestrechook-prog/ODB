'use client';

import { useState } from 'react';
import { Aviso, Boton, Etiqueta, Selector, TablaResponsiva, Tarjeta, TarjetaCabecera } from '../ui/kit';
import { pesos } from '../lib/formato';

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
    try {
      const res = await fetch('/api/listas', { method: 'POST', body: form });
      const datos = await res.json();
      if (res.ok) setResultado(datos);
      else setError(datos.message ?? 'No se pudo analizar el archivo');
    } catch {
      setError('No se pudo conectar. Reintentá.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tarjeta>
        <h2 className="mb-1 text-base font-semibold text-tinta">Actualizar lista de precios</h2>
        <p className="mb-4 text-sm text-tinta/70">
          Subí el PDF o Excel del proveedor: el sistema lo lee, lo cruza con el catálogo y te
          muestra las diferencias antes de aplicar nada.
        </p>
        <form onSubmit={analizar} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Selector name="proveedorId" required aria-label="Proveedor" vacio="Proveedor…" className="sm:w-64">
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.razon_social}
              </option>
            ))}
          </Selector>
          <input
            type="file"
            name="archivo"
            required
            accept=".pdf,.xlsx,.xls,.csv"
            aria-label="Archivo de la lista"
            className="w-full min-w-0 text-sm text-tinta/70 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border file:border-black/15 file:bg-white file:px-4 file:text-sm file:font-semibold file:text-tinta hover:file:bg-crema-claro sm:w-auto sm:flex-1 sm:file:min-h-10"
          />
          <Boton type="submit" disabled={cargando}>
            {cargando ? 'Analizando…' : 'Analizar'}
          </Boton>
        </form>
        {error && <Aviso tono="error" className="mt-3">{error}</Aviso>}
      </Tarjeta>

      {resultado && (
        <Tarjeta relleno={false}>
          <TarjetaCabecera
            titulo="Propuesta de actualización"
            sub={`${resultado.conMatch} de ${resultado.total} renglones reconocidos`}
          />
          <TablaResponsiva
            sinMarco
            etiqueta="Propuesta de actualización"
            filas={resultado.items}
            claveFila={(_, idx) => idx}
            vacio={<p className="px-4 py-6 text-sm text-tinta/60 sm:px-5">El archivo no trajo renglones para mostrar.</p>}
            columnas={[
              {
                clave: 'renglon',
                titulo: 'Renglón del proveedor',
                principal: true,
                celda: (i) => (
                  <>
                    <p className="break-words">{i.descripcion}</p>
                    {i.codigo && <p className="text-xs font-normal text-tinta/60">{i.codigo}</p>}
                  </>
                ),
              },
              {
                clave: 'producto',
                titulo: 'Producto en ODB',
                celda: (i) =>
                  i.match ? (
                    <>
                      <p className="break-words font-medium">{i.match.nombre}</p>
                      <p className="text-xs text-tinta/60">
                        {i.match.sku} · {METODO_LABEL[i.match.metodo] ?? i.match.metodo}
                      </p>
                    </>
                  ) : (
                    <Etiqueta tono="error">sin matchear: resolver a mano</Etiqueta>
                  ),
              },
              {
                clave: 'actual',
                titulo: 'Costo actual',
                importe: true,
                celda: (i) => <span className="text-tinta/70">{pesos(i.match?.costoActual ?? null)}</span>,
              },
              {
                clave: 'nuevo',
                titulo: 'Costo nuevo',
                importe: true,
                celda: (i) => <span className="font-semibold">{pesos(i.precio)}</span>,
              },
              {
                clave: 'variacion',
                titulo: 'Variación',
                importe: true,
                celda: (i) =>
                  i.match?.variacionPct != null ? (
                    <Etiqueta tono={i.match.variacionPct > 0 ? 'error' : 'neutro'}>
                      {i.match.variacionPct > 0 ? '+' : ''}
                      {i.match.variacionPct} %
                    </Etiqueta>
                  ) : (
                    <span className="text-tinta/60">—</span>
                  ),
              },
            ]}
          />
          <p className="border-t border-black/[0.06] px-4 py-3 text-xs text-tinta/60 sm:px-5">
            Esto actualiza costos de compra, no precios de venta. Para aplicar hace falta la clave
            de escritura del backend.
          </p>
        </Tarjeta>
      )}
    </div>
  );
}
