"use client";

import { useState } from "react";
import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos } from "../../lib/tipos";
import { IcoLocal, IcoMoto, IcoCheck } from "../ui/Iconos";

export default function Checkout() {
  const { items, total, vaciar, listo } = useCarrito();
  const [tipo, setTipo] = useState<"pickup" | "domicilio">("pickup");
  const [direccion, setDireccion] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<{ pedidoId: string; qr: string | null; pagoUrl: string | null } | null>(null);

  async function confirmar() {
    setError(null);
    if (tipo === "domicilio" && !direccion.trim()) { setError("Ingresá la dirección de entrega."); return; }
    setCargando(true);
    try {
      const body = {
        tipo,
        items: items.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
        destino: tipo === "domicilio" ? { direccion: direccion.trim() } : undefined,
      };
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "No se pudo crear el pedido");
      vaciar();
      if (d.pagoUrl) { window.location.href = d.pagoUrl; return; }
      setOk(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
    setCargando(false);
  }

  if (ok) {
    return (
      <div className="min-h-[70vh] grid place-items-center px-5 text-center">
        <div className="max-w-md">
          <span className="inline-grid place-items-center w-16 h-16 rounded-full bg-ink text-dorado mb-6"><IcoCheck size={28} /></span>
          <h1 className="display text-3xl font-semibold text-ink">¡Pedido recibido!</h1>
          <p className="text-tinta/70 mt-3">Tu pedido <span className="font-mono font-semibold text-ink">{ok.qr ?? ok.pedidoId.slice(0, 8)}</span> quedó registrado. Te avisamos cuando esté listo.</p>
          <p className="text-sm text-humo mt-2">Coordinamos el pago al {tipo === "pickup" ? "retirar" : "recibir"} tu pedido.</p>
          <Link href="/" className="inline-block mt-7 rounded-full bg-ink text-crema font-semibold px-7 py-3.5 hover:bg-vino transition-colors">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (listo && items.length === 0) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-5 text-center">
        <div>
          <h1 className="display text-2xl font-semibold text-ink">No hay nada para finalizar</h1>
          <Link href="/catalogo" className="inline-block mt-5 rounded-full bg-ink text-crema font-semibold px-7 py-3.5">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-5 lg:px-8 py-10">
      <p className="kicker text-dorado">Último paso</p>
      <h1 className="display text-3xl sm:text-4xl font-semibold text-ink mt-1.5 mb-8 tracking-tight">Finalizar compra</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">
        <div className="space-y-8">
          <section>
            <p className="kicker text-dorado mb-4">¿Cómo lo querés recibir?</p>
            <div className="grid grid-cols-2 gap-3">
              {([["pickup", IcoLocal, "Retiro en local", "En O.D.B Central"], ["domicilio", IcoMoto, "Envío a domicilio", "Te lo llevamos"]] as const).map(([k, Ico, t, s]) => (
                <button key={k} onClick={() => setTipo(k)} className={`text-left rounded-xl border p-5 transition-colors ${tipo === k ? "border-dorado bg-dorado/5" : "border-linea hover:border-dorado/50"}`}>
                  <Ico size={22} className={tipo === k ? "text-rojo" : "text-tinta/60"} />
                  <p className="font-semibold text-ink mt-3">{t}</p>
                  <p className="text-xs text-humo mt-0.5">{s}</p>
                </button>
              ))}
            </div>
            {tipo === "domicilio" && (
              <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección de entrega (calle, número, piso)" className="mt-4 w-full border-b border-tinta/20 focus:border-dorado transition-colors bg-transparent py-3 outline-none placeholder:text-humo/70" />
            )}
          </section>

          <section>
            <p className="kicker text-dorado mb-4">Tu pedido · {items.length} ítems</p>
            <div className="divide-y divide-linea border-y border-linea">
              {items.map((r) => (
                <div key={r.sku} className="flex justify-between gap-4 py-3 text-sm">
                  <span className="text-tinta/75">{r.cantidad}× {r.nombre}</span>
                  <span className="text-ink font-medium whitespace-nowrap">{pesos((Number(r.precio) || 0) * r.cantidad)}</span>
                </div>
              ))}
            </div>
          </section>
          {error && <p className="rounded-lg border border-rojo/30 bg-rojo/5 text-rojo-osc px-4 py-3 text-sm">{error}</p>}
        </div>

        <div className="md:sticky md:top-28 h-fit border border-linea rounded-xl p-6 bg-crema">
          <div className="flex justify-between items-baseline mb-5"><span className="font-semibold text-ink">Total</span><span className="display text-2xl font-semibold text-ink">{pesos(total)}</span></div>
          <button onClick={confirmar} disabled={cargando} className="w-full rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors disabled:opacity-60">
            {cargando ? "Procesando…" : "Confirmar pedido"}
          </button>
          <p className="text-xs text-humo text-center mt-3 leading-relaxed">Si Mercado Pago está activo te llevamos a pagar; si no, coordinás al recibir.</p>
        </div>
      </div>
    </div>
  );
}
