// Máquina de estados de un pedido — LÓGICA PURA (sin DB ni red), testeable aislada.
// Define qué transición de estado es válida y cuáles son terminales / liberan stock.

export const TRANSICIONES: Record<string, string[]> = {
  recibido: ['en_preparacion', 'cancelado'],
  pagado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['listo', 'cancelado'],
  listo: ['en_camino', 'entregado', 'cancelado'], // en_camino = delivery a domicilio
  en_camino: ['entregado', 'cancelado'],
};

export function transicionValida(actual: string, siguiente: string): boolean {
  return TRANSICIONES[actual]?.includes(siguiente) ?? false;
}

export function estadosSiguientes(actual: string): string[] {
  return TRANSICIONES[actual] ?? [];
}

// 'entregado' y 'cancelado' son terminales y liberan la reserva de stock.
export function liberaReserva(estado: string): boolean {
  return estado === 'entregado' || estado === 'cancelado';
}

export function esTerminal(estado: string): boolean {
  return liberaReserva(estado);
}
