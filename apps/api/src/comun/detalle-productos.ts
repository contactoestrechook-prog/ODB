// Detalle de productos con el paquete gráfico "Placa roja" (2/10/2026). Pedido
// de Leandro: "siempre que se detallen productos vamos a usar el paquete
// gráfico de pedidos y lista de precio". En WhatsApp son las imágenes de
// cartel-pedido.ts; en el panel, el componente <PlacaRoja> del kit, que recibe
// un DetallePlaca ya armado (el panel solo lo dibuja).
//
// Los agentes del panel escriben texto. Cuando en la respuesta hay una lista de
// productos que el agente CONSULTÓ en sus herramientas, esos renglones salen
// del texto y van a la placa, con los datos del sistema (no los que escribió).

import { normalizarTexto } from './busqueda';

export type RenglonDetalle = {
  clave: string;
  /** El círculo rojo: lo que hay que pedir, lo que se pidió… */
  cantidad?: number | null;
  nombre: string;
  /** Línea gris (stock, ritmo, código). */
  detalle?: string;
  /** Línea roja (la alerta, el precio en efectivo). */
  destacado?: string;
  /** A la derecha, ya formateado ("$4.321"). */
  importe?: string;
};

export type DetallePlaca = {
  titulo: string;
  sub?: string;
  renglones: RenglonDetalle[];
  total?: { etiqueta: string; valor: string };
  pie?: string;
};

/**
 * Un producto tal como lo devolvió una herramienta: tiene sku y nombre (o
 * "producto"). Un renglón costeado de una planilla no tiene sku: su clave es
 * "oferta:" + la descripción.
 */
export type ProductoVisto = { sku: string; nombre: string; fila: Record<string, unknown> };

const esOferta = (sku: string) => sku.startsWith('oferta:');

/** Junta los productos de cualquier resultado de herramienta (objetos con sku y nombre o producto, o renglones costeados). */
export function productosEnResultado(salida: unknown, tope = 600): ProductoVisto[] {
  const vistos: ProductoVisto[] = [];
  const recorrer = (v: unknown, profundidad: number) => {
    if (vistos.length >= tope || profundidad > 6 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) recorrer(x, profundidad + 1); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const nombre = o.nombre ?? o.producto;
    if (typeof o.sku === 'string' && o.sku && typeof nombre === 'string' && nombre) {
      vistos.push({ sku: o.sku, nombre, fila: o });
      return;
    }
    // un costeo de la mesa de compras (calcularCosto): descripción y costo real
    if (o.costoUnitarioReal != null && typeof o.descripcion === 'string' && o.descripcion) {
      vistos.push({ sku: `oferta:${o.descripcion}`, nombre: o.descripcion, fila: o });
      return;
    }
    for (const x of Object.values(o)) recorrer(x, profundidad + 1);
  };
  recorrer(salida, 0);
  return vistos;
}

// renglón de lista: "- ", "• ", "* ", "1. ", "1) "
const RE_ITEM = /^\s*(?:[-•*·–]|\d{1,2}[.)])\s+/;
const VACIAS = /^(cc|ml|lts?|litros?|kg|grs?|con|sin|de|del|la|el|los|las|y|o|en|por|para|unidad(?:es)?|botella|x)$/;

function palabrasDe(texto: string): string[] {
  const n = normalizarTexto(texto);
  return [...new Set([
    ...n.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d/.test(w) && !VACIAS.test(w)),
    // los números (la medida "750" de "x750cc", el "18" de un whisky): el
    // agente abrevia y es justo lo que distingue un producto del otro
    ...(n.match(/\d{2,4}/g) ?? []),
  ])];
}

/**
 * Qué renglones de la respuesta son productos consultados. De cada renglón de
 * lista se toma lo que nombra (hasta el primer ":", "—", "(" o ","): el agente
 * abrevia ("Cabrales Brasil 500g"), así que manda qué parte de lo que ESCRIBIÓ
 * está en el nombre del producto (tres cuartos, y al menos dos palabras). Si
 * dos productos encajan igual de bien, es ambiguo y queda en el texto. También
 * vale el SKU.
 */
