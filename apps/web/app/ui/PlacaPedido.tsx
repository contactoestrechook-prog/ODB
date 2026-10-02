import { pesos } from "../../lib/tipos";

// "Placa roja" de la tienda: el detalle de un pedido con el mismo paquete
// gráfico de las tarjetas que manda el bot por WhatsApp (apps/api/src/comun/
// cartel-pedido.ts) y de la placa del panel (apps/admin/app/ui/kit/PlacaRoja.tsx).
// Pedido de Leandro (2/10/2026): "siempre que se detallen productos vamos a
// usar el paquete gráfico de pedidos y lista de precio". Franja roja con el logo
// y el título en mayúsculas, un renglón blanco por producto con la cantidad en
// el círculo rojo, el total en la píldora negra y la entrega en su recuadro.
//
// Reglas de la web que esta placa respeta: el título va en UN solo color; ningún
// texto se sale de su marco (min-w-0 y overflow-wrap:anywhere en todo lo que es
// texto libre); el importe no se aprieta contra el nombre: si no entran juntos,
// baja a su propia línea; y el logo, como toda imagen, va absolute inset-0 sobre
// un recuadro relative overflow-hidden.
//
// No tiene estado ni efectos: sirve igual en una página de servidor (Tus
// compras) que en una de cliente (Finalizar compra).

export type RenglonPlaca = {
  clave: string;
  /** Va en el círculo rojo. Sin cantidad no hay círculo. */
  cantidad?: number | null;
  nombre: string;
  /** Línea gris debajo del nombre ("2 × $20.500"). */
  detalle?: string | null;
  /** A la derecha, grande: el subtotal ya formateado. */
  importe?: string | null;
};

export type EntregaPlaca = { titulo: string; detalle?: string | null };

// Todos los pedidos de la tienda salen de Saint Thomas (la única sucursal con
// retiro: lo dice PedidosService.crearDesdeApp). Escrito igual que en la tarjeta
// del bot: "Saint Thomas", nunca "Sant Thomas".
export const RETIRO_SAINT_THOMAS: EntregaPlaca = { titulo: "Retiro en la sucursal Saint Thomas", detalle: "Castex 3601, Canning" };

/** La cantidad como se lee: entera sin decimales, por peso con coma ("1,5"). */
export const cantidadLegible = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

/**
 * Un renglón con precio: "2 × $20.500" en gris y el subtotal a la derecha. Lo
 * que se vende por peso lleva "kg" y "/ kg" (sin eso "1 × $82.800" parece el
 * precio de un paquete). Si no hay precio, el renglón va solo con cantidad y nombre.
 */
export function renglonConPrecio(r: {
  clave: string;
  nombre: string;
  cantidad: number;
  unitario: number | null | undefined;
  porKilo?: boolean;
}): RenglonPlaca {
  const base = { clave: r.clave, nombre: r.nombre, cantidad: r.cantidad };
  if (r.unitario == null || !Number.isFinite(Number(r.unitario))) return base;
  const c = cantidadLegible(r.cantidad);
  return {
    ...base,
    detalle: r.porKilo ? `${c} kg × ${pesos(r.unitario)} / kg` : `${c} × ${pesos(r.unitario)}`,
    importe: pesos(Number(r.unitario) * r.cantidad),
  };
}

/** Debajo del título, como en la tarjeta del bot: "3 productos · 5 unidades" (las unidades, solo si todo se cuenta por unidad). */
export function cuentaDeProductos(items: { cantidad: number; porKilo?: boolean }[]): string {
  const n = items.length;
  const productos = `${n} ${n === 1 ? "producto" : "productos"}`;
  if (items.some((i) => i.porKilo || !Number.isInteger(i.cantidad))) return productos;
  const u = items.reduce((s, i) => s + i.cantidad, 0);
  return `${productos} · ${u} ${u === 1 ? "unidad" : "unidades"}`;
}

