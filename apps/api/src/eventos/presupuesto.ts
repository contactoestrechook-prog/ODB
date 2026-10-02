import { HojaPlacaRoja, PILDORA, cantidad, importe } from '../comun/documentos';
import { ROJO, GRIS } from '../comun/cartel-pedido';

// El presupuesto que se le da al cliente de un evento. Desde el 2/10/2026 con
// el diseño Placa roja, el mismo de los pedidos y las listas de precios que
// salen por WhatsApp ("siempre que se detallen productos", pedido de Leandro):
// antes tenía su propio encabezado bordó con dorado y una tabla. Los datos son
// los mismos: para quién, qué evento, cada renglón con cantidad, precio
// unitario y subtotal, el total y la validez.

const TIPO_LABEL: Record<string, string> = {
  cumpleanos: 'Cumpleaños', casamiento: 'Casamiento', corporativo: 'Evento corporativo',
  fin_de_ano: 'Fiesta de fin de año', otro: 'Evento',
};

export type DatosPresupuesto = {
  folio: string;
  fecha: string;
  cliente?: { nombre?: string; dni?: string } | null;
  evento: { nombre: string; tipo: string; fecha?: string | null; invitados?: number | null };
  items: { descripcion: string; cantidad: number; precio_unitario: number }[];
};

export async function generarPresupuesto(d: DatosPresupuesto): Promise<Buffer> {
  const h = await HojaPlacaRoja.abrir('PRESUPUESTO', d.folio, `N° ${d.folio} · ${d.fecha}`);

  // Para quién y qué evento
  const evLinea = [TIPO_LABEL[d.evento.tipo] ?? 'Evento',
    d.evento.invitados ? `${d.evento.invitados} invitados` : null,
    d.evento.fecha ? new Date(d.evento.fecha).toLocaleDateString('es-AR') : null]
    .filter(Boolean).join(' · ');
  const y0 = h.datos(
    { rotulo: 'PARA', nombre: d.cliente?.nombre || 'Cliente', detalle: d.cliente?.dni ? `DNI ${d.cliente.dni}` : null },
    { rotulo: 'EVENTO', nombre: d.evento.nombre, detalle: evLinea },
  );

  const total = d.items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_unitario), 0);
  const leyenda = h.partir('Presupuesto válido por 15 días. Sujeto a disponibilidad de stock al momento de la confirmación.', { letra: 'normal', tam: 9 }, h.anchoUtil - 8, 2);
  const altoCierre = 4 + PILDORA + h.altoLeyenda(leyenda);

  // Un renglón por ítem: la cantidad en el círculo, "cantidad × unitario" en gris y el subtotal a la derecha
  const cierre = h.renglones(d.items.map((it) => ({
    cantidad: Number(it.cantidad),
    nombre: it.descripcion,
    gris: `${cantidad(it.cantidad)} × ${importe(it.precio_unitario)}`,
    importe: importe(Number(it.cantidad) * Number(it.precio_unitario)),
  })), { desde: y0 + 12, altoCierre });

  const y = cierre.y + 4;
  h.pildora(y, 'TOTAL', importe(total));
  h.leyenda(y + PILDORA, leyenda);

  h.pie([
    { texto: 'O.D.B Premium Market', letra: 'fuerte', tam: 9, color: ROJO, espaciado: 1 },
    { texto: 'Outlet de bebidas · Gracias por elegirnos', letra: 'normal', tam: 8, color: GRIS },
  ], true);
  return h.cerrar();
}
