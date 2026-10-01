'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Entrada, Etiqueta, Tarjeta, useConfirmar } from './kit';

// Las 4 listas de venta. Minorista es la base (precio inicial de cada producto).
// Las demás se calculan como un % sobre Minorista (editable), y "regenerar"
// recalcula sus precios. El nombre de cada lista también es editable.

type Lista = {
  id: string; nombre: string; ajustePct: number; esBase: boolean; activa: boolean; productosConPrecio: number;
};

export function ListasVentaWorkspace({ inicial }: { inicial: Lista[] }) {
  const router = useRouter();
  const [listas, setListas] = useState<Lista[]>(inicial);
  const [edit, setEdit] = useState<Record<string, { nombre: string; ajustePct: number }>>({});
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const { confirmar, dialogo } = useConfirmar();

  const campo = (id: string, base: Lista, k: 'nombre' | 'ajustePct', v: any) =>
    setEdit((e) => ({ ...e, [id]: { nombre: e[id]?.nombre ?? base.nombre, ajustePct: e[id]?.ajustePct ?? base.ajustePct, [k]: v } }));
  const valor = (l: Lista, k: 'nombre' | 'ajustePct') => (edit[l.id]?.[k] ?? l[k]) as any;

  async function recargar() {
    const r = await fetch('/api/listas-venta', { cache: 'no-store' });
    if (r.ok) setListas(await r.json());
    setEdit({});
    router.refresh();
  }

  async function guardar(l: Lista) {
    setOcupado(l.id);
    try {
      const r = await fetch('/api/listas-venta', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: l.id, nombre: valor(l, 'nombre'), ajustePct: Number(valor(l, 'ajustePct')) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo guardar');
      setEstado({ tipo: 'ok', texto: 'Lista actualizada' });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
    setOcupado(null);
  }

  async function regenerar(l: Lista) {
    const ok = await confirmar({
      titulo: `¿Regenerar los precios de "${l.nombre}" desde Minorista ${l.ajustePct >= 0 ? '+' : ''}${l.ajustePct}%?`,
      texto: 'Reemplaza los precios actuales de esta lista.',
      textoConfirmar: 'Regenerar precios',
    });
    if (!ok) return;
    setOcupado(l.id);
    try {
      const r = await fetch('/api/listas-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: l.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo regenerar');
      setEstado({ tipo: 'ok', texto: `${d.generados} precios generados en "${l.nombre}"` });
      await recargar();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error' });
    }
    setOcupado(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta/70">Minorista es el precio base de cada producto. Las otras listas se calculan como un % sobre Minorista — editá el nombre y el %, y regenerá sus precios.</p>

      {estado && <Aviso tono={estado.tipo === 'ok' ? 'ok' : 'error'}>{estado.texto}</Aviso>}

      <div className="space-y-3">
        {listas.map((l) => (
          <Tarjeta key={l.id}>
            <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Entrada
                value={valor(l, 'nombre')}
                onChange={(e) => campo(l.id, l, 'nombre', e.target.value)}
                aria-label="Nombre de la lista"
                className="font-medium"
              />
              {l.esBase ? (
                <Etiqueta className="justify-self-start">Precio base</Etiqueta>
              ) : (
                <label className="flex items-center gap-2 text-sm text-tinta/70">
                  Minorista
                  <span className="w-28">
                    <Entrada
                      type="number"
                      value={valor(l, 'ajustePct')}
                      onChange={(e) => campo(l.id, l, 'ajustePct', e.target.value)}
                      sufijo="%"
                      className="text-right"
                    />
                  </span>
                </label>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
              <span className="text-xs text-tinta/60">{l.productosConPrecio.toLocaleString('es-AR')} productos con precio</span>
              <div className="flex flex-wrap items-center gap-2">
                <Boton variante="secundario" tamano="chico" onClick={() => guardar(l)} disabled={ocupado === l.id}>Guardar</Boton>
                {!l.esBase && (
                  <Boton tamano="chico" onClick={() => regenerar(l)} disabled={ocupado === l.id}>
                    {ocupado === l.id ? 'Generando…' : 'Regenerar precios'}
                  </Boton>
                )}
              </div>
            </div>
          </Tarjeta>
        ))}
      </div>

      <p className="text-xs text-tinta/60">
        Al regenerar, cada producto toma su precio Minorista actual y se le aplica el %. Si después cambiás precios Minorista, volvé a regenerar para actualizarlas.
      </p>

      {dialogo}
    </div>
  );
}
