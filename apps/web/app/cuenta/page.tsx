import Link from "next/link";
import { redirect } from "next/navigation";
import { apiJson } from "../../lib/api";
import { sesion } from "../../lib/sesion";
import { pesos } from "../../lib/tipos";
import { estadoAbierto, etiquetaEstado } from "../../lib/estados";
import { IcoDesplegar, IcoFlecha, IcoLocal, IcoMoto } from "../ui/Iconos";
import { PlacaPedido, cantidadLegible, renglonConPrecio, type EntregaPlaca } from "../ui/PlacaPedido";
import { ROTULO, Titulo } from "../ui/Titulo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — O.D.B Premium Market" };

// La página se arma en el servidor, que puede estar en UTC: sin fijar la zona,
// una compra de las 22 h saldría con la fecha del día siguiente.
const ZONA = "America/Argentina/Buenos_Aires";
const fecha = (s: string) => (s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: ZONA }) : "—");
const fechaLarga = (s: string) => (s ? new Date(s).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: ZONA }) : null);
const CANAL: Record<string, string> = { pickup: "Retiro", domicilio: "Envío", self_checkout: "Comprá Fácil", mostrador: "En el local", web: "Web" };

// El recuadro de la entrega en la placa: cómo se llevó la compra y, si es un
// pedido, en qué está. No se nombra la sucursal: una compra en el local pudo
// ser en Saint Thomas o en Santa Inés y el historial no lo dice.
const ENTREGA: Record<string, string> = {
  pickup: "Retiro en el local",
  domicilio: "Envío a domicilio",
  self_checkout: "Comprá Fácil",
  mostrador: "Compra en el local",
};
const entregaDe = (c: any): EntregaPlaca => ({
  titulo: ENTREGA[c.canal] ?? CANAL[c.canal] ?? "Compra",
  // con etiqueta ("En preparación", "Listo para retirar"), nunca "en_preparacion"
  detalle: c.tipo === "pedido" && c.estado ? `Estado: ${etiquetaEstado(c.estado, c.canal)}` : null,
});