export function renglonesDeProductos(respuesta: string, vistos: ProductoVisto[]): { indice: number; producto: ProductoVisto }[] {
  const lineas = String(respuesta ?? '').split('\n');
  const porSku = new Map<string, ProductoVisto>();
  for (const v of vistos) if (!porSku.has(v.sku)) porSku.set(v.sku, v);
  const candidatos = [...porSku.values()].map((p) => ({ p, ws: new Set(palabrasDe(p.nombre)), sku: normalizarTexto(p.sku) }));
  const salida: { indice: number; producto: ProductoVisto }[] = [];
  const usados = new Set<string>();
  lineas.forEach((linea, indice) => {
    if (!RE_ITEM.test(linea)) return;
    const t = normalizarTexto(linea);
    const nombrado = normalizarTexto(linea.replace(RE_ITEM, '').split(/:|\s[—–-]\s|\(|,/)[0]);
    const escritas = palabrasDe(nombrado);
    let mejor: { p: ProductoVisto; puntaje: number; parecido: number } | null = null;
    let empatados = 0;
    for (const c of candidatos) {
      if (usados.has(c.p.sku)) continue;
      const porSkuExacto = !esOferta(c.p.sku) && c.sku.length >= 4 && new RegExp(`(^|[^a-z0-9])${c.sku.replace(/[^a-z0-9]/g, '.')}([^a-z0-9]|$)`).test(t);
      const hits = escritas.filter((w) => c.ws.has(w)).length;
      const puntaje = porSkuExacto ? 2 : escritas.length ? hits / escritas.length : 0;
      if (!porSkuExacto && (puntaje < 0.75 || hits < 2)) continue;
      const parecido = c.ws.size ? hits / c.ws.size : 0;
      if (!mejor || puntaje > mejor.puntaje) { mejor = { p: c.p, puntaje, parecido }; empatados = 1; }
      else if (puntaje === mejor.puntaje) {
        empatados++;
        if (parecido > mejor.parecido) mejor = { p: c.p, puntaje, parecido };
      }
    }
    // "Cafe molido" encaja igual de bien en tres cafés: es ambiguo, queda en el texto
    if (mejor && (empatados === 1 || mejor.puntaje === 2)) { usados.add(mejor.p.sku); salida.push({ indice, producto: mejor.p }); }
  });
  return salida;
}

/** El texto sin los renglones que pasaron a la placa (y sin renglones vacíos repetidos). */
export function textoSinRenglones(respuesta: string, indices: number[]): string {
  const fuera = new Set(indices);
  return String(respuesta ?? '')
    .split('\n')
    .filter((_, i) => !fuera.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Lo que hacen todos los agentes del panel al terminar: si la respuesta detalla
 * 2 productos o más de los que consultaron, esos renglones van a la placa.
 * `armar` convierte los productos (con sus filas del sistema) en la placa.
 */
export function separarDetalle(
  respuesta: string,
  vistos: ProductoVisto[],
  armar: (productos: ProductoVisto[]) => DetallePlaca | null,
): { respuesta: string; detalle: DetallePlaca | null } {
  const hallados = renglonesDeProductos(respuesta, vistos);
  if (hallados.length < 2) return { respuesta, detalle: null };
  const detalle = armar(hallados.map((h) => h.producto));
  if (!detalle || !detalle.renglones.length) return { respuesta, detalle: null };
  const resto = textoSinRenglones(respuesta, hallados.map((h) => h.indice));
  return { respuesta: resto || 'Te lo dejo abajo.', detalle };
}

export const pesosPlaca = (n: unknown) =>
  n == null || n === '' || !Number.isFinite(Number(n)) ? undefined : '$' + Math.round(Number(n)).toLocaleString('es-AR');
