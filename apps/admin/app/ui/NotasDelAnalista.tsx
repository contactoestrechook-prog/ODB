'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { NotaDePedido, type Armada, type Propuesta } from './NotaDePedido';
import { comentarioDe, type ComentarioProveedor } from './PlacaProveedores';
import { Aviso, Boton, Chips, FOCO, Vacio, unir } from './kit';
import { numero } from '../lib/formato';

// Las notas de pedido de «Qué comprar», dentro de la respuesta del Analista
// ODB (2/10/2026). Reemplazan a la placa «Orden de compra propuesta» del chat,
// que armaba órdenes por /api/oc con otras reglas: ahora hay un solo camino
// para pedir, el de la nota (POST /api/abastecimiento?que=orden).
//
// Las notas no viajan en la respuesta del chat (son más de 700 renglones con
// fotos): se piden al mismo endpoint de Qué comprar, por sucursal. El analista
// solo dice con qué sucursal arrancar y qué proveedores van primero.

export type NotasAnalista = { sucursal: string; proveedorIds: string[] };

export const SUCURSALES_NOTAS = ['Saint Thomas', 'Santa Inés'];
// Tres notas y el resto detrás de un botón: en el chat cada nota es larga, y
// con todas abiertas el gráfico de arriba queda a kilómetros.
const VISIBLES = 3;

type OrdenArmada = Armada & { proveedor: string; sucursal: string; sucursalId: string };