export default async function Cuenta() {
  const cliente = await sesion();
  if (!cliente) redirect("/ingresar");

  const [puntos, compras] = await Promise.all([
    apiJson<any>("/mi/puntos", { saldo: 0, nivel: { nombre: "Bronce" } }),
    apiJson<any[]>("/mi/compras", []),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-5 lg:px-8 py-10">
      {/* flex-wrap y min-w-0: un email largo se corta dentro de su columna y
          "Cerrar sesión" baja si no entra (antes se salía de la pantalla) */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className={`${ROTULO} text-rojo`}>Mi cuenta</p>
          <Titulo como="h1" a={`Hola, ${cliente.nombre?.split(" ")[0] ?? "cliente"}`} className="text-[34px] sm:text-[42px] mt-2 [overflow-wrap:anywhere]" />
          <p className="text-sm text-humo mt-1 [overflow-wrap:anywhere]">{cliente.email}</p>
        </div>
        <a href="/api/salir" className="shrink-0 text-sm text-humo subraya whitespace-nowrap">Cerrar sesión</a>
      </div>

      {/* Puntos */}
      <div className="mt-8 bg-ink text-crema rounded-xl p-6 sm:p-7 relative overflow-hidden" style={{ backgroundImage: "radial-gradient(120% 90% at 100% 0%, rgba(147,42,31,0.65), transparent 55%)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`${ROTULO} text-rojo-claro`}>Tus puntos</p>
          <span className="border border-rojo-claro/50 text-rojo-claro text-[11px] font-semibold tracking-wide rounded-full px-3 py-1">{puntos.nivel?.nombre ?? "Bronce"}</span>
        </div>
        <p className="marca text-[36px] sm:text-5xl font-extrabold leading-none mt-3 tabular-nums [overflow-wrap:anywhere]">{Number(puntos.saldo ?? 0).toLocaleString("es-AR")}</p>
        <p className="text-crema/55 text-sm mt-2">Sumás 1 punto por cada $100 de compra. Canjealos por recompensas desde la app.</p>
        {!cliente.verificado && (
          <div className="mt-5 rounded-lg border border-rojo-claro/25 bg-rojo/5 p-3.5 text-sm text-crema/75">
            Verificá tu identidad para entrar a la <span className="text-rojo-claro font-medium">Comunidad ODB</span> — precios de socio y prioridad en envíos.
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="mt-12">
        <p className={`${ROTULO} text-rojo`}>Tu historial</p>
        <Titulo a="Tus compras" className="text-[28px] sm:text-[32px] mt-2 mb-5" />

        {(!compras || compras.length === 0) ? (
          <div className="border border-linea rounded-xl px-6 py-12 text-center">
            <p className="text-humo">Todavía no tenés compras.</p>
            <Link href="/catalogo" className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-ink hover:text-rojo transition-colors">Empezá por el catálogo <IcoFlecha size={15} /></Link>
          </div>
        ) : (
          // Cada compra es una línea breve ("2× X · 1× Y") que se toca para ver el
          // detalle en la Placa roja (2/10/2026). Es un <details> nativo: abre
          // sin JavaScript y con el teclado. Cada renglón lleva lo que se pagó
          // (precioUnitario de /mi/compras; el "producto" que viene es la
          // tarjeta de HOY, para recomprar). Una compra vieja sin ese dato va
          // con cantidad y nombre, y el total de la compra. Los pedidos llevan
          // además su estado y el link al seguimiento (/pedido/<id>, 6/10/2026).
          <div className="divide-y divide-linea border-y border-linea">
            {compras.map((c: any) => {
              const items: any[] = c.items ?? [];
              const esPedido = c.tipo === "pedido";
              return (
                <details key={c.tipo + c.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 sm:gap-4 py-4 [&::-webkit-details-marker]:hidden">
                    <span className="text-rojo shrink-0">{c.canal === "domicilio" ? <IcoMoto size={20} /> : <IcoLocal size={20} />}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{CANAL[c.canal] ?? "Compra"} · {fecha(c.fecha)}</p>
                      {/* el estado en su propia línea: al lado de la fecha, en celular se cortaba */}
                      {esPedido && c.estado && (
                        <p className={`text-xs mt-0.5 truncate ${estadoAbierto(c.estado) ? "font-bold text-rojo" : "font-semibold text-tinta/60"}`}>{etiquetaEstado(c.estado, c.canal)}</p>
                      )}
                      <p className="text-xs text-humo mt-0.5 truncate">{items.map((i: any) => `${cantidadLegible(Number(i.cantidad))}× ${i.nombre}`).join(" · ")}</p>
                    </div>
                    <p className="marca text-base sm:text-lg font-extrabold text-ink whitespace-nowrap">{pesos(c.total)}</p>
                    <IcoDesplegar size={18} className="shrink-0 text-humo transition-transform group-open:rotate-180" />
                  </summary>
                  <PlacaPedido
                    className={esPedido ? "mb-3" : "mb-5"}
                    como="h3"
                    titulo={esPedido ? "Pedido" : "Compra"}
                    sub={fechaLarga(c.fecha)}
                    renglones={items.map((i: any, k: number) => renglonConPrecio({ clave: `${i.sku ?? "renglon"}-${k}`, cantidad: Number(i.cantidad), nombre: i.nombre ?? "Producto", unitario: i.precioUnitario }))}
                    total={{ valor: pesos(c.total) }}
                    entrega={entregaDe(c)}
                    pie={items.length === 0 ? "Esta compra no tiene el detalle de productos." : null}
                  />
                  {esPedido && (
                    <Link href={`/pedido/${c.id}`} className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-ink text-white px-5 h-11 text-[14px] font-bold hover:bg-rojo transition-colors">
                      Seguir este pedido <IcoFlecha size={15} />
                    </Link>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
