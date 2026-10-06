import type { Metadata } from "next";
import { sesion } from "../../lib/sesion";
import { FinalizarCompra } from "./FinalizarCompra";

export const metadata: Metadata = { title: "Finalizar compra — O.D.B Premium Market" };

// La pantalla es de cliente (carrito en el navegador); acá solo se lee la
// sesión para que, si el cliente entró con su cuenta, el nombre venga escrito.
// El WhatsApp no viene en la sesión: se recuerda el del último pedido hecho en
// este navegador (ver FinalizarCompra).
export default async function Checkout() {
  const cliente = await sesion();
  return <FinalizarCompra nombreCuenta={cliente?.nombre ?? null} />;
}
