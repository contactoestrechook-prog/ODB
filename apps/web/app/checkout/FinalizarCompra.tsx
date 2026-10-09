"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCarrito, type Renglon } from "../../lib/carrito";
import { pesos, porKilo } from "../../lib/tipos";
import { leerJson, SIN_CONEXION } from "../../lib/respuesta";
import { errorDeWhatsapp, revisarWhatsapp, whatsappLegible } from "../../lib/telefono";
import { IcoLocal, IcoMoto, IcoCheck, IcoFlecha } from "../ui/Iconos";
import { ROTULO, Titulo } from "../ui/Titulo";
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
  telefono: string;
};

type RenglonDelSistema = { sku: string | null; nombre: string; cantidad: number; unitario: number | null };

// Nombre y WhatsApp del último pedido hecho en este navegador: la próxima vez
// vienen escritos. Es solo una comodidad; si no se puede leer, el formulario
// arranca vacío.
const GUARDADO = "odb_contacto";

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
  telefono: string,
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
    telefono,
  };
}

const CAMPO = "mt-1 w-full min-w-0 border-b border-tinta/20 focus:border-rojo transition-colors bg-transparent py-2.5 text-[15px] outline-none placeholder:text-humo/70 aria-[invalid=true]:border-rojo";

export function FinalizarCompra({ nombreCuenta }: { nombreCuenta: string | null }) {
  const { items, total, vaciar, listo } = useCarrito();
  const [tipo, setTipo] = useState<"pickup" | "domicilio">("pickup");
  const [direccion, setDireccion] = useState("");
  // si el cliente entró con su cuenta, el nombre viene escrito
  const [nombre, setNombre] = useState(nombreCuenta?.trim() ?? "");
  const [telefono, setTelefono] = useState("");
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [intento, setIntento] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<Recibido | null>(null);
  const refNombre = useRef<HTMLInputElement>(null);
  const refTelefono = useRef<HTMLInputElement>(null);
  const refDireccion = useRef<HTMLInputElement>(null);

  // lo que quedó guardado del pedido anterior en este navegador
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(GUARDADO) ?? "null");
      if (g?.nombre) setNombre((n) => n || String(g.nombre));
      if (g?.telefono) setTelefono((t) => t || String(g.telefono));
    } catch {}
  }, []);

  const wa = revisarWhatsapp(telefono);
  const errores = {
    nombre: nombre.trim() ? null : "Escribí tu nombre.",
    telefono: errorDeWhatsapp(wa),
    direccion: tipo === "domicilio" && !direccion.trim() ? "Escribí la dirección de entrega." : null,
  };
  const ver = (campo: keyof typeof errores) => (intento || tocado[campo] ? errores[campo] : null);
  const tocar = (campo: string) => setTocado((t) => ({ ...t, [campo]: true }));

  async function confirmar() {
    setError(null);
    setIntento(true);
    // el primer campo con error toma el foco (en celular el botón queda lejos de los campos)
    if (errores.direccion) { refDireccion.current?.focus(); return; }
    if (errores.nombre) { refNombre.current?.focus(); return; }
    if (errores.telefono || !wa.ok) { refTelefono.current?.focus(); return; }
    setCargando(true);
    const body = {
      tipo,
      items: items.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
      destino: tipo === "domicilio" ? { direccion: direccion.trim() } : undefined,
      origen: "web",
      contacto: { nombre: nombre.trim(), telefono: wa.numero },
    };
    let r: Response;
    try {
      r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      // sin conexión: "Failed to fetch" no le dice nada al cliente
      setError(SIN_CONEXION);
      setCargando(false);
      return;
    }
    const d = await leerJson(r);
    if (!r.ok || !d?.pedidoId) {
      setError(d?.message ?? SIN_CONEXION);
      setCargando(false);
      return;
    }
    try { localStorage.setItem(GUARDADO, JSON.stringify({ nombre: nombre.trim(), telefono: wa.numero })); } catch {}
    // lo confirmado se guarda ANTES de vaciar el carrito: con el carrito vacío
    // la pantalla de "¡Pedido recibido!" ya no tendría qué mostrar
    const enviados = items;
    vaciar();
    // Mercado Pago: al terminar de pagar, la API lo devuelve a /pedido/<id>
    if (d.pagoUrl) { window.location.href = d.pagoUrl; return; }
    setOk(armarRecibido(d, enviados, entregaDe(tipo, direccion), d.telefono ?? wa.numero));
    setCargando(false);
    window.scrollTo({ top: 0 });
  }

  if (ok) {
    return (
      <div className="min-h-[70vh] grid place-items-center px-5 py-10 text-center">
        <div className="w-full max-w-md min-w-0">
          <span className="inline-grid place-items-center w-16 h-16 rounded-full bg-rojo text-white mb-6"><IcoCheck size={28} /></span>
          <Titulo como="h1" a="¡Pedido recibido!" className="text-[34px] sm:text-[40px]" />
          <p className="text-tinta/75 mt-3 [overflow-wrap:anywhere]">
            Tu pedido <span className="font-mono font-semibold text-ink">{ok.codigo}</span> quedó registrado. Te avisamos por WhatsApp al{" "}
            <span className="font-semibold text-ink whitespace-nowrap">{whatsappLegible(ok.telefono)}</span> cuando esté listo.
          </p>
          <p className="text-sm text-humo mt-2">Coordinamos el pago al {tipo === "pickup" ? "retirar" : "recibir"} tu pedido.</p>
          <Link href={`/pedido/${ok.pedidoId}`} className="mt-6 inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-full bg-ink text-white font-bold px-7 h-12 hover:bg-rojo transition-colors">
            Seguir mi pedido <IcoFlecha size={16} />
          </Link>
          <PlacaPedido
            className="mt-7"
            titulo="Pedido"
            sub={ok.codigo}
            renglones={ok.renglones}
            total={{ valor: pesos(ok.total) }}
            entrega={ok.entrega}
          />
          <Link href="/" className="inline-block mt-6 text-sm text-humo subraya">Volver al inicio</Link>
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
        <div className="min-w-0">
          <Titulo como="h1" a="No hay nada para finalizar" className="text-[28px] sm:text-[34px]" />
          <Link href="/catalogo" className="inline-block mt-5 rounded-full bg-ink text-crema font-semibold px-7 py-3.5">Ir al catálogo</Link>
        </div>
      </div>
    );
  }

  // El resumen va en la Placa roja (2/10/2026): antes era "2× Producto" con el
  // subtotal al lado y el total en otro recuadro.
  const resumen = items.map((r) => renglonConPrecio({ clave: r.sku, nombre: r.nombre, cantidad: r.cantidad, unitario: r.precio, porKilo: porKilo(r) }));
  const cuenta = cuentaDeProductos(items.map((r) => ({ cantidad: r.cantidad, porKilo: porKilo(r) })));
  const errTel = ver("telefono");

  return (
    <div className="max-w-5xl mx-auto px-5 lg:px-8 py-10">
      <p className={`${ROTULO} text-rojo`}>Último paso</p>
      <Titulo como="h1" a="Finalizar compra" className="text-[36px] sm:text-[44px] mt-2 mb-8" />

      {/* 400 px: lo justo para que el nombre y el importe entren lado a lado en
          escritorio; en celular el importe baja a su propia línea */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_400px] gap-8 items-start">
        <div className="min-w-0 space-y-10">
          <section className="min-w-0">
            <h2 className={`${ROTULO} text-rojo mb-4`}>¿Cómo lo querés recibir?</h2>
            <div className="grid grid-cols-2 gap-3">
              {([["pickup", IcoLocal, "Retiro en local", "En la sucursal Saint Thomas"], ["domicilio", IcoMoto, "Envío a domicilio", "Te lo llevamos sin cargo"]] as const).map(([k, Ico, t, s]) => (
                <button key={k} type="button" aria-pressed={tipo === k} onClick={() => setTipo(k)} className={`min-w-0 text-left rounded-xl border p-4 sm:p-5 transition-colors ${tipo === k ? "border-rojo bg-rojo/5" : "border-linea hover:border-rojo/50"}`}>
                  <Ico size={22} className={tipo === k ? "text-rojo" : "text-tinta/60"} />
                  <p className="font-semibold text-ink mt-3 [overflow-wrap:anywhere]">{t}</p>
                  <p className="text-xs text-humo mt-0.5 [overflow-wrap:anywhere]">{s}</p>
                </button>
              ))}
            </div>
            {tipo === "domicilio" && (
              <div className="mt-4 min-w-0">
                <input
                  ref={refDireccion}
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  onBlur={() => tocar("direccion")}
                  placeholder="Dirección de entrega (calle, número, piso)"
                  aria-label="Dirección de entrega"
                  autoComplete="street-address"
                  aria-invalid={!!ver("direccion")}
                  aria-describedby="error-direccion"
                  className={CAMPO}
                />
                {ver("direccion") && <p id="error-direccion" className="mt-1.5 text-[13px] text-rojo">{ver("direccion")}</p>}
              </div>
            )}
          </section>

          {/* Nombre y WhatsApp (6/10/2026): por ahí le avisamos cuando el pedido
              está listo. El número se acepta como lo escriba (con 0, 15 o +54)
              y se muestra cómo quedó, para que vea a qué número le escribimos. */}
          <section className="min-w-0">
            <h2 className={`${ROTULO} text-rojo mb-1`}>¿A quién le avisamos?</h2>
            <p className="text-sm text-humo mb-4">Te escribimos por WhatsApp cuando tu pedido esté listo.</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5">
              <label className="block min-w-0">
                <span className="text-[13px] font-semibold text-tinta/80">Nombre</span>
                <input
                  ref={refNombre}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  onBlur={() => tocar("nombre")}
                  autoComplete="name"
                  maxLength={80}
                  placeholder="Tu nombre"
                  aria-invalid={!!ver("nombre")}
                  aria-describedby="error-nombre"
                  className={CAMPO}
                />
                {ver("nombre") && <span id="error-nombre" className="block mt-1.5 text-[13px] text-rojo">{ver("nombre")}</span>}
              </label>
              <label className="block min-w-0">
                <span className="text-[13px] font-semibold text-tinta/80">WhatsApp</span>
                <input
                  ref={refTelefono}
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  onBlur={() => tocar("telefono")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  maxLength={24}
                  placeholder="11 2345 6789"
                  aria-invalid={!!errTel}
                  aria-describedby="ayuda-telefono"
                  className={CAMPO}
                />
                <span id="ayuda-telefono" className={`block mt-1.5 text-[13px] [overflow-wrap:anywhere] ${errTel ? "text-rojo" : "text-humo"}`}>
                  {errTel ?? (wa.ok ? <>Te escribimos al <span className="font-semibold text-ink whitespace-nowrap">{whatsappLegible(wa.numero)}</span></> : "Con característica, sin 0 ni 15.")}
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className="md:sticky md:top-28 min-w-0 space-y-4">
          <PlacaPedido
            titulo="Resumen"
            sub={cuenta}
            renglones={resumen}
            total={{ valor: pesos(total) }}
            entrega={entregaDe(tipo, direccion)}
          />
          {error && <p role="alert" className="rounded-lg border border-rojo/30 bg-rojo/5 text-rojo-osc px-4 py-3 text-sm [overflow-wrap:anywhere]">{error}</p>}
          <button type="button" onClick={confirmar} disabled={cargando} className="w-full rounded-full bg-ink text-crema font-semibold py-3.5 hover:bg-vino transition-colors disabled:opacity-60">
            {cargando ? "Procesando…" : "Confirmar pedido"}
          </button>
          <p className="text-xs text-humo text-center leading-relaxed">Si Mercado Pago está activo te llevamos a pagar; si no, coordinás al recibir.</p>
        </div>
      </div>
    </div>
  );
}
