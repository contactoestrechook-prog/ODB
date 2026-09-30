"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type ItemCompra = { id: string; descripcion: string; cantidad: number | null; precio_unitario: number | null; total: number | null };
type Compra = {
  id: string;
  numero_comprobante: string | null;
  fecha: string;
  total: number;
  proveedor: { nombre: string };
  items: ItemCompra[];
};
type Variacion = {
  descripcion: string;
  proveedor: string | null;
  fechaAnterior: string;
  fechaUltima: string;
  precioAnterior: number;
  precioUltimo: number;
  variacionPct: number;
};

const formatoPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function ComprasPage() {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [variaciones, setVariaciones] = useState<Variacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({ descripcion: "", cantidad: "", precioUnitario: "" });
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [c, v] = await Promise.all([api("/admin/proveedores/compras"), api("/admin/proveedores/variaciones")]);
    setCompras(c);
    setVariaciones(v);
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  async function agregarItem(compraId: string) {
    if (!form.descripcion.trim()) return;
    setGuardando(true);
    try {
      const cantidad = form.cantidad ? Number(form.cantidad) : undefined;
      const precioUnitario = form.precioUnitario ? Number(form.precioUnitario) : undefined;
      await api(`/admin/proveedores/compras/${compraId}/items`, {
        method: "POST",
        body: JSON.stringify({
          descripcion: form.descripcion.trim(),
          cantidad,
          precioUnitario,
          total: cantidad && precioUnitario ? Math.round(cantidad * precioUnitario * 100) / 100 : undefined,
        }),
      });
      setForm({ descripcion: "", cantidad: "", precioUnitario: "" });
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function borrarItem(itemId: string) {
    await api(`/admin/proveedores/compras/items/${itemId}`, { method: "DELETE" });
    await cargar();
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  const subas = variaciones.filter((v) => v.variacionPct >= 5);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="display text-xl font-bold mb-1">Compras a proveedores</h1>
        <p className="text-faint text-xs">
          Cargá los insumos principales de cada factura: con dos compras del mismo insumo, el sistema empieza a avisarte quién te subió el precio.
        </p>
      </div>

      {subas.length > 0 && (
        <div className="rounded-xl border border-loss/40 bg-loss/10 p-4">
          <p className="text-[10px] tracking-[0.1em] uppercase text-loss font-bold mb-2">⚠ Te subieron el precio</p>
          <div className="flex flex-col gap-2">
            {subas.map((v, i) => (
              <div key={i} className="flex justify-between items-baseline gap-3 text-sm">
                <span className="min-w-0 truncate">{v.descripcion}</span>
                <span className="font-mono font-bold text-loss whitespace-nowrap tabular-nums">
                  ▲ {v.variacionPct}% <span className="text-dim font-normal">({formatoPesos.format(v.precioAnterior)} → {formatoPesos.format(v.precioUltimo)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {variaciones.length > 0 && subas.length === 0 && (
        <div className="rounded-xl border border-good/40 bg-good/10 p-3.5">
          <p className="text-sm text-good font-semibold">✓ Ningún insumo con suba significativa entre las últimas compras.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {compras.map((c) => (
          <div key={c.id} className="rounded-xl border border-line bg-card p-4">
            <div className="flex justify-between items-start gap-3 mb-1">
              <div>
                <p className="font-semibold text-sm">{c.proveedor?.nombre}</p>
                <p className="text-faint text-xs mt-0.5">
                  {new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR")}
                  {c.numero_comprobante ? ` · comp. ${c.numero_comprobante}` : ""}
                </p>
              </div>
              <p className="font-mono font-bold text-sm tabular-nums whitespace-nowrap">{formatoPesos.format(Number(c.total))}</p>
            </div>

            {c.items.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
                {c.items.map((it) => (
                  <div key={it.id} className="flex justify-between items-center gap-2 text-xs text-dim">
                    <span className="min-w-0 truncate">
                      {it.descripcion}
                      {it.cantidad ? ` × ${it.cantidad}` : ""}
                      {it.precio_unitario ? ` @ ${formatoPesos.format(Number(it.precio_unitario))}` : ""}
                    </span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {it.total != null && <span className="font-mono tabular-nums">{formatoPesos.format(Number(it.total))}</span>}
                      <button onClick={() => borrarItem(it.id)} className="text-faint hover:text-loss" title="Borrar ítem">✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {editandoId === c.id ? (
              <div className="mt-3 pt-3 border-t border-line flex flex-col gap-2">
                <input
                  placeholder="Insumo (ej: Picaña kg)"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="rounded-lg border border-line bg-card-2 p-2.5 text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    placeholder="Cant."
                    type="number"
                    value={form.cantidad}
                    onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                    className="w-20 rounded-lg border border-line bg-card-2 p-2.5 text-sm font-mono"
                  />
                  <input
                    placeholder="Precio unitario"
                    type="number"
                    value={form.precioUnitario}
                    onChange={(e) => setForm({ ...form, precioUnitario: e.target.value })}
                    className="flex-1 rounded-lg border border-line bg-card-2 p-2.5 text-sm font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => agregarItem(c.id)}
                    disabled={guardando || !form.descripcion.trim()}
                    className="flex-1 py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-xs disabled:opacity-50"
                  >
                    {guardando ? "Guardando…" : "Agregar insumo"}
                  </button>
                  <button onClick={() => setEditandoId(null)} className="px-3 rounded-lg border border-line text-faint text-xs">
                    Listo
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEditandoId(c.id)} className="mt-3 text-xs font-semibold text-accent">
                + Cargar insumos de esta factura
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
