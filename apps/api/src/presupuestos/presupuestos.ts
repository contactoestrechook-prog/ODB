// PRESUPUESTOS (25/11/2026): las cuentas y los textos, sin base. Ver presupuestos.service.ts.
//
// Leandro, por Juan Pablo: «que todos puedan hacer presupuestos… llama alguien y dice tengo
// una fiesta en casa, me gustaría poner vinos, papas fritas, etc., y que los chicos puedan
// pasarle un presupuesto». Decidido: todos los del local, por WhatsApp desde la línea de ODB
// con la tarjeta y el PDF, y el precio vale 48 horas.

import { celularWhatsapp } from '../comun/whatsapp';

export const VALIDEZ_HORAS = 48;
export const MAX_RENGLONES = 60;

export type RenglonPresupuesto = { productoId: string; sku: string | null; nombre: string; cantidad: number; precio: number };
export type EstadoPresupuesto = 'borrador' | 'enviado' | 'aceptado' | 'anulado';
export type EstadoVisible = EstadoPresupuesto | 'vencido';

const ZONA = 'America/Argentina/Buenos_Aires';

/** El celular del cliente como lo marca WhatsApp (549 + 10 dígitos), o null si no es un celular. */
export function telefonoDelCliente(t: unknown): string | null {
  const c = celularWhatsapp(String(t ?? ''));
  return /^549\d{10}$/.test(c) ? c : null;
}

/** Lo que llega de la pantalla: producto y cantidad, sin repetidos (se suman) y con tope. */
export function renglonesPedidos(items: unknown): { productoId: string; cantidad: number }[] | string {
  if (!Array.isArray(items) || !items.length) return 'Agregá al menos un producto.';
  const porProducto = new Map<string, number>();
  for (const it of items as any[]) {
    const id = String(it?.productoId ?? '').trim();
    const cant = Number(it?.cantidad);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return 'Hay un producto que no se reconoce.';
    if (!Number.isFinite(cant) || cant <= 0 || cant > 9999) return 'Revisá las cantidades: tienen que ser mayores a cero.';
    porProducto.set(id, Math.round(((porProducto.get(id) ?? 0) + cant) * 1000) / 1000);
  }
  if (porProducto.size > MAX_RENGLONES) return `Un presupuesto lleva hasta ${MAX_RENGLONES} productos.`;
  return [...porProducto].map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

/** El total, en centavos para no perder nada al sumar. */
export function totalDe(renglones: Pick<RenglonPresupuesto, 'cantidad' | 'precio'>[]): number {
  return renglones.reduce((s, r) => s + Math.round(r.cantidad * r.precio * 100), 0) / 100;
}

/** Vencido no se guarda: es un borrador o enviado que pasó su hora. */
export function estadoVisible(p: { estado: EstadoPresupuesto; vence_en?: string | null }, ahora = Date.now()): EstadoVisible {
  if (p.estado === 'aceptado' || p.estado === 'anulado') return p.estado;
  if (p.vence_en && Date.parse(p.vence_en) < ahora) return 'vencido';
  return p.estado;
}

export function venceEn(desde = Date.now()): string {
  return new Date(desde + VALIDEZ_HORAS * 3600_000).toISOString();
}

/** «el jueves 27/11 a las 14:30» */
export function hastaCuando(iso: string): string {
  const d = new Date(iso);
  const semana = d.toLocaleDateString('es-AR', { weekday: 'long', timeZone: ZONA });
  const [, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d).split('-').map(Number);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
  return `el ${semana} ${dd}/${m} a las ${hora}`;
}

const plata = (n: number) => `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const cantidadLegible = (c: number) => (Number.isInteger(c) ? String(c) : c.toLocaleString('es-AR', { maximumFractionDigits: 3 }));
const primerNombre = (n?: string | null) => String(n ?? '').trim().split(/\s+/)[0] ?? '';

/** El texto que acompaña la tarjeta por WhatsApp. */
export function textoParaElCliente(p: { numero: number; cliente_nombre?: string | null; total: number; vence_en: string }): string {
  const nombre = primerNombre(p.cliente_nombre);
  return [
    `${nombre ? `Hola ${nombre}, ` : 'Hola, '}te paso el presupuesto N.º ${p.numero} de ODB por ${plata(p.total)}.`,
    `Los precios valen hasta ${hastaCuando(p.vence_en)}.`,
    'Si te sirve, respondé este mensaje y lo preparamos.',
  ].join('\n');
}

/** Lo que queda en la charla del bot: si el cliente contesta «dale», sabe de qué se habla. */
export function textoParaLaCharla(p: { numero: number; items: RenglonPresupuesto[]; total: number; vence_en: string }): string {
  return [
    `Presupuesto N.º ${p.numero} (lo armó una persona del local):`,
    ...p.items.map((r) => `• ${cantidadLegible(r.cantidad)} × ${r.nombre} — ${plata(r.precio)} c/u`),
    `Total: ${plata(p.total)}. Precios válidos hasta ${hastaCuando(p.vence_en)}.`,
  ].join('\n');
}
