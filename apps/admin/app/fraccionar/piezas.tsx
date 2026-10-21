'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Entrada, Etiqueta, FOCO, IconoCerrar, unir } from '../ui/kit';
import { pesos, numero } from '../lib/formato';

// Piezas chicas de la pantalla Fraccionar: el contador − / +, el buscador de
// productos (el mismo del POS, con stock de la sucursal) y la caja del
// producto elegido.

function Trazo({ d, className = 'size-5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
export const IconoMas = ({ className }: { className?: string }) => <Trazo className={className} d="M12 5v14M5 12h14" />;
export const IconoMenos = ({ className }: { className?: string }) => <Trazo className={className} d="M5 12h14" />;

// Botón redondo de 44 px (el dedo) para − / + y para sacar lo elegido.
const BOTON_REDONDO = unir(
  'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-tinta transition-colors',
  'hover:border-black/25 hover:bg-crema-claro active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
  FOCO,
);
const BOTON_QUITAR = unir(
  'grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo',
  FOCO,
);

/** Cantidad entera con − y +, entre 1 y `max`. El texto puede quedar vacío mientras se escribe. */
/** Va dentro de un <Campo> (el rótulo) o con `etiqueta` para los lectores de pantalla. */
export function Contador({ valor, onCambiar, max, etiqueta }: { valor: string; onCambiar: (v: string) => void; max: number; etiqueta?: string }) {
  const n = parseInt(valor, 10) || 0;
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={BOTON_REDONDO} onClick={() => onCambiar(String(Math.max(1, Math.min(max, n - 1))))} disabled={n <= 1} aria-label="Una menos">
        <IconoMenos />
      </button>
      <div className="w-24 min-w-0">
        <Entrada
          inputMode="numeric"
          value={valor}
          onChange={(e) => onCambiar(e.target.value.replace(/\D/g, '').slice(0, 4))}
          aria-label={etiqueta}
          className="importe text-center text-lg font-semibold"
        />
      </div>
      <button type="button" className={BOTON_REDONDO} onClick={() => onCambiar(String(Math.max(1, Math.min(max, n + 1))))} disabled={n >= max} aria-label="Una más">
        <IconoMas />
      </button>
    </div>
  );
}

export type ItemBusqueda = {
  sku: string;
  nombre: string;
  precio: number | null;
  stock: number | null;
  activo: boolean;
  porPeso: boolean;
};

/** Qué decir de un resultado: "ya es presentación de…" (y si se puede elegir igual). */
export type NotaBusqueda = { texto: string; bloquea: boolean } | null;

/**
 * Buscador de productos (el del POS: nombre, SKU o código de barras, sin
 * tildes ni plurales, con el stock de la sucursal). Va dentro de un <Campo>.
 */
export function BuscadorProducto({
  sucursalId,
  onElegir,
  nota,
  placeholder = 'Nombre, SKU o código de barras…',
  autoFocus = false,
}: {
  sucursalId: string;
  autoFocus?: boolean;
  onElegir: (p: ItemBusqueda) => void;
  nota?: (p: ItemBusqueda) => NotaBusqueda;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState('');
  const [items, setItems] = useState<ItemBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState('');
  const ultima = useRef(0);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) return;
    const esta = ++ultima.current;
    const espera = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/pos-buscar?q=${encodeURIComponent(q)}&sucursal=${encodeURIComponent(sucursalId)}`);
        const d = await res.json().catch(() => ({}));
        if (esta !== ultima.current) return; // llegó tarde: ya se escribió otra cosa
        setItems(((d.items ?? []) as ItemBusqueda[]).filter((i) => i.activo !== false));
        setBuscado(q);
      } finally {
        if (esta === ultima.current) setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(espera);
  }, [texto, sucursalId]);

  const corto = texto.trim().length < 2;
  const visibles = corto ? [] : items;
  return (
    <div className="min-w-0">
      <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus} />
      {!corto && (buscando || visibles.length > 0 || buscado === texto.trim()) && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
          {buscando && visibles.length === 0 && <p className="px-3.5 py-3 text-sm text-tinta/60">Buscando…</p>}
          {!buscando && visibles.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-tinta/60">No encontré nada con «{texto.trim()}». Probá con otra palabra o el SKU.</p>
          )}
          {visibles.map((p) => {
            const n = nota?.(p) ?? null;
            return (
              <button
                key={p.sku}
                type="button"
                disabled={n?.bloquea}
                onClick={() => {
                  onElegir(p);
                  setTexto('');
                  setItems([]);
                }}
                className="block min-h-11 w-full border-b border-black/[0.06] px-3.5 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                <span className={unir('block break-words font-medium', n?.bloquea && 'text-tinta/60')}>{p.nombre}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta/60">
                  <span>{p.sku}</span>
                  {p.precio != null && <span className="importe">{pesos(p.precio)}</span>}
                  {p.stock != null && <span className="importe">stock {numero(p.stock, p.porPeso ? 3 : 0)}{p.porPeso ? ' kg' : ''}</span>}
                  {p.porPeso && <Etiqueta tono="info">por kilo</Etiqueta>}
                  {n && <Etiqueta tono={n.bloquea ? 'atencion' : 'neutro'}>{n.texto}</Etiqueta>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** El producto ya elegido, con la ✕ para cambiarlo. */
export function ProductoElegido({ nombre, detalle, onQuitar, etiquetaQuitar }: { nombre: string; detalle?: ReactNode; onQuitar: () => void; etiquetaQuitar: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-crema-claro py-1 pl-3.5 pr-1 text-sm text-tinta">
      <div className="min-w-0 py-1.5">
        <p className="break-words font-medium">{nombre}</p>
        {detalle && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta/60">{detalle}</div>}
      </div>
      <button type="button" onClick={onQuitar} aria-label={etiquetaQuitar} className={BOTON_QUITAR}>
        <IconoCerrar className="size-5" />
      </button>
    </div>
  );
}
