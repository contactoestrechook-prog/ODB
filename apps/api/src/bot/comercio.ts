import { BadRequestException } from '@nestjs/common';

export type ItemComercial = { sku: string; cantidad: number };
export const pesos = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
export const centavos = (n: number) => Math.round(n * 100);

export function agruparItems(items: ItemComercial[]): ItemComercial[] {
  if (!Array.isArray(items) || !items.length) throw new BadRequestException('No hay renglones para cotizar');
  const porSku = new Map<string, number>();
  for (const item of items) {
    const sku = String(item.sku ?? '').trim();
    const cantidad = Number(item.cantidad);
    if (!sku || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 10000) throw new BadRequestException('Cada renglón necesita SKU y cantidad positiva finita');
    porSku.set(sku, Math.round(((porSku.get(sku) ?? 0) + cantidad) * 1000) / 1000);
  }
  return [...porSku].map(([sku, cantidad]) => ({ sku, cantidad }));
}

export function confirmacionInequivoca(texto: string): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Una modificación o negación requiere otro resumen; no excepciones por la palabra confirmo.
  if (/\b(no|para|espera|todavia|despues|pero|cambia\w*|agrega\w*|saca\w*|quita\w*|mejor|otra?\w*|en vez|cancel\w*)\b/.test(t)) return false;
  // EL «SI» CONDICIONAL NO ES UN SÍ (5/10/2026): «Si queres pásame el total y a
  // donde puedo hacerte l transferencia» (Pablo) daba true; con un «¿Lo
  // confirmo?» a la vista, creaba el pedido sin modelo. Espejo en la RPC
  // confirmar_cotizacion_bot (db/migracion-bot-pedido-comprobante.sql).
  if (/^si\s+(?:qui?er\w*|p(?:o|ue)d\w*|t(?:e|ie)n\w*|hay|me|te|le|les|sale\w*|es|son|era|fuera|necesit\w*|prefer\w*|vos|usted)\b/.test(t)) return false;
  return /^(?:si|dale|ok(?:ey)?|listo|confirmo|confirmalo|confirmame|de acuerdo|hacelo|armalo|cerralo|perfecto)(?:\b|[,.!\s])/.test(t);
}

export function cantidadesIndividuales(texto: string): number[] {
  return [...texto.matchAll(/(?<![\d.,])\b(\d+(?:[.,]\d+)?)\s*(?:botellas?|unidades?|latas?)\b/gi)].map(m => Number(m[1].replace(',', '.')));
}

export function presentacionProducto(p: { nombre?: string; unidades_pack?: number | null; vendido_por_peso?: boolean }) {
  const pack = Number(p.unidades_pack ?? 1);
  const ambiguo = !(Number.isInteger(pack) && pack > 0) || (pack === 1 && /\b(?:pack|caja|bulto|kit)\b|\bx\s*(?:[2-9]|[1-9]\d+)(?![\d.,]|\s*(?:ml|cc|l|lt|lts|litros?|kg|gr|g)\b)/i.test(p.nombre ?? ''));
  return {
    presentacion: ambiguo ? 'requiere_verificacion' : 'catalogada',
    unidadesPorVenta: ambiguo || p.vendido_por_peso ? null : pack,
    vendidoPorPeso: p.vendido_por_peso === true,
    unidad: p.vendido_por_peso ? 'Precio y stock por kilogramo; admite cantidades decimales.' : ambiguo
      ? 'Precio y stock por unidad de venta del SKU. Contenido NO verificado: consultar al local antes de convertir cantidades individuales o afirmar que se vende suelto.'
      : pack > 1 ? `pack de ${pack}: precio y stock por pack` : 'Precio y stock por unidad de venta del SKU; no autoriza abrir envases.',
  };
}

const CAMPOS_PRECIO = /^(precio|precioUnitario|precioLista|precio_final|precio_lista|subtotal|total|monto|precioEfectivo|subtotalEfectivo|totalEfectivo)$/;
export function importesDeHerramienta(value: unknown): number[] {
  const out: number[] = [];
  function visitar(x: any) {
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      if (CAMPOS_PRECIO.test(k) && typeof v === 'number' && Number.isFinite(v)) out.push(centavos(v));
      else if (typeof v === 'object') visitar(v);
    }
  }
  visitar(value); return out;
}
export function importesDelTexto(texto: string): number[] {
  return [...texto.matchAll(/\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g)]
    .map(m => centavos(Number(m[1].replace(/\./g, '').replace(',', '.'))));
}
export function idWhatsappCorto(id: unknown): string {
  const t = String(id ?? '').trim();
  return t.split('_').pop() ?? t;
}
