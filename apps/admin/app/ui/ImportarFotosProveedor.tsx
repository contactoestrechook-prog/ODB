'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Etiqueta, Selector, TablaResponsiva, Tarjeta, clasesBoton, type TonoEtiqueta } from './kit';

type Resultado = {
  procesados: number;
  subidos: number;
  rechazadas_calidad: number;
  sin_coincidencia: number;
  detalle: { archivo: string; estado: string; sku?: string; motivo?: string }[];
};

type Detalle = Resultado['detalle'][number];

const ETIQUETA: Record<string, { texto: string; tono: TonoEtiqueta }> = {
  subida: { texto: 'Subida', tono: 'ok' },
  rechazada_calidad: { texto: 'Rechazada (calidad)', tono: 'atencion' },
  sin_coincidencia: { texto: 'Sin coincidencia', tono: 'neutro' },
  error_subida: { texto: 'Error al subir', tono: 'error' },
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

  const etiquetaDe = (d: Detalle) => ETIQUETA[d.estado] ?? { texto: d.estado, tono: 'neutro' as const };

  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-tinta">Pack de fotos de un proveedor</h2>
        <p className="mt-0.5 text-xs text-tinta/60">
          Subí las fotos tal como te las mandaron (por WhatsApp, mail o carpeta). Si el archivo se llama con el
          SKU, el código de barra o el código que ese proveedor usa para el producto, el sistema lo reconoce solo.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Selector
          value={proveedorId}
          onChange={(e) => setProveedorId(e.target.value)}
          aria-label="Proveedor"
          className="sm:w-64"
        >
          <option value="">Proveedor (opcional, ayuda a matchear por su código)</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>{p.razonSocial ?? p.razon_social}</option>
          ))}
        </Selector>
        <label className={clasesBoton({ variante: 'secundario' })}>
          {archivos.length ? `${archivos.length} ${archivos.length === 1 ? 'foto elegida' : 'fotos elegidas'}` : 'Elegir fotos'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png"
            onChange={(e) => setArchivos(Array.from(e.target.files ?? []))}
            className="sr-only"
          />
        </label>
        <Boton onClick={subir} disabled={subiendo || !archivos.length}>
          {subiendo ? `Procesando ${archivos.length}…` : `Subir ${archivos.length || ''} foto${archivos.length === 1 ? '' : 's'}`}
        </Boton>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {resultado && (
        <div className="space-y-2">
          <p className="text-sm text-tinta/70">
            {resultado.subidos} subidas · {resultado.rechazadas_calidad} rechazadas por calidad · {resultado.sin_coincidencia} sin coincidencia
            {' '}(de {resultado.procesados}).
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-black/[0.06]">
            <TablaResponsiva
              sinMarco
              etiqueta="Resultado de las fotos"
              filas={resultado.detalle}
              claveFila={(_, i) => i}
              vacio={<></>}
              tarjetaMovil={(d) => (
                <div className="space-y-1 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all text-tinta/70">{d.archivo}</span>
                    <Etiqueta tono={etiquetaDe(d).tono} className="shrink-0">{etiquetaDe(d).texto}</Etiqueta>
                  </div>
                  <p className="text-tinta/60">
                    {d.sku ?? '—'}{d.motivo ? ` · ${d.motivo}` : ''}
                  </p>
                </div>
              )}
              columnas={[
                { clave: 'archivo', titulo: 'Archivo', celda: (d) => <span className="break-all text-xs text-tinta/70">{d.archivo}</span> },
                { clave: 'sku', titulo: 'SKU', celda: (d) => <span className="text-xs text-tinta/60">{d.sku ?? '—'}</span> },
                {
                  clave: 'estado',
                  titulo: 'Estado',
                  celda: (d) => <Etiqueta tono={etiquetaDe(d).tono}>{etiquetaDe(d).texto}</Etiqueta>,
                },
                { clave: 'motivo', titulo: 'Motivo', celda: (d) => <span className="text-xs text-tinta/60">{d.motivo ?? ''}</span> },
              ]}
            />
          </div>
        </div>
      )}
    </Tarjeta>
  );
}
