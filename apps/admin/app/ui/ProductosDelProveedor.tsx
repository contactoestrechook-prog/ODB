'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Aviso, Boton, Cargando, Chips, Entrada, FOCO, Tarjeta, TarjetaCabecera, unir } from './kit';
import { pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';
import { CambiarProveedor } from './CambiarProveedor';

// LA LISTA DE PRODUCTOS DEL PROVEEDOR, EN SU FICHA (18/11/2026). Leandro:
// «tenemos que poder cambiar un producto de proveedor desde cualquier lado».
// Cada producto que trabaja este proveedor, con el proveedor de hoy (el que usan
// Qué comprar y los pedidos) y el cambio en dos toques. Los que ya se le compran
// a otro quedan en ámbar y se pueden ver aparte.

type Fila = {
  productoId: string; sku: string; nombre: string; codigoProveedor: string | null; ultimoCosto: number | null;
  proveedor: { id: string; razonSocial: string; decidido: boolean } | null;
};

const DE_A = 30;

export function ProductosDelProveedor({ id, nombre }: { id: string; nombre: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [vista, setVista] = useState<'todos' | 'otro'>('todos');
  const [cuantos, setCuantos] = useState(DE_A);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/proveedor-producto?de=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(j)) throw new Error(j?.message ?? 'No pude traer los productos');
        if (vivo) setFilas(j);
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No pude traer los productos'); });
    return () => { vivo = false; };
  }, [id]);

  const deOtro = useMemo(() => (filas ?? []).filter((f) => f.proveedor && f.proveedor.id !== id), [filas, id]);
  const vistos = useMemo(() => {
    const base = vista === 'otro' ? deOtro : filas ?? [];
    return q.trim() ? filtrarPorBusqueda(base, q, (f) => `${f.nombre} ${f.sku} ${f.codigoProveedor ?? ''}`) : base;
  }, [vista, deOtro, filas, q]);

  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera
        titulo="Productos"
        sub={filas
          ? `${filas.length} producto${filas.length === 1 ? '' : 's'} en su lista${deOtro.length ? ` · ${deOtro.length} ya se le compra${deOtro.length === 1 ? '' : 'n'} a otro` : ''}. Para pasar uno a otro proveedor, tocá «cambiar».`
          : 'Lo que trabaja y a quién se le compra hoy cada producto.'}
      />
      <div className="space-y-3 px-4 pb-2 sm:px-5">
        {error && <Aviso tono="error">{error}</Aviso>}
        {filas && filas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Entrada aria-label={`Buscar en los productos de ${nombre}`} placeholder="Buscar producto, SKU o código" value={q}
              onChange={(e) => { setQ(e.target.value); setCuantos(DE_A); }} className="min-w-0 flex-1 basis-56" />
            {deOtro.length > 0 && (
              <Chips
                etiquetaAccesible="Qué productos ver"
                valor={vista}
                onCambiar={(v) => { setVista(v); setCuantos(DE_A); }}
                opciones={[
                  { valor: 'todos' as const, etiqueta: 'Todos', cuenta: filas.length },
                  { valor: 'otro' as const, etiqueta: 'Se le compran a otro', cuenta: deOtro.length },
                ]}
              />
            )}
          </div>
        )}
      </div>
      {!filas && !error && <div className="px-4 py-3 sm:px-5"><Cargando texto="Buscando sus productos…" /></div>}
      {filas && filas.length === 0 && <p className="px-4 py-3 text-sm text-tinta/60 sm:px-5">Todavía no tiene productos en su lista.</p>}
      {filas && filas.length > 0 && vistos.length === 0 && <p className="px-4 py-3 text-sm text-tinta/60 sm:px-5">Ningún producto coincide.</p>}
      <ul className="divide-y divide-black/[0.06]">
        {vistos.slice(0, cuantos).map((f) => (
          <li key={f.productoId} className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
            <div className="min-w-0">
              <Link href={`/productos/${encodeURIComponent(f.sku)}`} className={unir('rounded-sm break-words text-sm font-medium text-tinta hover:text-marca hover:underline', FOCO)}>
                {f.nombre}
              </Link>
              <p className="break-words text-xs text-tinta/60">{[f.sku, f.codigoProveedor && `cód. ${f.codigoProveedor}`].filter(Boolean).join(' · ')}</p>
              <CambiarProveedor
                producto={{ id: f.productoId, sku: f.sku, nombre: f.nombre }}
                actual={f.proveedor}
                esperado={id}
                pantalla="ficha-proveedor"
                className="mt-0.5"
                onCambio={(c) => setFilas((xs) => (xs ?? []).map((x) => (x.productoId === f.productoId ? { ...x, proveedor: { ...c.ahora, decidido: true } } : x)))}
              />
            </div>
            <span className="importe shrink-0 text-sm font-semibold text-tinta">{f.ultimoCosto != null ? pesos(f.ultimoCosto) : '—'}</span>
          </li>
        ))}
      </ul>
      {vistos.length > cuantos && (
        <div className="px-4 py-3 sm:px-5">
          <Boton variante="secundario" anchoCompleto onClick={() => setCuantos((n) => n + DE_A * 3)}>
            Ver {Math.min(vistos.length - cuantos, DE_A * 3)} más (quedan {vistos.length - cuantos})
          </Boton>
        </div>
      )}
    </Tarjeta>
  );
}
