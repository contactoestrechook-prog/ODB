'use client';

import { useEffect, useState } from 'react';

// Lo que comparten las tres pestañas del salón (rediseño del 17/11/2026).

export type Item = { productoId: string; sku: string | null; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null; aclaracion?: string | null };
export type Carga = { id: number; productoId: string; cantidad: number; creadoEn: string };
/** Lo que la cola de pedidos dice del armado de cada pedido (21/11/2026). */
export type NovedadesDeArmado = {
  /** Quién se lo asignó: a quién le pregunta el que arma. */
  asignadoPorNombre?: string | null;
  /** Quien lo armaba dijo «No lo puedo armar» y sigue sin armador. */
  devuelto?: { porNombre: string | null; motivo: string | null; en: string } | null;
  /** Lo que preguntó quien arma y nadie de la caja vio. */
  consultaSinVer?: { n: number; ultimo: string } | null;
};

/** Un mensaje de la charla del pedido entre quien arma y la caja (21/11/2026). */
export type MensajePedido = { id: number; lado: 'armado' | 'caja'; de: string | null; deNombre: string | null; texto: string; creadoEn: string; vistoEn: string | null };
export type PedidoArmar = {
  id: string; estado: string; canal: string; origen: string; codigo: string; cliente: string | null; notas: string | null;
  sucursal: string | null; sucursalId?: string | null; asignadoA?: string | null; asignadoNombre: string | null; asignadoEn: string;
  /** quién se lo asignó: a quién le pregunta */
  asignadoPorNombre?: string | null;
  mensajes?: MensajePedido[];
  primeraCarga: string | null; cargas: Carga[]; items: Item[];
};
export type ProductoStock = { id: string; sku: string; nombre: string; sucursales: { sucursalId: string; sucursal: string; cantidad: number; ubicacion: string | null }[] };
export type Sucursal = { id: string; nombre: string };

export async function api<T = any>(metodo: 'GET' | 'POST', params: Record<string, unknown>): Promise<T> {
  const r = metodo === 'GET'
    ? await fetch(`/api/salon?${new URLSearchParams(params as Record<string, string>)}`, { cache: 'no-store' })
    : await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const d = await r.json().catch(() => ({}));
  // `datos`: lo que dice el servidor además del mensaje (p. ej. el código que no conoce, 20/11/2026)
  if (!r.ok) throw Object.assign(new Error(Array.isArray(d?.message) ? d.message.join(' · ') : d?.message ?? 'No pude hablar con el sistema'), { status: r.status, datos: d });
  return d as T;
}

/** mm:ss (o h:mm:ss) desde una hora */
export function reloj(desde: string | null | undefined, ahora: number) {
  if (!desde) return '—';
  const s = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function useAhora(cada = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), cada); return () => clearInterval(t); }, [cada]);
  return ahora;
}

/** «yesica Romina Cordova» → «Yesica Romina Cordova» (los nombres se cargaron como vinieron). */
export function nombrePropio(n: string | null | undefined): string {
  return String(n ?? '').trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

/** «Yesica Romina Cordova» → «YC» */
export function iniciales(n: string | null | undefined): string {
  const p = nombrePropio(n).split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '·';
}

/** «Suc Sant Thomas» → «Sant Thomas» */
export const sucursalCorta = (n: string | null | undefined) => String(n ?? '').replace(/^suc(ursal)?\.?\s+/i, '').trim();

/** Productos completos y unidades en el carro de un pedido. */
export function avance(p: Pick<PedidoArmar, 'items'>) {
  const productos = p.items.length;
  const completos = p.items.filter((i) => i.enCarro >= i.cantidad).length;
  const unidades = p.items.reduce((a, i) => a + i.cantidad, 0);
  const cargadas = p.items.reduce((a, i) => a + Math.min(i.enCarro, i.cantidad), 0);
  return { productos, completos, unidades, cargadas, siguiente: p.items.find((i) => i.enCarro < i.cantidad) ?? null };
}

/** El minuto en que se da por «tarde» arrancar un pedido asignado. */
export const MIN_ARRANQUE_TARDE = 3;
