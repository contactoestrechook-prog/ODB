"use client";

import { useState } from "react";
import Link from "next/link";
import { useCarrito } from "../../lib/carrito";
import { pesos } from "../../lib/tipos";

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
      <div className="min-h-[60vh] grid place-items-center px-4 text-center">
        <div className="max-w-md">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-[#2A201C]">¡Pedido recibido!</h1>
          <p className="text-[#5f554d] mt-2">Tu pedido <span className="font-mono font-semibold">{ok.qr ?? ok.pedidoId.slice(0, 8)}</span> fue registrado. Te avisamos cuando esté listo.</p>
          <p className="text-sm text-[#9B9088] mt-2">Coordinamos el pago al {tipo === "pickup" ? "retirar" : "recibir"} tu pedido.</p>
          <Link href="/" className="inline-block mt-6 rounded-full bg-[#B82D25] text-white font-semibold px-6 py-3 hover:bg-[#932A1F]">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (listo && items.length === 0) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-4 text-center">
        <div>
          <h1 className="text-xl font-bold text-[#2A201C]">No hay nada para finalizar</h1>
          <Link href="/catalogo" className="inline-block mt-4 rounded-full bg-[#B82D25] text-white font-semibold px-6 py-3">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-[#2A201C] mb-5">Finalizar compra</h1>

      <div className="grid md:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-5">
          <section className="bg-white rounded-2xl border border-black/5 p-5">
            <h2 className="font-semibold text-[#2A201C] mb-3">¿Cómo lo querés recibir?</h2>
            <div className="grid grid-cols-2 gap-3">
              {([["pickup", "🏬 Retiro en local", "Lo retirás en O.D.B Central"], ["domicilio", "🛵 Envío a domicilio", "Te lo llevamos"]] as const).map(([k, t, s]) => (
                <button key={k} onClick={() => setTipo(k)} className={`text-left rounded-xl border p-4 ${tipo === k ? "border-[#B82D25] bg-[#B82D25]/5" : "border-black/10 hover:border-[#B82D25]/40"}`}>
                  <p className="font-medium text-[#2A201C]">{t}</p>
                  <p className="text-xs text-[#9B9088] mt-0.5">{s}</p>
                </button>
              ))}
            </div>
            {tipo === "domicilio" && (
              <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección de entrega (calle, número, piso)" className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 outline-none focus:border-[#B82D25]" />
            )}
          </section>

          <section className="bg-white rounded-2xl border border-black/5 p-5">
            <h2 className="font-semibold text-[#2A201C] mb-3">Tu pedido ({items.length})</h2>
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.sku} className="flex justify-between text-sm">
                  <span className="text-[#5f554d]">{r.cantidad}× {r.nombre}</span>
                  <span className="text-[#2A201C] font-medium">{pesos((Number(r.precio) || 0) * r.cantidad)}</span>
                </div>
              ))}
            </div>
          </section>
          {error && <p className="rounded-xl bg-[#FBE9E7] text-[#932A1F] px-4 py-3 text-sm">{error}</p>}
        </div>

        <div className="md:sticky md:top-20 h-fit bg-white rounded-2xl border border-black/5 p-5">
          <div className="flex justify-between font-bold text-lg text-[#2A201C] mb-4"><span>Total</span><span>{pesos(total)}</span></div>
          <button onClick={confirmar} disabled={cargando} className="w-full rounded-full bg-[#B82D25] text-white font-semibold py-3 hover:bg-[#932A1F] disabled:opacity-60">
            {cargando ? "Procesando…" : "Confirmar pedido"}
          </button>
          <p className="text-xs text-[#9B9088] text-center mt-3">Si Mercado Pago está activo, te llevamos a pagar. Si no, coordinás el pago al recibir.</p>
        </div>
      </div>
    </div>
  );
}
