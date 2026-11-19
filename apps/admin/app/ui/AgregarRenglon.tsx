'use client';

import { useEffect, useRef, useState } from 'react';
import { Boton, Entrada } from './kit';
import { pesos } from '../lib/formato';
import { conCodigo } from '../lib/codigo-producto';

// ============================================================
// AGREGAR UN RENGLÓN A LA FACTURA (13/11/2026). El chat le dijo a la persona
// «agregá dos renglones con el botón de agregar renglón de la tabla» y ese
// botón no existía (Artesano: renglón 3 partido en 20 + 4 Brioche + 6
// Integral, la cuenta quedó $55.000 abajo). Ahora está, al final de la lista:
// qué es, unidades y precio por unidad.
//
// LA FACTURA A MANO (19/11/2026, Leandro: «carga manual opcional de facturas
// para cuando no reconoce items»): el renglón se puede vincular acá mismo con
// su producto (por nombre, código o con la pistola), así entra al stock sin un
// segundo paso. En la carga a mano el formulario queda siempre abierto y,
// después de cada renglón, vuelve al buscador para el siguiente.
// ============================================================

function leerNumero(s: string): number | null {
  let t = String(s ?? '').trim().replace(/\s|\$/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type ProductoElegido = { sku: string; nombre: string; codigo?: string | null; costo?: number | null; precio?: number | null; alicuotaIva?: number | null; [k: string]: unknown };

export function AgregarRenglon({ onAgregar, aMano = false }: {
  onAgregar: (d: { descripcion: string; cantidad: number; precio: number }, producto: ProductoElegido | null) => void;
  /** carga a mano: siempre abierto y vuelve al buscador después de cada renglón */
  aMano?: boolean;
}) {
  const [abierto, setAbierto] = useState(aMano);
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<ProductoElegido[]>([]);
  const [producto, setProducto] = useState<ProductoElegido | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [listo, setListo] = useState<string | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const unidades = useRef<HTMLInputElement>(null);

  useEffect(() => { if (aMano) setAbierto(true); }, [aMano]);

  // el mismo buscador que el de cada renglón: nombre, código o PLU
  useEffect(() => {
    if (producto || busca.trim().length < 2) { setSug([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca.trim())}`).catch(() => null);
      if (r?.ok) setSug(((await r.json()).items ?? []).slice(0, 12));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, producto]);

  const elegir = (p: ProductoElegido) => {
    setProducto(p);
    setSug([]);
    setBusca('');
    if (!descripcion.trim()) setDescripcion(String(p.nombre ?? ''));
    setTimeout(() => unidades.current?.focus(), 0);
  };

  const c = leerNumero(cantidad);
  const p = leerNumero(precio);
  const falta = !descripcion.trim() ? (aMano ? 'Elegí el producto o escribí qué dice el papel' : 'Escribí qué es') : !(c != null && c > 0) ? 'Poné las unidades' : !(p != null && p >= 0) ? 'Poné el precio por unidad' : null;

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Boton type="button" variante="secundario" tamano="chico" onClick={() => { setAbierto(true); setListo(null); }}>
          + Agregar renglón
        </Boton>
        {listo && <span className="text-xs text-ok" role="status">{listo}</span>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (falta || c == null || p == null) return;
        onAgregar({ descripcion: descripcion.trim(), cantidad: c, precio: p }, producto);
        setListo(producto
          ? `Agregado: ${descripcion.trim()} → ${producto.nombre}.`
          : `Agregado al final: ${descripcion.trim()}. Elegí el producto en el renglón para que entre al stock.`);
        setDescripcion(''); setCantidad(''); setPrecio(''); setProducto(null); setBusca('');
        if (aMano) setTimeout(() => buscador.current?.focus(), 0);
        else setAbierto(false);
      }}
      className="rounded-xl border border-dashed border-black/20 bg-white px-3 py-3"
    >
      <p className="text-sm font-semibold text-tinta">{aMano ? 'Agregar un renglón de la factura' : 'Agregar un renglón'}</p>
      <p className="mt-0.5 text-xs text-tinta/60">
        {aMano
          ? 'Uno por renglón del papel: el producto, las unidades y el precio de cada unidad como lo dice el papel (en la factura A, sin IVA). Bultos, bonificación e IVA se ajustan después en el renglón.'
          : 'Va al final de la lista. El precio, por unidad y como los demás precios de esta factura.'}
      </p>

      {/* el producto: opcional; sin producto el renglón entra a la cuenta pero no al stock */}
      <div className="relative mt-2.5">
        {producto ? (
          <p className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-ok-suave px-3 py-2 text-sm text-tinta">
            <span className="text-xs text-tinta/60">Producto:</span>
            <b className="min-w-0 break-words font-semibold">{conCodigo(String(producto.nombre ?? ''), producto as any)}</b>
            <span className="text-xs text-tinta/60">{producto.sku}</span>
            <button type="button" onClick={() => { setProducto(null); setTimeout(() => buscador.current?.focus(), 0); }} className="ml-auto text-xs text-tinta/70 underline hover:text-marca-hondo">cambiar</button>
          </p>
        ) : (
          <label className="block min-w-0">
            <span className="mb-0.5 block text-xs text-tinta/60">Producto en el sistema{aMano ? '' : ' (opcional)'}</span>
            <Entrada
              ref={buscador}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                // con la pistola o un código exacto: si hay uno solo, se elige con Enter
                if (e.key === 'Enter') { e.preventDefault(); if (sug.length === 1) elegir(sug[0]); }
                if (e.key === 'Escape' && sug.length) { e.stopPropagation(); setSug([]); }
              }}
              placeholder="Buscar por nombre, código o PLU"
              aria-label="Buscar el producto del renglón"
              autoFocus={aMano}
            />
          </label>
        )}
        {sug.length > 0 && (
          <div className="absolute z-contenido mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
            {sug.map((s) => (
              <button
                key={s.sku}
                type="button"
                onClick={() => elegir(s)}
                className="min-h-11 w-full border-b border-black/[0.06] px-3 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none"
              >
                {conCodigo(String(s.nombre ?? ''), s as any)} <span className="text-xs text-tinta/60">{s.sku}</span>
                {Number(s.costo) > 0 && <span className="ml-2 text-xs text-tinta/60">último costo {pesos(Number(s.costo))}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-tinta/60">{aMano ? 'Qué dice el papel' : 'Qué es'}</span>
          <Entrada value={descripcion} onChange={(e) => setDescripcion(e.target.value)} aria-label="Qué es el renglón" autoFocus={!aMano} />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-tinta/60">Unidades</span>
          <Entrada ref={unidades} inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-label="Unidades del renglón" className="text-right" />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-tinta/60">Precio por unidad</span>
          <Entrada inputMode="decimal" prefijo="$" value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label="Precio por unidad del renglón" className="text-right" />
        </label>
        <p className="importe pb-2 text-right text-sm text-tinta/70 sm:min-w-28">
          {c != null && p != null && c > 0 ? <>= <b className="text-tinta">{pesos(Math.round(c * p * 100) / 100)}</b></> : ' '}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Boton type="submit" tamano="chico" disabled={!!falta}>Agregar renglón</Boton>
        {!aMano && <Boton type="button" variante="secundario" tamano="chico" onClick={() => setAbierto(false)}>Cancelar</Boton>}
        {falta && (descripcion || cantidad || precio) && <span className="text-xs text-tinta/60">{falta}</span>}
        {listo && aMano && !(descripcion || cantidad || precio) && <span className="text-xs text-ok" role="status">{listo}</span>}
      </div>
    </form>
  );
}
