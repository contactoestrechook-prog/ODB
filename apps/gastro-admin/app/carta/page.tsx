"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Categoria = { id: string; nombre: string; orden: number };
type Item = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  activo: boolean;
  categoria_id: string;
  categoria: { nombre: string } | null;
  tiempo_coccion_min: number | null;
};

export default function CartaAdminPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevaCat, setNuevaCat] = useState("");
  const [nuevoItem, setNuevoItem] = useState({ categoriaId: "", nombre: "", descripcion: "", precio: "" });

  async function cargar() {
    setCargando(true);
    const [cats, its] = await Promise.all([api("/admin/carta/categorias"), api("/admin/carta/items")]);
    setCategorias(cats);
    setItems(its);
    if (!nuevoItem.categoriaId && cats[0]) setNuevoItem((n) => ({ ...n, categoriaId: cats[0].id }));
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  async function crearCategoria() {
    if (!nuevaCat.trim()) return;
    await api("/admin/carta/categorias", { method: "POST", body: JSON.stringify({ nombre: nuevaCat, orden: categorias.length }) });
    setNuevaCat("");
    cargar();
  }

  async function crearItem() {
    if (!nuevoItem.nombre || !nuevoItem.precio || !nuevoItem.categoriaId) return;
    await api("/admin/carta/items", {
      method: "POST",
      body: JSON.stringify({
        categoriaId: nuevoItem.categoriaId,
        nombre: nuevoItem.nombre,
        descripcion: nuevoItem.descripcion || undefined,
        precio: Number(nuevoItem.precio),
      }),
    });
    setNuevoItem({ ...nuevoItem, nombre: "", descripcion: "", precio: "" });
    cargar();
  }

  async function toggleActivo(item: Item) {
    await api(`/admin/carta/items/${item.id}`, { method: "PUT", body: JSON.stringify({ activo: !item.activo }) });
    cargar();
  }

  async function eliminar(id: string) {
    await api(`/admin/carta/items/${id}`, { method: "DELETE" });
    cargar();
  }

  // Tiempo de cocción: alimenta la alarma del tablero de cocina. Se edita acá
  // porque el default que carga el sistema es una estimación, no un dato real.
  async function guardarCoccion(item: Item, valor: string) {
    const tiempoCoccionMin = valor === "" ? null : Number(valor);
    if (tiempoCoccionMin === item.tiempo_coccion_min) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, tiempo_coccion_min: tiempoCoccionMin } : i)));
    await api(`/admin/carta/items/${item.id}`, { method: "PUT", body: JSON.stringify({ tiempoCoccionMin }) });
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="display text-xl font-bold mb-3">Categorías</h1>
        <div className="flex gap-2 flex-wrap mb-3">
          {categorias.map((c) => (
            <span key={c.id} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-card-2">{c.nombre}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={nuevaCat}
            onChange={(e) => setNuevaCat(e.target.value)}
            placeholder="Nueva categoría (ej: Tragos)"
            className="flex-1 rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <button onClick={crearCategoria} className="text-xs font-semibold px-3 rounded-lg border border-line">Agregar</button>
        </div>
      </div>

      <div>
        <h2 className="display text-lg font-bold mb-3">Nuevo plato</h2>
        <div className="rounded-xl border border-line bg-card p-4 flex flex-col gap-2">
          <select
            value={nuevoItem.categoriaId}
            onChange={(e) => setNuevoItem({ ...nuevoItem, categoriaId: e.target.value })}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          >
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input
            placeholder="Nombre (ej: Picaña)"
            value={nuevoItem.nombre}
            onChange={(e) => setNuevoItem({ ...nuevoItem, nombre: e.target.value })}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <input
            placeholder="Descripción (opcional)"
            value={nuevoItem.descripcion}
            onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <input
            placeholder="Precio"
            type="number"
            value={nuevoItem.precio}
            onChange={(e) => setNuevoItem({ ...nuevoItem, precio: e.target.value })}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <button onClick={crearItem} className="text-sm font-semibold py-2 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206]">
            Agregar a la carta
          </button>
        </div>
      </div>

      <div>
        <h2 className="display text-lg font-bold mb-3">Ítems de la carta</h2>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className={`rounded-xl border border-line bg-card p-3 flex justify-between items-center gap-3 ${!item.activo ? "opacity-50" : ""}`}>
              <div>
                <p className="font-semibold text-sm">{item.nombre} <span className="text-faint text-xs">· {item.categoria?.nombre}</span></p>
                <p className="text-dim text-xs font-mono tabular-nums">${item.precio}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="flex items-center gap-1 text-[10.5px] text-faint">
                  🔥
                  <input
                    type="number"
                    defaultValue={item.tiempo_coccion_min ?? ""}
                    placeholder="—"
                    onBlur={(e) => guardarCoccion(item, e.target.value)}
                    className="w-11 rounded-md border border-line bg-card-2 px-1.5 py-1 text-xs font-mono text-center"
                    title="Minutos de cocción (alarma en /cocina)"
                  />
                  min
                </label>
                <button onClick={() => toggleActivo(item)} className="text-xs px-2 py-1 rounded-lg border border-line">
                  {item.activo ? "Ocultar" : "Mostrar"}
                </button>
                <button onClick={() => eliminar(item.id)} className="text-xs px-2 py-1 rounded-lg border border-line text-loss">
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
