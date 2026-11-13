'use client';

import { useState } from 'react';
import { Boton, Entrada } from './kit';
import { pesos } from '../lib/formato';

// ============================================================
// AGREGAR UN RENGLÓN A LA FACTURA (13/11/2026). El chat le dijo a la persona
// «agregá dos renglones con el botón de agregar renglón de la tabla» y ese
// botón no existía (Artesano: renglón 3 partido en 20 + 4 Brioche + 6
// Integral, la cuenta quedó $55.000 abajo). Ahora está, al final de la lista:
// qué es, unidades y precio por unidad. El renglón entra sin producto; se elige
// en el renglón, como cualquier otro que el sistema no reconoció.
// ============================================================

function leerNumero(s: string): number | null {
  let t = String(s ?? '').trim().replace(/\s|\$/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function AgregarRenglon({ onAgregar }: { onAgregar: (d: { descripcion: string; cantidad: number; precio: number }) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [listo, setListo] = useState<string | null>(null);

  const c = leerNumero(cantidad);
  const p = leerNumero(precio);
  const falta = !descripcion.trim() ? 'Escribí qué es' : !(c != null && c > 0) ? 'Poné las unidades' : !(p != null && p >= 0) ? 'Poné el precio por unidad' : null;

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
        onAgregar({ descripcion: descripcion.trim(), cantidad: c, precio: p });
        setListo(`Agregado al final: ${descripcion.trim()}. Elegí el producto en el renglón para que entre al stock.`);
        setDescripcion(''); setCantidad(''); setPrecio('');
        setAbierto(false);
      }}
      className="rounded-xl border border-dashed border-black/20 bg-white px-3 py-3"
    >
      <p className="text-sm font-semibold text-tinta">Agregar un renglón</p>
      <p className="mt-0.5 text-xs text-tinta/60">Va al final de la lista. El precio, por unidad y como los demás precios de esta factura.</p>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-tinta/60">Qué es</span>
          <Entrada value={descripcion} onChange={(e) => setDescripcion(e.target.value)} aria-label="Qué es el renglón" autoFocus />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-tinta/60">Unidades</span>
          <Entrada inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-label="Unidades del renglón" className="text-right" />
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
        <Boton type="button" variante="secundario" tamano="chico" onClick={() => setAbierto(false)}>Cancelar</Boton>
        {falta && (descripcion || cantidad || precio) && <span className="text-xs text-tinta/60">{falta}</span>}
      </div>
    </form>
  );
}
