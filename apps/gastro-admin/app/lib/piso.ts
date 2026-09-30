export type EstadoMesa =
  | "sentada"
  | "vio_carta"
  | "comanda_tomada"
  | "plato_servido"
  | "terminando"
  | "pidio_cuenta"
  | "pago"
  | "libre";

export const ETIQUETA_ESTADO: Record<EstadoMesa, string> = {
  sentada: "Recién sentados",
  vio_carta: "Viendo la carta",
  comanda_tomada: "Comanda tomada",
  plato_servido: "Comiendo",
  terminando: "Terminando (ofrecé postre)",
  pidio_cuenta: "Pidió la cuenta",
  pago: "Pagó — liberar mesa",
  libre: "Libre",
};

// Qué hizo el mozo para pasar AL estado indicado (el botón dice esta acción)
export const ETIQUETA_SIGUIENTE: Partial<Record<EstadoMesa, string>> = {
  vio_carta: "Vio la carta",
  comanda_tomada: "Tomé la comanda",
  plato_servido: "Serví el plato",
  terminando: "Terminó de comer",
  pidio_cuenta: "Pidió la cuenta",
  pago: "Pagó",
  libre: "Liberar mesa",
};

export const ORDEN_ESTADOS: EstadoMesa[] = [
  "sentada", "vio_carta", "comanda_tomada", "plato_servido", "terminando", "pidio_cuenta", "pago", "libre",
];

export function siguienteEstado(actual: EstadoMesa): EstadoMesa | null {
  const idx = ORDEN_ESTADOS.indexOf(actual);
  return idx >= 0 && idx < ORDEN_ESTADOS.length - 1 ? ORDEN_ESTADOS[idx + 1] : null;
}

export type MesaPiso = {
  mesaId: string;
  numero: number;
  sector: string | null;
  cicloId?: string;
  estado: EstadoMesa;
  cubiertos: number | null;
  mozoId: string | null;
  mozoNombre: string | null;
  minutosEnEstado: number | null;
  minutosTotal: number | null;
  llamadoHaceMin: number | null;
  color: "verde" | "amarillo" | "rojo" | null;
};

export type Mozo = { id: string; nombre: string; activo: boolean };
