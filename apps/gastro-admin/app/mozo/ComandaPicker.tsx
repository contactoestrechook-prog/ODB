"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Item = { id: string; nombre: string; precio: number; activo: boolean; categoria: { nombre: string } | null };

export function ComandaPicker({ mesaNumero, onCerrar, onConfirmar }: {
  mesaNumero: number;
  onCerrar: () => void;
  onConfirmar: (items: { itemId: string; cantidad: number }[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api("/admin/carta/items").then((it: Item[]) => {
      setItems(it.filter((i) => i.activo));
      setCargando(false);
    });
  }, []);

  function sumar(id: string, delta: number) {
    setCantidades((c) => {
      const actual = (c[id] ?? 0) + delta;
      if (actual <= 0) {
        const { [id]: _quitar, ...resto } = c;
        return resto;
      }
      return { ...c, [id]: actual };
    });
  }

  const total = Object.values(cantidades).reduce((s, n) => s + n, 0);
  const porCategoria = items.reduce<Record<string, Item[]>>((acc, it) => {
    const cat = it.categoria?.nombre ?? "Otros";
    (acc[cat] ??= []).push(it);
    return acc;
  }, {});

  async function confirmar() {
    setEnviando(true);
    try {
      await onConfirmar(Object.entries(cantidades).map(([itemId, cantidad]) => ({ itemId, cantidad })));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-line">
        <h2 className="font-bold text-sm">Comanda · Mesa {mesaNumero}</h2>
        <button onClick={onCerrar} className="text-faint text-xs font-semibold">Cancelar</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {cargando && <p className="text-faint text-sm">Cargando carta…</p>}
        {Object.entries(porCategoria).map(([cat, its]) => (
          <div key={cat} className="mb-5">
            <h3 className="text-[10px] tracking-[0.1em] uppercase text-accent font-bold mb-2">{cat}</h3>
            <div className="flex flex-col gap-2">
              {its.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-2.5">
                  <span className="text-sm font-medium flex-1">{it.nombre}</span>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => sumar(it.id, -1)}
                      disabled={!cantidades[it.id]}
                      className="w-8 h-8 rounded-lg bg-card-2 font-bold disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-mono font-bold tabular-nums">{cantidades[it.id] ?? 0}</span>
                    <button onClick={() => sumar(it.id, 1)} className="w-8 h-8 rounded-lg bg-card-2 font-bold">
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-line">
        <button
          onClick={confirmar}
          disabled={total === 0 || enviando}
          className="w-full py-4 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm disabled:opacity-50"
        >
          {enviando ? "Enviando…" : total > 0 ? `Confirmar comanda (${total})` : "Elegí al menos un plato"}
        </button>
      </div>
    </div>
  );
}
