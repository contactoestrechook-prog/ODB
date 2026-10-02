"use client";

import { useState } from "react";
import Link from "next/link";
import { useCarrito, type Renglon } from "../../lib/carrito";
import { pesos, porKilo } from "../../lib/tipos";
import { IcoLocal, IcoMoto, IcoCheck } from "../ui/Iconos";
import {
  PlacaPedido,
  RETIRO_SAINT_THOMAS,
  cuentaDeProductos,
  renglonConPrecio,
  type EntregaPlaca,
  type RenglonPlaca,
} from "../ui/PlacaPedido";

// El pedido ya registrado, para dibujarlo en la Placa roja de "¡Pedido recibido!".
type Recibido = {
  pedidoId: string;
  codigo: string;
  renglones: RenglonPlaca[];
  total: number;
  entrega: EntregaPlaca;
};

type RenglonDelSistema = { sku: string | null; nombre: string; cantidad: number; unitario: number | null };

const entregaDe = (tipo: "pickup" | "domicilio", direccion: string): EntregaPlaca =>
  tipo === "pickup"
    ? RETIRO_SAINT_THOMAS
    : { titulo: "Envío a domicilio", detalle: direccion.trim() || "Escribí la dirección de entrega" };

/**
 * El detalle de "¡Pedido recibido!" sale de lo que registró el sistema (precio
 * unitario y total de la base, que manda /api/checkout). Si por algo no vino,
 * se muestra lo que el cliente acaba de confirmar en la pantalla anterior, con
 * los mismos precios que vio: nunca un renglón inventado.
 */
function armarRecibido(
  d: { pedidoId: string; qr: string | null; total?: number | null; renglones?: RenglonDelSistema[] | null },
  enviados: Renglon[],
  entrega: EntregaPlaca,
): Recibido {
  const porSku = new Map(enviados.map((r) => [r.sku, r]));
  const delSistema = Array.isArray(d.renglones) && d.renglones.length > 0;
  const base = delSistema
    ? d.renglones!.map((x, i) => {
        const enCarrito = x.sku ? porSku.get(x.sku) : undefined;
        return { clave: `${x.sku ?? "renglon"}-${i}`, nombre: x.nombre, cantidad: x.cantidad, unitario: x.unitario, porKilo: porKilo(enCarrito ?? { nombre: x.nombre }) };
      })
    : enviados.map((r) => ({ clave: r.sku, nombre: r.nombre, cantidad: r.cantidad, unitario: r.precio, porKilo: porKilo(r) }));
  const sumados = base.reduce((s, r) => s + (Number(r.unitario) || 0) * r.cantidad, 0);
  return {
    pedidoId: d.pedidoId,
    codigo: d.qr ?? d.pedidoId.slice(0, 8),
    renglones: base.map(renglonConPrecio),
    total: delSistema && d.total != null ? Number(d.total) : sumados,
    entrega,
  };
}

