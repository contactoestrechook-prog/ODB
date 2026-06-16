"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Producto } from "./tipos";

export type Renglon = Producto & { cantidad: number };

type Ctx = {
  items: Renglon[];
  agregar: (p: Producto, n?: number) => void;
  quitar: (sku: string) => void;
  setCantidad: (sku: string, n: number) => void;
  vaciar: () => void;
  total: number;
  unidades: number;
  listo: boolean;
};

const CarritoCtx = createContext<Ctx>(null as any);

export function CarritoProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Renglon[]>([]);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    try {
      const r = localStorage.getItem("odb_carrito");
      if (r) setItems(JSON.parse(r));
    } catch {}
    setListo(true);
  }, []);

  useEffect(() => {
    if (listo) try { localStorage.setItem("odb_carrito", JSON.stringify(items)); } catch {}
  }, [items, listo]);

  const agregar = (p: Producto, n = 1) =>
    setItems((c) => {
      const ex = c.find((r) => r.sku === p.sku);
      if (ex) return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + n } : r));
      return [...c, { ...p, cantidad: n }];
    });
  const quitar = (sku: string) => setItems((c) => c.filter((r) => r.sku !== sku));
  const setCantidad = (sku: string, n: number) =>
    setItems((c) => c.map((r) => (r.sku === sku ? { ...r, cantidad: Math.max(1, n) } : r)).filter((r) => r.cantidad > 0));
  const vaciar = () => setItems([]);

  const total = items.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0);
  const unidades = items.reduce((s, r) => s + r.cantidad, 0);

  return (
    <CarritoCtx.Provider value={{ items, agregar, quitar, setCantidad, vaciar, total, unidades, listo }}>
      {children}
    </CarritoCtx.Provider>
  );
}

export const useCarrito = () => useContext(CarritoCtx);
