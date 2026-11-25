'use client';

// ENTREGAR A CUENTA CORRIENTE (25/11/2026). Juan Pablo, por Leandro: «agregar que fue cuenta
// corriente para que lo facture pero lo deje en cuenta del cliente». Al elegir «Cuenta
// corriente» en la ventana de entregar se elige acá de quién es la cuenta: solo las abiertas,
// con lo que debe hoy, el tope y si la factura sale A o B.

import { useEffect, useRef, useState } from 'react';
import { Entrada, FOCO, unir } from './kit';
import { pesos } from '../lib/formato';

export type CuentaElegible = { id: string; nombre: string; debe: number; tope: number; factura: 'A' | 'B' };

export function ElegirCuentaCorriente({ sugerido, elegida, onElegir, total }: {
  /** El nombre del cliente del pedido: se busca primero por ese. */
  sugerido?: string | null;
  elegida: CuentaElegible | null;
  onElegir: (c: CuentaElegible | null) => void;
  total: number;
}) {
  const [q, setQ] = useState(() => String(sugerido ?? '').trim().split(/\s+/).slice(0, 2).join(' '));
  const [lista, setLista] = useState<CuentaElegible[] | null>(null);
  const turno = useRef(0);

  useEffect(() => {
    const mio = ++turno.current;
    const t = setTimeout(() => {
      fetch(`/api/pedidos?cuentas=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        .then(async (r) => { const d = await r.json(); if (mio === turno.current) setLista(r.ok && Array.isArray(d) ? d : []); })
        .catch(() => mio === turno.current && setLista([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-2 rounded-xl border border-black/[0.08] bg-crema-claro p-3">
      <p className="text-sm font-semibold text-tinta">¿A la cuenta de quién?</p>
      <Entrada aria-label="Buscar la cuenta corriente" value={q} onChange={(e) => { setQ(e.target.value); onElegir(null); }} placeholder="Nombre del cliente" autoComplete="off" />
      {lista === null ? (
        <p className="text-xs text-tinta/60">Buscando…</p>
      ) : lista.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {lista.map((c) => {
            const pasa = c.tope > 0 && c.debe + total > c.tope;
            const activa = elegida?.id === c.id;
            return (
              <li key={c.id}>
                <button type="button" disabled={pasa} onClick={() => onElegir(c)} aria-pressed={activa}
                  className={unir('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50', activa ? 'border-tinta bg-white' : 'border-transparent hover:bg-white', FOCO)}>
                  <span className="min-w-0 flex-1 truncate font-semibold text-tinta">{c.nombre}</span>
                  <span className="shrink-0 text-xs text-tinta/60">
                    debe {pesos(c.debe)}{c.tope > 0 ? ` · tope ${pesos(c.tope)}` : ''} · factura {c.factura}
                  </span>
                </button>
                {pasa && <p className="px-3 pb-1 text-xs text-marca">Con este pedido se pasa del tope.</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-tinta/60">No hay una cuenta corriente abierta con ese nombre. Se abre en Cuentas corrientes › Sumar cuenta.</p>
      )}
      {elegida && (
        <p className="text-xs text-tinta/70">
          Se emite la factura {elegida.factura} a nombre de <b className="font-semibold text-tinta">{elegida.nombre}</b> y quedan {pesos(total)} en su cuenta: pasa a deber {pesos(elegida.debe + total)}.
        </p>
      )}
    </div>
  );
}