export default function Checkout() {
  const { items, total, vaciar, listo } = useCarrito();
  const [tipo, setTipo] = useState<"pickup" | "domicilio">("pickup");
  const [direccion, setDireccion] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<Recibido | null>(null);

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
      // lo confirmado se guarda ANTES de vaciar el carrito: con el carrito vacío
      // la pantalla de "¡Pedido recibido!" ya no tendría qué mostrar
      const enviados = items;
      vaciar();
      if (d.pagoUrl) { window.location.href = d.pagoUrl; return; }
      setOk(armarRecibido(d, enviados, entregaDe(tipo, direccion)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
    setCargando(false);
  }

  if (ok) {
    return (
      <div className="min-h-[70vh] grid place-items-center px-5 py-10 text-center">
        <div className="w-full max-w-md min-w-0">
          <span className="inline-grid place-items-center w-16 h-16 rounded-full bg-ink text-dorado mb-6"><IcoCheck size={28} /></span>
          <h1 className="display text-3xl font-semibold text-ink">¡Pedido recibido!</h1>
          <p className="text-tinta/70 mt-3 [overflow-wrap:anywhere]">Tu pedido <span className="font-mono font-semibold text-ink">{ok.codigo}</span> quedó registrado. Te avisamos cuando esté listo.</p>
          <p className="text-sm text-humo mt-2">Coordinamos el pago al {tipo === "pickup" ? "retirar" : "recibir"} tu pedido.</p>
          <PlacaPedido
            className="mt-7"
            titulo="Pedido"
            sub={ok.codigo}
            renglones={ok.renglones}
            total={{ valor: pesos(ok.total) }}
            entrega={ok.entrega}
          />
          <Link href="/" className="inline-block mt-7 rounded-full bg-ink text-crema font-semibold px-7 py-3.5 hover:bg-vino transition-colors">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  // hasta leer el carrito guardado no hay nada que resumir (sin esto, la placa
  // aparecía un instante vacía y en $0)
  if (!listo) return <div className="min-h-[60vh]" />;

  if (items.length === 0) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-5 text-center">
        <div>
          <h1 className="display text-2xl font-semibold text-ink">No hay nada para finalizar</h1>
          <Link href="/catalogo" className="inline-block mt-5 rounded-full bg-ink text-crema font-semibold px-7 py-3.5">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  // El resumen va en la Placa roja (2/10/2026): antes era "2× Producto" con el
  // subtotal al lado y el total en otro recuadro.
  const resumen = items.map((r) => renglonConPrecio({ clave: r.sku, nombre: r.nombre, cantidad: r.cantidad, unitario: r.precio, porKilo: porKilo(r) }));
  const cuenta = cuentaDeProductos(items.map((r) => ({ cantidad: r.cantidad, porKilo: porKilo(r) })));

  return (
    <div className="max-w-5xl mx-auto px-5 lg:px-8 py-10">
      <p className="kicker text-dorado">Último paso</p>
      <h1 className="display text-3xl sm:text-4xl font-semibold text-ink mt-1.5 mb-8 tracking-tight">Finalizar compra</h1>

      {/* 400 px: lo justo para que el nombre y el importe entren lado a lado en
          escritorio; en celular el importe baja a su propia línea */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_400px] gap-8 items-start">
        <section className="min-w-0">
          <p className="kicker text-dorado mb-4">¿Cómo lo querés recibir?</p>
          <div className="grid grid-cols-2 gap-3">
            {([["pickup", IcoLocal, "Retiro en local", "En la sucursal Saint Thomas"], ["domicilio", IcoMoto, "Envío a domicilio", "Te lo llevamos"]] as const).map(([k, Ico, t, s]) => (
              <button key={k} onClick={() => setTipo(k)} className={`min-w-0 text-left rounded-xl border p-5 transition-colors ${tipo === k ? "border-dorado bg-dorado/5" : "border-linea hover:border-dorado/50"}`}>
                <Ico size={22} className={tipo === k ? "text-rojo" : "text-tinta/60"} />
                <p className="font-semibold text-ink mt-3 [overflow-wrap:anywhere]">{t}</p>
                <p className="text-xs text-humo mt-0.5 [overflow-wrap:anywhere]">{s}</p>
              </button>
            ))}
          </div>
          {tipo === "domicilio" && (
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección de entrega (calle, número, piso)" className="mt-4 w-full min-w-0 border-b border-tinta/20 focus:border-dorado transition-colors bg-transparent py-3 outline-none placeholder:text-humo/70" />
          )}
        </section>

        <div className="md:sticky md:top-28 min-w-0 space-y-4">
          <PlacaPedido
            titulo="Resumen"
            sub={cuenta}
            renglones={resumen}
            total={{ valor: pesos(total) }}
            entrega={entregaDe(tipo, direccion)}
          />
          {error && <p className="rounded-lg border border-rojo/30 bg-rojo/5 text-rojo-osc px-4 py-3 text-sm">{error}</p>}
          <button onClick={confirmar} disabled={cargando} className="w-full rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors disabled:opacity-60">
            {cargando ? "Procesando…" : "Confirmar pedido"}
          </button>
          <p className="text-xs text-humo text-center leading-relaxed">Si Mercado Pago está activo te llevamos a pagar; si no, coordinás al recibir.</p>
        </div>
      </div>
    </div>
  );
}
