// Envíos a domicilio en el panel (21/10/2026). El envío llega armado de la API
// (apps/api/src/pedidos/envios.ts): acá solo el tipo y lo que es de pantalla
// (enlaces a WhatsApp, a llamar y al mapa).

import type { TonoEtiqueta } from '../ui/kit';
import { ESTADOS, telefonoLegible } from './pedidos';

export type Envio = {
  id: string;
  codigo: string;
  estado: string;
  total: number;
  origen: string | null;
  creado_en: string;
  estadoDesde: string;
  sucursal: string | null;
  cliente: { nombre: string | null; telefono: string | null; whatsapp: string | null };
  destino: { direccion: string | null; lat: number | null; lng: number | null };
  entrega: { fecha: string | null; franja: string | null; texto: string };
  cobro: { pagado: boolean; medio: string | null; preguntar: boolean; texto: string };
  indicaciones: string | null;
  items: { cantidad: number; nombre: string; sku: string | null; precio: number | null; subtotal: number | null }[];
  repartidor: { id: string; nombre: string } | null;
  enVivo: { distanciaM: number; etaMin: number; actualizado: string | null } | null;
  grupo: 'atrasado' | 'hoy' | 'programado';
  atraso: { motivo: 'fecha' | 'sin_moverse' | 'en_la_calle'; desde: string; horas: number; texto: string } | null;
  paraCerrar: boolean;
};

export type QuienLleva = {
  repartidores: { id: string; nombre: string; telefono: string | null }[];
  delLocal: { id: string; nombre: string; rol: string }[];
};

// El texto es de envíos; el tono, el mismo de Pedidos (regla del kit: un mismo
// estado lleva el mismo tono en todas las pantallas). Antes «Preparando» era
// gris acá y celeste en Pedidos.
const TEXTO_ESTADO_ENVIO: Record<string, string> = {
  recibido: 'Para preparar',
  pagado: 'Para preparar · pagado',
  en_preparacion: 'Preparando',
  listo: 'Listo para salir',
  en_camino: 'En la calle',
};
export const ESTADO_ENVIO: Record<string, { label: string; tono: TonoEtiqueta }> = Object.fromEntries(
  Object.entries(TEXTO_ESTADO_ENVIO).map(([estado, label]) => [estado, { label, tono: ESTADOS[estado]?.tono ?? 'neutro' }]),
);

/**
 * Los pasos de un envío, en orden, con lo que dice el botón. `pendiente` es el
 * botón del recuadro «¿Se entregó o se cancela?» cuando todavía no pasó: antes
 * decía «Sigue pendiente: salió», que se contradice.
 */
export const PASOS: { estados: string[]; titulo: string; boton: string | null; pendiente: string | null; siguiente: string | null }[] = [
  { estados: ['recibido', 'pagado'], titulo: 'Para preparar', boton: 'Empezar a preparar', pendiente: 'Sigue: empezar a prepararlo', siguiente: 'en_preparacion' },
  { estados: ['en_preparacion'], titulo: 'Preparando', boton: 'Marcar listo', pendiente: 'Sigue: marcarlo listo', siguiente: 'listo' },
  { estados: ['listo'], titulo: 'Listos para salir', boton: 'Salió', pendiente: 'Todavía no salió: despacharlo', siguiente: 'en_camino' },
  { estados: ['en_camino'], titulo: 'En la calle', boton: 'Entregado', pendiente: null, siguiente: 'entregado' },
];
export const pasoDe = (estado: string) => PASOS.find((p) => p.estados.includes(estado)) ?? null;

export const MEDIOS_ENTREGA = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
];

const ROLES: Record<string, string> = {
  dueno: 'dueño',
  gerente: 'gerente',
  comprador: 'compras',
  cajero: 'caja',
  deposito: 'depósito',
  administrativo: 'administración',
};
export const rolLegible = (rol: string) => ROLES[rol] ?? rol;

/**
 * «Ana (caja)». Si el nombre ya lo dice entre paréntesis no se repite: el
 * usuario «Leandro (dueño)» salía «Leandro (dueño) (dueño)».
 */
export function personaLegible(nombre: string, rol: string): string {
  const r = rolLegible(rol);
  const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\([^)]*\)\s*$/.test(nombre) || sinTildes(nombre).includes(`(${sinTildes(r)})`) ? nombre : `${nombre} (${r})`;
}

export const FRANJAS = [
  { valor: '', etiqueta: 'Sin franja' },
  { valor: 'mañana', etiqueta: 'A la mañana' },
  { valor: 'tarde', etiqueta: 'A la tarde' },
];

/** Google Maps: con coordenadas si las hay; si no, la dirección (en Canning, si no lo dice). */
export function linkMapa(e: Pick<Envio, 'destino'>): string | null {
  const { direccion, lat, lng } = e.destino;
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (!direccion) return null;
  const consulta = /canning|ezeiza|esteban echeverr|buenos aires/i.test(direccion) ? direccion : `${direccion}, Canning, Buenos Aires`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

/** wa.me con el número ya normalizado por la API (549…). */
export const linkWhatsappEnvio = (e: Pick<Envio, 'cliente'>) => (e.cliente.whatsapp ? `https://wa.me/${e.cliente.whatsapp}` : null);

/** Para llamar: +54 9 11… (el 9 hace falta para un celular desde otro celular). */
export const linkLlamar = (e: Pick<Envio, 'cliente'>) => (e.cliente.whatsapp ? `tel:+${e.cliente.whatsapp}` : null);

export const telefonoDelEnvio = (e: Pick<Envio, 'cliente'>) => telefonoLegible(e.cliente.whatsapp ?? e.cliente.telefono);

/** "a 1,2 km · ~4 min" */
export function enVivoTexto(e: Pick<Envio, 'enVivo'>): string | null {
  if (!e.enVivo) return null;
  const m = e.enVivo.distanciaM;
  const dist = m >= 1000 ? `${(m / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km` : `${m} m`;
  return `a ${dist} · ~${e.enVivo.etaMin} min`;
}
