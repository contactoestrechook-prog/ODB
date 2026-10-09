import { API } from "./api";
import { leerJson } from "./respuesta";

// El pedido para la pantalla de seguimiento (/pedido/<id>). GET
// /app/pedidos/:id es público: el id (uuid) hace de llave, como el link que le
// llega al cliente. Se arma acá, en el servidor, una forma limpia para la
// pantalla; la usan la página y la ruta que la refresca cada 20 s.

export type RenglonPedido = { sku: string | null; nombre: string; cantidad: number; unitario: number | null };

export type PedidoVista = {
  id: string;
  codigo: string;
  estado: string;
  canal: string;
  total: number | null;
  pagadoEn: string | null;
  creadoEn: string | null;
  direccion: string | null;
  renglones: RenglonPedido[];
};

export type Busqueda = { tipo: "ok"; pedido: PedidoVista } | { tipo: "no-existe" } | { tipo: "sin-conexion" };

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function aVista(p: any): PedidoVista {
  return {
    id: String(p.id),
    codigo: p.qr_retiro ? String(p.qr_retiro) : String(p.id).slice(0, 8).toUpperCase(),
    estado: String(p.estado ?? "recibido"),
    canal: p.canal === "domicilio" ? "domicilio" : "pickup",
    total: num(p.total),
    pagadoEn: p.pagado_en ?? null,
    creadoEn: p.creado_en ?? null,
    // la API puede mandar la dirección de entrega o no: si viene, se muestra
    direccion: (p.destino_direccion ?? p.destino?.direccion ?? null) || null,
    renglones: Array.isArray(p.items)
      ? p.items.map((i: any) => ({
          sku: i.producto?.sku ?? null,
          nombre: i.producto?.nombre ?? "Producto",
          cantidad: Number(i.cantidad) || 0,
          unitario: num(i.precio_unitario),
        }))
      : [],
  };
}

export async function buscarPedido(id: string): Promise<Busqueda> {
  const limpio = String(id ?? "").trim();
  if (!limpio || limpio.length > 64) return { tipo: "no-existe" };
  let r: Response;
  try {
    r = await fetch(`${API}/app/pedidos/${encodeURIComponent(limpio)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch {
    return { tipo: "sin-conexion" };
  }
  // la API contesta 400 "No existe el pedido" (también si el id no es un uuid)
  if (r.status === 400 || r.status === 404) return { tipo: "no-existe" };
  const d = await leerJson(r);
  if (!r.ok || !d?.id) return { tipo: "sin-conexion" };
  return { tipo: "ok", pedido: aVista(d) };
}
