import Link from "next/link";
import { redirect } from "next/navigation";
import { apiJson } from "../../lib/api";
import { sesion } from "../../lib/sesion";
import { pesos } from "../../lib/tipos";
import { IcoFlecha, IcoLocal, IcoMoto } from "../ui/Iconos";

export const dynamic = "force-dynamic";

const fecha = (s: string) => (s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) : "—");
const CANAL: Record<string, string> = { pickup: "Retiro", domicilio: "Envío", self_checkout: "Comprá Fácil", mostrador: "En el local", web: "Web" };

export default async function Cuenta() {
  const cliente = await sesion();
  if (!cliente) redirect("/ingresar");

  const [puntos, compras] = await Promise.all([
    apiJson<any>("/mi/puntos", { saldo: 0, nivel: { nombre: "Bronce" } }),
    apiJson<any[]>("/mi/compras", []),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-5 lg:px-8 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="kicker text-dorado">Mi cuenta</p>
          <h1 className="display text-3xl sm:text-4xl font-semibold text-ink mt-1.5 tracking-tight">Hola, {cliente.nombre?.split(" ")[0] ?? "cliente"}</h1>
          <p className="text-sm text-humo mt-1">{cliente.email}</p>
        </div>
        <a href="/api/salir" className="text-sm text-humo subraya whitespace-nowrap">Cerrar sesión</a>
      </div>

      {/* Puntos */}
      <div className="mt-8 bg-ink text-crema rounded-xl p-7 relative overflow-hidden" style={{ backgroundImage: "radial-gradient(120% 90% at 100% 0%, rgba(90,26,22,0.6), transparent 55%)" }}>
        <div className="flex items-center justify-between">
          <p className="kicker text-dorado">Tus puntos</p>
          <span className="border border-dorado/50 text-dorado-claro text-[11px] font-semibold tracking-wide rounded-full px-3 py-1">{puntos.nivel?.nombre ?? "Bronce"}</span>
        </div>
        <p className="display text-5xl font-semibold mt-3">{Number(puntos.saldo ?? 0).toLocaleString("es-AR")}</p>
        <p className="text-crema/55 text-sm mt-2">Sumás 1 punto por cada $100 de compra. Canjealos por recompensas desde la app.</p>
        {!cliente.verificado && (
          <div className="mt-5 rounded-lg border border-dorado/25 bg-dorado/5 p-3.5 text-sm text-crema/75">
            Verificá tu identidad para entrar a la <span className="text-dorado-claro font-medium">Comunidad ODB</span> — precios de socio y prioridad en envíos.
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="mt-12">
        <p className="kicker text-dorado">Tu historial</p>
        <h2 className="display text-2xl font-semibold text-ink mt-1.5 mb-5 tracking-tight">Tus compras</h2>

        {(!compras || compras.length === 0) ? (
          <div className="border border-linea rounded-xl p-12 text-center">
            <p className="text-humo">Todavía no tenés compras.</p>
            <Link href="/catalogo" className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-ink hover:text-rojo transition-colors">Empezá por el catálogo <IcoFlecha size={15} /></Link>
          </div>
        ) : (
          <div className="divide-y divide-linea border-y border-linea">
            {compras.map((c: any) => (
              <div key={c.tipo + c.id} className="flex items-center gap-4 py-4">
                <span className="text-dorado">{c.canal === "domicilio" ? <IcoMoto size={20} /> : <IcoLocal size={20} />}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{CANAL[c.canal] ?? "Compra"} · {fecha(c.fecha)}</p>
                  <p className="text-xs text-humo mt-0.5 truncate">{(c.items ?? []).map((i: any) => `${i.cantidad}× ${i.nombre}`).join(" · ")}</p>
                </div>
                <p className="display text-lg font-semibold text-ink">{pesos(c.total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
