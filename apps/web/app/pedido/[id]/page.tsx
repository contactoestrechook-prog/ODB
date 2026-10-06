import type { Metadata } from "next";
import Link from "next/link";
import { buscarPedido } from "../../../lib/pedido";
import { SIN_CONEXION } from "../../../lib/respuesta";
import { IcoBolsa } from "../../ui/Iconos";
import { Titulo } from "../../ui/Titulo";
import { Seguimiento, type VueltaDePago } from "./Seguimiento";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Seguí tu pedido — O.D.B Premium Market",
  robots: { index: false, follow: false },
};

// Al volver de Mercado Pago la dirección trae "status" / "collection_status".
// Solo cambia el texto del pago: lo que vale es pagado_en, que marca la API
// cuando Mercado Pago le avisa.
function vueltaDePago(sp: Record<string, string | string[] | undefined>): VueltaDePago {
  const v = String(sp.collection_status ?? sp.status ?? "").toLowerCase();
  if (v === "approved") return "aprobado";
  if (v === "pending" || v === "in_process") return "pendiente";
  if (v === "rejected" || v === "null" || v === "failure" || v === "cancelled") return "no-completado";
  return null;
}

function Aviso({ titulo, texto, children }: { titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] grid place-items-center px-5 py-12 text-center">
      <div className="w-full max-w-md min-w-0">
        <span className="inline-grid place-items-center w-16 h-16 rounded-full bg-crema text-rojo mb-6"><IcoBolsa size={28} /></span>
        <Titulo como="h1" a={titulo} className="text-[30px] sm:text-[36px]" />
        <p className="mt-3 text-tinta/70 [overflow-wrap:anywhere]">{texto}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">{children}</div>
      </div>
    </div>
  );
}

export default async function PedidoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const b = await buscarPedido(id);

  if (b.tipo === "no-existe") {
    return (
      <Aviso titulo="No encontramos ese pedido" texto="Revisá que el link esté completo, tal como te llegó. Si lo hiciste hace un ratito, probá de nuevo en un minuto.">
        <Link href="/catalogo" className="rounded-full bg-ink text-white font-bold px-7 h-12 inline-flex items-center hover:bg-rojo transition-colors">Ir al catálogo</Link>
      </Aviso>
    );
  }

  if (b.tipo === "sin-conexion") {
    return (
      <Aviso titulo="No pudimos cargar tu pedido" texto={SIN_CONEXION}>
        <a href={`/pedido/${encodeURIComponent(id)}`} className="rounded-full bg-ink text-white font-bold px-7 h-12 inline-flex items-center hover:bg-rojo transition-colors">Probar de nuevo</a>
        <Link href="/catalogo" className="rounded-full border-2 border-ink text-ink font-bold px-7 h-12 inline-flex items-center hover:bg-ink hover:text-white transition-colors">Ir al catálogo</Link>
      </Aviso>
    );
  }

  return <Seguimiento inicial={b.pedido} vuelta={vueltaDePago(sp)} />;
}
