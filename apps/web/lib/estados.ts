// Estados de un pedido, como los lee el cliente. La base guarda
// "en_preparacion"; en pantalla nunca va crudo ni con guion bajo.
// Los usan Tus compras (/cuenta) y el seguimiento (/pedido/<id>).

export type Estado = "recibido" | "pagado" | "en_preparacion" | "listo" | "en_camino" | "entregado" | "cancelado";
export type Canal = "pickup" | "domicilio";

const ETIQUETA: Record<string, string> = {
  recibido: "Recibido",
  pagado: "Pagado",
  en_preparacion: "En preparación",
  listo: "Listo",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** "Listo para retirar" si es retiro; si no, la etiqueta. Un estado desconocido sale prolijo, sin guiones bajos. */
export function etiquetaEstado(estado: string | null | undefined, canal?: string | null): string {
  const e = String(estado ?? "");
  if (e === "listo" && canal === "pickup") return "Listo para retirar";
  if (ETIQUETA[e]) return ETIQUETA[e];
  const t = e.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "Sin estado";
}

/** Un pedido que todavía se mueve (el seguimiento sigue refrescando). */
export const estadoAbierto = (estado: string | null | undefined) => estado !== "entregado" && estado !== "cancelado";

export type Paso = { clave: string; etiqueta: string; hecho: boolean; actual: boolean };

/**
 * La línea de tiempo del pedido. "Pagado" aparece solo si el pago está
 * registrado (pagado_en): un pedido que se paga al retirar pasa de Recibido a
 * En preparación sin ese paso. Retiro: Recibido · En preparación · Listo para
 * retirar · Entregado. Envío: suma En camino. Cancelado: lo que se llegó a
 * hacer y Cancelado al final.
 */
export function pasosDelPedido(p: { estado: string; canal: string; pagadoEn?: string | null }): Paso[] {
  const domicilio = p.canal === "domicilio";
  const claves: string[] = ["recibido"];
  if (p.pagadoEn) claves.push("pagado");
  claves.push("en_preparacion", "listo");
  if (domicilio) claves.push("en_camino");
  claves.push("entregado");

  // el estado "pagado" sin pago registrado se lee como "recibido"
  const actual = p.estado === "pagado" && !p.pagadoEn ? "recibido" : p.estado;

  if (actual === "cancelado") {
    const pasos: Paso[] = [{ clave: "recibido", etiqueta: etiquetaEstado("recibido"), hecho: true, actual: false }];
    if (p.pagadoEn) pasos.push({ clave: "pagado", etiqueta: etiquetaEstado("pagado"), hecho: true, actual: false });
    pasos.push({ clave: "cancelado", etiqueta: etiquetaEstado("cancelado"), hecho: true, actual: true });
    return pasos;
  }

  let i = claves.indexOf(actual);
  if (i < 0) i = 0; // un estado que no conocemos: al menos quedó recibido
  return claves.map((c, k) => ({
    clave: c,
    etiqueta: etiquetaEstado(c, p.canal),
    hecho: k <= i,
    actual: k === i,
  }));
}

/** El título grande del seguimiento, según en qué está. */
export function tituloDelEstado(estado: string, canal: string, pagadoEn?: string | null): string {
  const retiro = canal !== "domicilio";
  switch (estado === "pagado" && !pagadoEn ? "recibido" : estado) {
    case "pagado": return "Tu pedido está pagado";
    case "en_preparacion": return "Estamos preparando tu pedido";
    case "listo": return retiro ? "Tu pedido está listo para retirar" : "Tu pedido está listo para salir";
    case "en_camino": return "Tu pedido está en camino";
    case "entregado": return retiro ? "Ya retiraste tu pedido" : "Tu pedido fue entregado";
    case "cancelado": return "Tu pedido fue cancelado";
    default: return "Recibimos tu pedido";
  }
}
