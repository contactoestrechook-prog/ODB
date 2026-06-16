import Link from "next/link";
import { redirect } from "next/navigation";
import { apiJson } from "../../lib/api";
import { sesion } from "../../lib/sesion";
import { pesos } from "../../lib/tipos";

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
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#2A201C]">Hola, {cliente.nombre?.split(" ")[0] ?? "cliente"} 👋</h1>
          <p className="text-sm text-[#9B9088]">{cliente.email}</p>
        </div>
        <a href="/api/salir" className="text-sm text-[#5f554d] hover:text-[#B82D25]">Cerrar sesión</a>
      </div>

      {/* puntos */}
      <div className="rounded-3xl bg-gradient-to-br from-[#1A1412] to-[#5A1A16] text-white p-6 mb-6">
        <div className="flex items-center justify-between">
          <span className="text-[#C9A96E] text-xs tracking-[0.2em] font-semibold">TUS PUNTOS</span>
          <span className="bg-[#C9A96E] text-[#1A1412] text-xs font-bold rounded-full px-3 py-1">{puntos.nivel?.nombre ?? "Bronce"}</span>
        </div>
        <p className="text-4xl font-bold mt-2">{Number(puntos.saldo ?? 0).toLocaleString("es-AR")}</p>
        <p className="text-white/60 text-sm mt-1">Sumás 1 punto por cada $100 de compra. Canjealos por recompensas desde la app.</p>
        {!cliente.verificado && (
          <div className="mt-4 rounded-xl bg-white/10 p-3 text-sm">
            🎖️ Verificá tu identidad para acceder a la <span className="font-semibold">Comunidad ODB</span> (precios de socio + prioridad en envíos).
          </div>
        )}
      </div>

      {/* historial */}
      <h2 className="font-bold text-[#2A201C] mb-3">Tus compras</h2>
      {(!compras || compras.length === 0) ? (
        <p className="bg-white rounded-2xl border border-black/5 p-8 text-center text-[#9B9088]">Todavía no tenés compras. <Link href="/catalogo" className="text-[#B82D25] hover:underline">Empezá por el catálogo →</Link></p>
      ) : (
        <div className="space-y-3">
          {compras.map((c: any) => (
            <div key={c.tipo + c.id} className="bg-white rounded-2xl border border-black/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#2A201C] text-sm">{CANAL[c.canal] ?? "Compra"} · {fecha(c.fecha)}</p>
                  <p className="text-xs text-[#9B9088] mt-0.5 line-clamp-1">{(c.items ?? []).map((i: any) => `${i.cantidad}× ${i.nombre}`).join(" · ")}</p>
                </div>
                <p className="font-bold text-[#2A201C]">{pesos(c.total)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
