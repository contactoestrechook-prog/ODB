"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PedidoVista } from "../../../lib/pedido";
import { estadoAbierto, pasosDelPedido, tituloDelEstado } from "../../../lib/estados";
import { leerJson } from "../../../lib/respuesta";
import { pesos, porKilo } from "../../../lib/tipos";
import { IcoCheck, IcoFlecha } from "../../ui/Iconos";
import { ROTULO, Titulo } from "../../ui/Titulo";
import { PlacaPedido, RETIRO_SAINT_THOMAS, renglonConPrecio, type EntregaPlaca } from "../../ui/PlacaPedido";

// Seguimiento del pedido (/pedido/<id>, 6/10/2026). Llega con el pedido ya
// leído en el servidor y se refresca solo cada 20 s mientras el pedido siga
// abierto; si una vuelta falla, queda lo último que se vio y un aviso chico.

/** Lo que dijo Mercado Pago al volver del pago (viene en la dirección; solo cambia el texto). */
export type VueltaDePago = "aprobado" | "pendiente" | "no-completado" | null;

const REFRESCO_MS = 20_000;
const ZONA = "America/Argentina/Buenos_Aires";

// "6 de octubre, 14:32" armado a mano con las partes: así el servidor y el
// navegador escriben exactamente lo mismo (toLocaleString varía entre motores).
function fechaHora(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONA })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day} de ${p.month}, ${p.hour}:${p.minute}`;
}

const DETALLE_DEL_PASO: Record<string, (retiro: boolean) => string> = {
  recibido: () => "Ya lo tenemos. En breve empezamos a prepararlo.",
  pagado: () => "Recibimos el pago.",
  en_preparacion: () => "Lo estamos armando en la sucursal.",
  listo: (retiro) => (retiro ? "Ya podés pasar a buscarlo." : "Está listo para salir."),
  en_camino: () => "El repartidor va para tu casa.",
  entregado: () => "¡Que lo disfrutes!",
  cancelado: () => "Si tenés alguna duda, consultanos.",
};

function textoDelPago(p: PedidoVista, vuelta: VueltaDePago): string | null {
  if (p.pagadoEn) {
    const f = fechaHora(p.pagadoEn);
    return f ? `Pagado el ${f}.` : "Pagado.";
  }
  if (!estadoAbierto(p.estado)) return null;
  const al = p.canal === "domicilio" ? "al recibirlo" : "al retirarlo";
  if (vuelta === "aprobado") return "Mercado Pago aprobó tu pago: en unos segundos se marca acá.";
  if (vuelta === "pendiente") return "Mercado Pago está procesando tu pago. Cuando se acredite, se marca acá.";
  if (vuelta === "no-completado") return `El pago con Mercado Pago no se completó. Lo coordinamos ${al}.`;
  return `Si pagaste con Mercado Pago, se marca acá en unos minutos. Si no, lo coordinamos ${al}.`;
}

export function Seguimiento({ inicial, vuelta = null }: { inicial: PedidoVista; vuelta?: VueltaDePago }) {
  const [p, setP] = useState<PedidoVista>(inicial);
  const [fallo, setFallo] = useState(false);

  // cada 20 s, mientras el pedido siga abierto (entregado o cancelado ya no cambia);
  // con la pestaña oculta no pregunta, y al volver a ella pregunta en el acto
  useEffect(() => {
    if (!estadoAbierto(p.estado)) return;
    let vivo = true;
    const traer = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/pedido/${encodeURIComponent(p.id)}`, { cache: "no-store" });
        const d = await leerJson(r);
        if (!vivo) return;
        if (r.ok && d?.id) { setP(d as PedidoVista); setFallo(false); }
        else if (r.status !== 404) setFallo(true);
      } catch {
        if (vivo) setFallo(true);
      }
    };
    const t = setInterval(traer, REFRESCO_MS);
    const alVolver = () => { if (!document.hidden) traer(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, [p.id, p.estado]);

  const retiro = p.canal !== "domicilio";
  const pasos = pasosDelPedido(p);
  const entrega: EntregaPlaca = retiro
    ? RETIRO_SAINT_THOMAS
    : { titulo: "Envío a domicilio", detalle: p.direccion ?? "A la dirección que nos diste al hacer el pedido" };
  const renglones = p.renglones.map((r, i) =>
    renglonConPrecio({ clave: `${r.sku ?? "renglon"}-${i}`, nombre: r.nombre, cantidad: r.cantidad, unitario: r.unitario, porKilo: porKilo({ nombre: r.nombre }) }),
  );
  const total = p.total ?? p.renglones.reduce((s, r) => s + (Number(r.unitario) || 0) * r.cantidad, 0);
  const cancelado = p.estado === "cancelado";

  return (
    <div className="max-w-5xl mx-auto px-5 lg:px-8 py-10">
      <p className={`${ROTULO} text-rojo`}>Seguimiento del pedido</p>
      <Titulo como="h1" a={tituloDelEstado(p.estado, p.canal, p.pagadoEn)} className="text-[34px] sm:text-[44px] mt-2 [overflow-wrap:anywhere]" />
      <p className="mt-2 text-sm text-humo" aria-live="polite">
        {!estadoAbierto(p.estado)
          ? null
          : fallo
            ? "No pudimos actualizar el estado. Lo volvemos a intentar en unos segundos."
            : "Esta pantalla se actualiza sola."}
      </p>

      <div className="mt-8 grid md:grid-cols-[minmax(0,1fr)_400px] gap-8 items-start">
        <div className="min-w-0 space-y-8">
          {/* el código: lo que muestra al retirar o al recibir */}
          <div className="min-w-0 rounded-[20px] bg-ink text-white px-5 py-5 sm:px-6">
            <p className={`${ROTULO} text-white/60`}>{retiro ? "Código de retiro" : "Código del pedido"}</p>
            <p className="marca mt-1.5 text-[28px] sm:text-[34px] font-black leading-tight tracking-wide [overflow-wrap:anywhere]">{p.codigo}</p>
            {!cancelado && (
              <p className="mt-2 text-sm text-white/75 [overflow-wrap:anywhere]">
                {retiro
                  ? `Mostralo al retirar en la sucursal Saint Thomas (${RETIRO_SAINT_THOMAS.detalle}).`
                  : "Tenelo a mano cuando llegue el repartidor."}
              </p>
            )}
          </div>

          {/* la línea de tiempo */}
          <section className="min-w-0" aria-label="Estado del pedido">
            <ol className="min-w-0">
              {pasos.map((s, i) => {
                const siguiente = pasos[i + 1];
                const esCancelado = s.clave === "cancelado";
                return (
                  <li key={s.clave} aria-current={s.actual ? "step" : undefined} className="relative flex min-w-0 gap-4 pb-7 last:pb-0">
                    {siguiente && (
                      <span aria-hidden className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${siguiente.hecho ? "bg-rojo" : "bg-linea"}`} />
                    )}
                    <span
                      aria-hidden
                      className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full ${
                        s.actual
                          ? `${esCancelado ? "bg-ink" : "bg-rojo"} text-white ring-4 ${esCancelado ? "ring-ink/10" : "ring-rojo/15"}`
                          : s.hecho
                            ? "bg-rojo text-white"
                            : "bg-white ring-2 ring-inset ring-linea"
                      }`}
                    >
                      {s.hecho && !s.actual && <IcoCheck size={15} />}
                      {s.actual && (esCancelado ? <span className="block h-0.5 w-3 rounded bg-white" /> : <span className="block size-2.5 rounded-full bg-white" />)}
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className={`marca text-[16px] leading-tight [overflow-wrap:anywhere] ${s.actual ? "font-black text-ink" : s.hecho ? "font-bold text-ink/75" : "font-bold text-humo"}`}>
                        {s.etiqueta}
                      </p>
                      {s.actual && <p className="mt-1 text-sm text-tinta/70 [overflow-wrap:anywhere]">{DETALLE_DEL_PASO[s.clave]?.(retiro) ?? ""}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <div className="min-w-0 md:sticky md:top-28 space-y-4">
          <PlacaPedido
            titulo="Pedido"
            sub={fechaHora(p.creadoEn) ?? p.codigo}
            renglones={renglones}
            total={{ etiqueta: p.pagadoEn ? "Total pagado" : "Total", valor: pesos(total) }}
            entrega={entrega}
            pie={textoDelPago(p, vuelta)}
          />
          <Link href="/catalogo" className="flex items-center justify-center gap-2 rounded-full border-2 border-ink h-12 px-6 text-[14px] font-bold text-ink hover:bg-ink hover:text-white transition-colors">
            Seguir comprando <IcoFlecha size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
