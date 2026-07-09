'use client';

import { useEffect, useRef, useState } from 'react';

type Resultado = {
  procesados: number;
  subidos: number;
  rechazadas_calidad: number;
  sin_coincidencia: number;
  detalle: { archivo: string; estado: string; sku?: string; motivo?: string }[];
};

const ETIQUETA: Record<string, { texto: string; clase: string }> = {
  subida: { texto: 'Subida', clase: 'bg-emerald-50 text-emerald-800' },
  rechazada_calidad: { texto: 'Rechazada (calidad)', clase: 'bg-amber-50 text-amber-800' },
  sin_coincidencia: { texto: 'Sin coincidencia', clase: 'bg-black/5 text-black/50' },
  error_subida: { texto: 'Error al subir', clase: 'bg-red-50 text-red-800' },
};

// Pack de fotos que manda un proveedor: se suben varios archivos de una y el
// sistema matchea cada uno por su nombre (SKU, código de barra o el código
// propio del proveedor para ese producto) contra el catálogo. Cada foto que
// matchea pasa el mismo control de calidad que la búsqueda automática.
export default function ImportarFotosProveedor() {
  const [proveedores, setProveedores] = useState<{ id: string; razonSocial?: string; razon_social?: string }[]>([]);
  const [proveedorId, setProveedorId] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/compras?recurso=proveedores')
      .then((r) => r.json())
      .then((d) => setProveedores(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const subir = async () => {
    if (!archivos.length) return;
    setSubiendo(true);
    setError(null);
    setResultado(null);
    try {
      const form = new FormData();
      archivos.forEach((f) => form.append('archivos', f));
      if (proveedorId) form.append('proveedorId', proveedorId);
      const r = await fetch('/api/fotos-proveedor', { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudieron procesar las fotos');
      setResultado(d);
      setArchivos([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron procesar las fotos');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <section className="rounded-xl bg-white p-4 border border-black/[0.04] space-y-3">
      <div>
        <p className="text-sm font-medium text-black">Pack de fotos de un proveedor</p>
        <p className="text-[11px] text-black/40 mt-0.5">
          Subí las fotos tal como te las mandaron (por WhatsApp, mail o carpeta). Si el archivo se llama con el
          SKU, el código de barra o el código que ese proveedor usa para el producto, el sistema lo reconoce solo.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={proveedorId}
          onChange={(e) => setProveedorId(e.target.value)}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm sm:w-64"
        >
          <option value="">Proveedor (opcional, ayuda a matchear por su código)</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>{p.razonSocial ?? p.razon_social}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png"
          onChange={(e) => setArchivos(Array.from(e.target.files ?? []))}
          className="flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:text-white file:text-sm file:font-medium file:px-3 file:py-2 file:cursor-pointer"
        />
        <button
          onClick={subir}
          disabled={subiendo || !archivos.length}
          className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-[#9e251e] whitespace-nowrap"
        >
          {subiendo ? `Procesando ${archivos.length}…` : `Subir ${archivos.length || ''} foto${archivos.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {error && <p className="text-sm text-[#932A1F]">{error}</p>}

      {resultado && (
        <div className="space-y-2">
          <p className="text-sm text-black/70">
            {resultado.subidos} subidas · {resultado.rechazadas_calidad} rechazadas por calidad · {resultado.sin_coincidencia} sin coincidencia
            {' '}(de {resultado.procesados}).
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-black/10">
            <table className="w-full text-xs">
              <tbody>
                {resultado.detalle.map((d, i) => {
                  const et = ETIQUETA[d.estado] ?? { texto: d.estado, clase: 'bg-black/5 text-black/50' };
                  return (
                    <tr key={i} className="border-b border-black/5 last:border-0">
                      <td className="px-3 py-1.5 text-black/70">{d.archivo}</td>
                      <td className="px-3 py-1.5 text-black/50">{d.sku ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded-md px-2 py-0.5 ${et.clase}`}>{et.texto}</span>
                      </td>
                      <td className="px-3 py-1.5 text-black/40">{d.motivo ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