export function NotasDelAnalista({
  notas,
  sucursal: pedida,
  onSucursal,
  buscado,
  onBuscado,
  yaPedidos,
  onArmada,
  comentarios,
  onPreguntar,
  desplazarA,
}: {
  notas: NotasAnalista | null;
  /** La sucursal la maneja la respuesta: tocar un proveedor en la placa COMPRAS puede cambiarla. */
  sucursal: string;
  onSucursal: (s: string) => void;
  /** Proveedor al que hay que bajar (se tocó en la placa COMPRAS). */
  buscado?: string | null;
  onBuscado?: () => void;
  /** Productos ya pedidos desde cualquier nota del chat ("sucursalId:sku"). */
  yaPedidos: Set<string>;
  onArmada: (o: OrdenArmada) => void;
  /** Las líneas del analista; solo cuando no se dibujó la placa COMPRAS (si no, ya están ahí). */
  comentarios?: ComentarioProveedor[];
  /** Para el aviso de lo que no tiene proveedor, cuando no lo dice la placa COMPRAS. */
  onPreguntar?: (texto: string) => void;
  /** Cómo bajar hasta una nota sin mover la página entera (el chat tiene scroll propio). */
  desplazarA?: (el: HTMLElement) => void;
}) {
  const sucursal = SUCURSALES_NOTAS.includes(pedida) ? pedida : SUCURSALES_NOTAS[0];
  // con la sucursal de la que vino: al cambiarla, la lista vieja todavía está
  // un render y no hay que bajar a una nota que está por desaparecer
  const [lista, setLista] = useState<{ sucursal: string; propuestas: Propuesta[]; sinProveedor: number } | null>(null);
  const [error, setError] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [recargar, setRecargar] = useState(0);
  const cajaRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // si se cambia de sucursal antes de que llegue la respuesta, la vieja se
    // descarta (la misma guarda de Qué comprar)
    let vigente = true;
    setLista(null);
    setError('');
    setVerTodas(false);
    fetch(`/api/abastecimiento?que=propuestas&sucursal=${encodeURIComponent(sucursal)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.message ?? 'No pude traer las notas de pedido');
        if (vigente) setLista({ sucursal, propuestas: Array.isArray(j.propuestas) ? j.propuestas : [], sinProveedor: Number(j.sinProveedor) || 0 });
      })
      .catch((e) => { if (vigente) setError(e instanceof Error ? e.message : 'No pude traer las notas de pedido'); });
    return () => { vigente = false; };
  }, [sucursal, recargar]);

  // Primero los proveedores que nombró el analista, en su orden; después el
  // resto como viene (más urgencias primero, como en Qué comprar).
  const ordenadas = useMemo(() => {
    if (!lista) return [];
    const primero = new Map((notas?.proveedorIds ?? []).map((id, i) => [id, i]));
    return lista.propuestas
      .map((p, i) => ({ p, i, orden: primero.get(p.proveedorId) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.orden - b.orden || a.i - b.i)
      .map((x) => x.p);
  }, [lista, notas]);
  const visibles = verTodas ? ordenadas : ordenadas.slice(0, VISIBLES);
  const restantes = ordenadas.length - visibles.length;

  // Bajar a la nota del proveedor que se tocó en la placa: si está entre las
  // escondidas se abren todas primero, y se baja en la vuelta siguiente.
  useEffect(() => {
    if (!buscado || !lista || lista.sucursal !== sucursal) return;
    const i = ordenadas.findIndex((p) => p.proveedorId === buscado);
    if (i >= VISIBLES && !verTodas) {
      setVerTodas(true);
      return;
    }
    const el = i >= 0 ? cajaRef.current?.querySelector<HTMLElement>(`[data-proveedor="${CSS.escape(buscado)}"]`) : null;
    if (el) {
      if (desplazarA) desplazarA(el);
      else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    onBuscado?.();
  }, [buscado, lista, sucursal, ordenadas, verTodas, desplazarA, onBuscado]);

  return (
    <section ref={cajaRef} aria-label="Notas de pedido" className="w-full min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-tinta">Notas de pedido</p>
          <p className="text-xs text-tinta/60">Las mismas de Qué comprar: tildá, corregí y armá el pedido.</p>
        </div>
        <Chips etiquetaAccesible="Sucursal de las notas" valor={sucursal} onCambiar={onSucursal} opciones={SUCURSALES_NOTAS.map((s) => ({ valor: s, etiqueta: s }))} />
      </div>

      {error && (
        <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={() => setRecargar((x) => x + 1)}>Reintentar</Boton>}>
          {error}
        </Aviso>
      )}

      {/* mientras carga, la silueta de la placa: franja roja y renglones blancos */}
      {!lista && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando las notas de pedido">
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl bg-crema shadow-tarjeta">
              <div className="h-[72px] bg-marca" />
              <div className="space-y-2.5 p-3 sm:p-5">
                {[0, 1, 2].map((j) => <div key={j} className="h-14 rounded-2xl border border-crema-hondo bg-white motion-safe:animate-pulse" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {lista && lista.propuestas.length === 0 && (
        <Vacio
          titulo={`No hay nada para reponer en ${sucursal} con proveedor habitual.`}
          texto="Probá con la otra sucursal, o preguntale al analista por lo que no tiene proveedor."
        />
      )}

      {visibles.map((p) => {
        const c = comentarios ? comentarioDe(comentarios, p.proveedorId) : undefined;
        return (
          <div key={`${sucursal}:${p.clave}`} data-proveedor={p.proveedorId} className="min-w-0 space-y-1.5">
            {c?.comentario?.trim() && (
              <p className="px-1 text-sm leading-snug text-tinta/70">
                <span className="font-semibold text-tinta">{p.proveedor}:</span> <span className="italic">{c.comentario.trim()}</span>
              </p>
            )}
            <NotaDePedido propuesta={p} yaPedidos={yaPedidos} onArmada={onArmada} />
          </div>
        );
      })}

      {restantes > 0 && (
        <Boton variante="secundario" anchoCompleto onClick={() => setVerTodas(true)}>
          Ver {restantes} nota{restantes === 1 ? '' : 's'} más
        </Boton>
      )}

      {lista && lista.sinProveedor > 0 && onPreguntar && (
        <p className="px-1 text-sm leading-snug text-tinta/70">
          Hay {numero(lista.sinProveedor)} productos urgentes sin proveedor habitual en {sucursal}: no entran en ninguna nota.{' '}
          <button
            type="button"
            onClick={() => onPreguntar(`¿A quién le compro lo urgente que no tiene proveedor habitual en ${sucursal}?`)}
            className={unir('rounded-sm font-semibold text-marca-hondo underline underline-offset-2', FOCO)}
          >
            ¿A quién se los compro?
          </button>
        </p>
      )}
    </section>
  );
}
