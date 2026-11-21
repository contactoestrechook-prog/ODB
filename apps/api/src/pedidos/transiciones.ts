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

// UN PASO ATRÁS (Juan Pablo, 20/11/2026: «si tienen que deshacer algo… tiene que
// estar previsto desde la app»). Solo los pasos que no tocan stock ni plata: un
// «listo» o un «salió» marcados por error. Entregado (hay venta y cobro) y
// cancelado (se liberó la reserva y se avisó la baja) no vuelven desde acá: lo
// entregado se devuelve en la Caja y lo cancelado se carga de nuevo.
const PASO_ATRAS: Record<string, string> = {
  listo: 'en_preparacion',
  en_camino: 'listo',
};

/** A qué estado vuelve; null si ese paso no se deshace. */
export function pasoAtras(actual: string): string | null {
  return PASO_ATRAS[actual] ?? null;
}

/** Por qué no se puede volver atrás desde ese estado (para decírselo a la persona). */
export function motivoSinPasoAtras(actual: string): string {
  if (actual === 'entregado') return 'Un pedido entregado ya tiene su venta y su cobro: lo que vuelve se hace con «Devolución» en la Caja.';
  if (actual === 'cancelado') return 'Un pedido cancelado no vuelve: ya se liberó el stock y se avisó la baja. Cargalo de nuevo.';
  if (actual === 'en_preparacion') return 'Ya está en preparación. Si lo arma otra persona, cambiá quién lo arma.';
  return 'Ese pedido todavía no tiene ningún paso para deshacer.';
}

/** ¿Ese cambio de estado fue un paso atrás? (para decirlo en el historial) */
export function esPasoAtras(antes: string, despues: string): boolean {
  return PASO_ATRAS[antes] === despues;
}
