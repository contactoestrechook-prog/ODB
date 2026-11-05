'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Entrada, Etiqueta, Modal } from './kit';
import { pesos } from '../lib/formato';

// PARECIDOS (Leandro, 4/11/2026): «cuando no tengo stock en puré de tomate La
// Campagnola, hacer un clic y que me abra una pantalla con todos los purés de
// tomate, cuánto hay de cada uno, y que pueda volver atrás sin que se pierda
// nada y seguir con la compra». Lo mismo con el tamaño: «no tengo azúcar por
// 500 gramos, pero por ahí tengo por un kilo».
//
// Se abre encima del pedido (que además ya se guarda solo): al volver, todo
// sigue como estaba.

export type Parecido = {
  sku: string; nombre: string; costo: number | null; tamano: string | null;
  relacion: 'otro_tamano' | 'parecido' | 'familia';
  stock: { sucursalId: string; cantidad: number }[]; stockTotal: number;
  proveedores: string[]; enEsteProveedor: boolean;
};
type Respuesta = {
  base: { sku: string; nombre: string; tamano: string | null; stock: { sucursalId: string; cantidad: number }[]; stockTotal: number };
  familia: string;
  items: Parecido[];
  sucursales: { id: string; nombre: string }[];
};

const GRUPOS: { relacion: Parecido['relacion']; titulo: string }[] = [
  { relacion: 'otro_tamano', titulo: 'El mismo, en otro tamaño o envase' },
  { relacion: 'parecido', titulo: 'Parecidos: misma marca o misma variedad' },
  { relacion: 'familia', titulo: 'De la misma familia, otras marcas' },
];
const cantidad = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
// "Suc Sant Thomas" → "Sant Thomas"
const corto = (nombre: string) => nombre.replace(/^suc(ursal)?\.?\s+/i, '');

export function ParecidosProducto({ sku, nombre, proveedorId, proveedorNombre, cantidades, onSumar, onCerrar }: {
  sku: string;
  nombre: string;
  proveedorId: string;
  proveedorNombre: string;
  /** lo que ya está puesto en el pedido, por SKU */
  cantidades: Record<string, number>;
  /** suma uno al pedido (solo se ofrece en lo que vende este mismo proveedor) */
  onSumar: (p: Parecido) => void;
  onCerrar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ recurso: 'parecidos', sku, proveedorId });
        if (busca.trim()) p.set('q', busca.trim());
        const r = await fetch(`/api/compras?${p.toString()}`, { cache: 'no-store' });
        const d = await r.json();
        if (!vigente) return;
        if (!r.ok) { setError(d?.message ?? 'No pude traer los parecidos'); return; }
        setDatos(d);
      } catch {
        if (vigente) setError('No pude traer los parecidos. Revisá la conexión.');
      } finally {
        if (vigente) setCargando(false);
      }
    }, busca ? 350 : 0);
    return () => { vigente = false; clearTimeout(t); };
  }, [sku, proveedorId, busca]);

  const sucursales = datos?.sucursales ?? [];
  const stockDe = (stock: { sucursalId: string; cantidad: number }[], id: string) => stock.find((s) => s.sucursalId === id)?.cantidad ?? 0;
  const conStock = (datos?.items ?? []).filter((p) => p.stockTotal > 0);

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="ancho"
      titulo="¿Qué tengo parecido?"
      descripcion={<>Lo mismo que <b>{nombre}</b> en otra marca o en otro tamaño, con lo que hay en cada sucursal. Tu pedido queda como está.</>}
      pie={<Boton onClick={onCerrar}>Volver al pedido</Boton>}
    >
      <div className="space-y-4">
        {/* lo que hay de ESTE producto, para comparar */}
        {datos && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-crema-claro px-3 py-2 text-sm text-tinta">
            <span className="font-semibold">De este{datos.base.tamano ? ` (${datos.base.tamano})` : ''} tenés:</span>
            {sucursales.map((s) => (
              <span key={s.id}>{corto(s.nombre)} <b className="importe">{cantidad(stockDe(datos.base.stock, s.id))}</b></span>
            ))}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-tinta/70">Buscar otra cosa en el catálogo</span>
          <Entrada aria-label="Buscar otra cosa en el catálogo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>

        {error && <Aviso tono="error">{error}</Aviso>}
        {cargando && <Cargando />}

        {!cargando && datos && (
          <>
            <p className="text-sm text-tinta">
              {datos.items.length === 0
                ? 'No encontré nada parecido en el catálogo. Probá buscando con otra palabra.'
                : conStock.length === 0
                  ? `Hay ${datos.items.length} parecido${datos.items.length === 1 ? '' : 's'} en el catálogo, pero ninguno tiene stock.`
                  : <><b>{conStock.length}</b> de {datos.items.length} parecido{datos.items.length === 1 ? '' : 's'} {conStock.length === 1 ? 'tiene' : 'tienen'} stock.</>}
            </p>

            {GRUPOS.map(({ relacion, titulo }) => {
              const grupo = datos.items.filter((p) => p.relacion === relacion);
              if (!grupo.length) return null;
              return (
                <section key={relacion} className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-tinta/60">{busca.trim() ? 'Resultados' : titulo}</h3>
                  <div className="divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
                    {grupo.map((p) => {
                      const puesto = cantidades[p.sku] ?? 0;
                      return (
                        <div key={p.sku} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold leading-snug text-tinta">{p.nombre}</p>
                            <p className="break-words text-xs text-tinta/60">
                              {p.tamano ? `${p.tamano} · ` : ''}{p.sku}
                              {p.costo != null && p.costo > 0 ? ` · ${pesos(p.costo)}` : ''}
                              {p.proveedores.length ? ` · lo vende ${p.proveedores.slice(0, 3).join(', ')}` : ' · sin proveedor cargado'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {p.stockTotal > 0
                              ? sucursales.map((s) => (
                                <Etiqueta key={s.id} tono={stockDe(p.stock, s.id) > 0 ? 'ok' : 'neutro'}>
                                  {corto(s.nombre)} <span className="importe">{cantidad(stockDe(p.stock, s.id))}</span>
                                </Etiqueta>
                              ))
                              : <Etiqueta tono="error">sin stock</Etiqueta>}
                            {p.enEsteProveedor && (
                              <Boton tamano="chico" variante="secundario" onClick={() => onSumar(p)}
                                aria-label={`Sumar ${p.nombre} al pedido a ${proveedorNombre}`}>
                                {puesto ? `En el pedido: ${puesto} · sumar` : 'Sumar al pedido'}
                              </Boton>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}