export function PlacaPedido({
  titulo,
  sub,
  renglones,
  total,
  entrega,
  pie,
  como: Titular = "h2",
  className = "",
}: {
  /** En mayúsculas en la franja: RESUMEN, PEDIDO, COMPRA… */
  titulo: string;
  /** Debajo del título: la cuenta de productos, el código del pedido, la fecha. */
  sub?: string | null;
  renglones: RenglonPlaca[];
  /** La píldora negra. */
  total?: { etiqueta?: string; valor: string } | null;
  /** El recuadro blanco con título rojo: cómo y dónde se entrega. */
  entrega?: EntregaPlaca | null;
  /** Texto chico centrado al pie. */
  pie?: string | null;
  /** El nivel del título según la página (h2 suelto, h3 dentro de "Tus compras"). */
  como?: "h2" | "h3";
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-[20px] bg-crema text-left ${className}`}>
      <header className="flex items-center justify-between gap-3 bg-rojo px-4 py-4 sm:px-6 sm:py-5">
        {/* el logo es la marca, no se lee en voz alta; el título sí */}
        <span aria-hidden="true" className="relative block h-10 w-[65px] shrink-0 overflow-hidden sm:h-12 sm:w-[78px]">
          <img src="/odb-logo-blanco.png" alt="" className="absolute inset-0 h-full w-full object-contain" />
        </span>
        <div className="min-w-0 text-right text-white">
          <Titular className="marca text-lg font-extrabold uppercase leading-tight tracking-wide [overflow-wrap:anywhere] sm:text-xl">
            {titulo}
          </Titular>
          {sub && <p className="mt-0.5 text-sm text-white/80 [overflow-wrap:anywhere]">{sub}</p>}
        </div>
      </header>

      <div className="space-y-2.5 p-3 sm:p-5">
        {renglones.length > 0 && (
          <ul className="space-y-2.5">
            {renglones.map((r) => {
              const hayCantidad = r.cantidad != null && Number.isFinite(Number(r.cantidad));
              const c = hayCantidad ? cantidadLegible(Number(r.cantidad)) : "";
              return (
                <li key={r.clave} className="flex min-w-0 items-center gap-3 rounded-2xl border border-linea bg-white px-3 py-3 sm:px-4">
                  {hayCantidad && (
                    <span
                      className={`marca grid size-11 shrink-0 place-items-center rounded-full bg-rojo font-extrabold tabular-nums text-white ${
                        c.length > 3 ? "text-xs" : c.length > 2 ? "text-sm" : "text-lg"
                      }`}
                    >
                      {c}
                    </span>
                  )}
                  {/* basis-40: si el nombre y el importe no entran juntos, el importe baja a su línea */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="font-semibold leading-snug text-tinta [overflow-wrap:anywhere]">{r.nombre}</p>
                      {r.detalle && <p className="mt-0.5 text-sm text-tinta/60 [overflow-wrap:anywhere]">{r.detalle}</p>}
                    </div>
                    {r.importe && (
                      <span className="marca ml-auto whitespace-nowrap text-lg font-extrabold tabular-nums text-tinta">{r.importe}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {total && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-full bg-tinta px-5 py-3 text-white sm:px-6">
            <span className="marca font-extrabold uppercase tracking-wide">{total.etiqueta ?? "Total"}</span>
            <span className="marca ml-auto whitespace-nowrap text-xl font-extrabold tabular-nums">{total.valor}</span>
          </div>
        )}

        {entrega && (
          <div className="min-w-0 rounded-2xl border border-linea bg-white px-4 py-3">
            <p className="font-extrabold text-rojo [overflow-wrap:anywhere]">{entrega.titulo}</p>
            {entrega.detalle && <p className="mt-0.5 text-sm text-tinta/60 [overflow-wrap:anywhere]">{entrega.detalle}</p>}
          </div>
        )}

        {pie && <p className="px-2 pt-1 text-center text-sm text-tinta/70 [overflow-wrap:anywhere]">{pie}</p>}
      </div>
    </section>
  );
}
