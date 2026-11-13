"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { pesos } from "../lib/formato";
import { Boton, Cargando, Marca } from "../ui";

type Item = { id: string; nombre: string; precio: number; activo: boolean; agotado: boolean; categoria: { nombre: string } | null };

// Elegir platos tocando: sirve para la primera comanda y para sumar después
// (otra bebida, el postre). No se escribe nada, salvo el buscador.
export function ComandaPicker({ mesaNumero, sumando = false, onCerrar, onConfirmar }: {
  mesaNumero: number;
  sumando?: boolean;
  onCerrar: () => void;
  onConfirmar: (items: { itemId: string; cantidad: number }[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");

  useEffect(() => {
    api("/admin/carta/items")
      .then((it: Item[]) => setItems(it.filter((i) => i.activo)))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
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

  const unidades = Object.values(cantidades).reduce((s, n) => s + n, 0);
  const importe = items.reduce((s, it) => s + (cantidades[it.id] ?? 0) * Number(it.precio), 0);
  const buscado = texto.trim().toLowerCase();
  const visibles = buscado ? items.filter((i) => i.nombre.toLowerCase().includes(buscado)) : items;
  const porCategoria = visibles.reduce<Record<string, Item[]>>((acc, it) => {
    const cat = it.categoria?.nombre ?? "Otros";
    (acc[cat] ??= []).push(it);
    return acc;
  }, {});

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(Object.entries(cantidades).map(([itemId, cantidad]) => ({ itemId, cantidad })));
    } catch (e: any) {
      setError(e?.message || "No se pudo mandar la comanda");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col" role="dialog">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <Boton onClick={onCerrar} tamano="chico">← Volver</Boton>
        <h2 className="display font-bold text-[14px] flex-1 truncate">
          {sumando ? "Sumar a la comanda" : "Tomar la comanda"} · Mesa {mesaNumero}
        </h2>
      </div>
      <div className="px-3 py-2 border-b border-line">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar un plato" aria-label="Buscar un plato" className="campo" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {cargando && <Cargando />}
        {Object.entries(porCategoria).map(([cat, its]) => (
          <div key={cat} className="mb-4">
            <h3 className="text-[10.5px] tracking-[0.1em] uppercase text-salon font-bold mb-1.5">{cat}</h3>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {its.map((it) => {
                const n = cantidades[it.id] ?? 0;
                return (
                  <div key={it.id} className={`flex items-center gap-2 rounded-lg border bg-card pl-3 pr-1.5 py-1.5 ${n ? "border-salon" : "border-line"} ${it.agotado ? "opacity-55" : ""}`}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium truncate">{it.nombre}</span>
                      <span className="block num text-[11.5px] text-faint">{pesos(Number(it.precio))}</span>
                    </span>
                    {it.agotado ? (
                      <Marca tono="mal">Agotado</Marca>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <button onClick={() => sumar(it.id, -1)} disabled={!n} aria-label={`Sacar un ${it.nombre}`} className="w-9 h-9 rounded-md bg-card-2 font-bold text-lg disabled:opacity-30">−</button>
                        <span className="w-5 text-center num font-bold">{n}</span>
                        <button onClick={() => sumar(it.id, 1)} aria-label={`Sumar un ${it.nombre}`} className="w-9 h-9 rounded-md bg-card-2 font-bold text-lg">+</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2.5 border-t border-line bg-card">
        {error && <p className="text-loss text-[12.5px] mb-2">■ {error}</p>}
        <Boton variante="principal" tamano="grande" className="w-full" onClick={confirmar} disabled={unidades === 0 || enviando}>
          {enviando ? "◔ Mandando a cocina…" : unidades > 0 ? `Mandar a cocina · ${unidades} ${unidades === 1 ? "plato" : "platos"} · ${pesos(importe)}` : "Elegí al menos un plato"}
        </Boton>
      </div>
    </div>
  );
}
