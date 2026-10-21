// Envíos a domicilio en el panel (21/10/2026). El envío llega armado de la API
// (apps/api/src/pedidos/envios.ts): acá solo el tipo y lo que es de pantalla
// (enlaces a WhatsApp, a llamar y al mapa).

import type { TonoEtiqueta } from '../ui/kit';
import { telefonoLegible } from './pedidos';

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

export const ESTADO_ENVIO: Record<string, { label: string; tono: TonoEtiqueta }> = {
  recibido: { label: 'Para preparar', tono: 'atencion' },
  pagado: { label: 'Para preparar · pagado', tono: 'atencion' },
  en_preparacion: { label: 'Preparando', tono: 'neutro' },
  listo: { label: 'Listo para salir', tono: 'ok' },
  en_camino: { label: 'En la calle', tono: 'info' },
};

/** Los pasos de un envío, en orden, con lo que dice el botón. */
export const PASOS: { estados: string[]; titulo: string; boton: string | null; siguiente: string | null }[] = [
  { estados: ['recibido', 'pagado'], titulo: 'Para preparar', boton: 'Empezar a preparar', siguiente: 'en_preparacion' },
  { estados: ['en_preparacion'], titulo: 'Preparando', boton: 'Marcar listo', siguiente: 'listo' },
  { estados: ['listo'], titulo: 'Listos para salir', boton: 'Salió', siguiente: 'en_camino' },
  { estados: ['en_camino'], titulo: 'En la calle', boton: 'Entregado', siguiente: 'entregado' },
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
