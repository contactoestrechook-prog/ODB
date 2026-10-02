// Los vinos que recomienda el somelier, además del texto (2/10/2026). Pedido de
// Leandro: "siempre que se detallen productos vamos a usar el paquete gráfico
// de pedidos y lista de precio". El somelier sigue escribiendo como siempre (la
// app de clientes muestra ese texto tal cual); el panel dibuja los vinos con la
// Placa roja, con los datos de la cava (precio, promo, efectivo) y no con los
// que escribió el modelo.
//
// Cuenta como recomendado el vino que el texto nombra junto a su precio: el
// mismo criterio que la imagen de precios del bot (preciosDeLaRespuesta), así
// dos vinos del mismo precio no se confunden. El porqué es lo que el somelier
// escribió de ese vino; lo demás (el saludo, la pregunta del final) queda como
// texto, antes o después de la placa.

import { preciosDeLaRespuesta, type ProductoConPrecio } from '../comun/cartel-pedido';
import { conDescuentoEfectivo, tieneDescuentoEfectivo } from '../bot/descuento-efectivo';

export type PromoVino = { nombre: string; antes: number };

/** Un vino de la cava que ve el somelier, con el precio ya redondeado como lo lee el modelo. */
export type VinoDeLaCava = {
  id: string;
  sku: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  stock: number;
  /** Precio final (con la promo, si hay). */
  precio: number;
  promo: PromoVino | null;
};

export type VinoRecomendado = {
  sku: string;
  nombre: string;
  categoria: string | null;
  /** Precio final (con la promo, si hay). */
  precio: number;
  /** Pagando en efectivo o transferencia (el descuento de vinos y espumantes); null si no corre. */
  precioEfectivo: number | null;
  /** La promo vigente y el precio de antes. */
  promo: PromoVino | null;
  /** Por qué lo recomienda, como lo escribió el somelier ('' si no lo dijo aparte). */
  porque: string;
};

export type RespuestaConVinos = {
  recomendaciones: VinoRecomendado[];
  /** El texto que va antes de los vinos (sin los renglones que pasaron a la placa). */
  introduccion: string;
  /** Lo que el somelier escribió después de los vinos (la pregunta del final). */
  cierre: string;
};

/**
 * El renglón de la cava tal como lo lee el modelo. Es el formato de siempre:
 * cambiarlo cambia lo que el somelier entiende de cada vino.
 */
export function lineaDeLaCava(v: VinoDeLaCava): string {
  const cat = v.categoria ? ` (${v.categoria})` : '';
  const promo = v.promo ? ` · PROMO "${v.promo.nombre}" (antes $${v.promo.antes})` : '';
  const desc = v.descripcion ? ` — ${v.descripcion}` : '';
  return `${v.sku} · ${v.nombre}${cat} · $${v.precio}${promo} · stock ${v.stock}${desc}`;
}

// renglón de lista: "- ", "• ", "* ", "1. ", "1) "
const RE_MARCA = /^\s*(?:[-•*·–]|\d{1,2}[.)])\s+/;
const palabras = (s: string) => s.split(/\s+/).filter((w) => /[a-záéíóúñü]{2,}/i.test(w)).length;
const esPregunta = (s: string) => /[?¿]/.test(s);
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿El pedazo nombra al vino? Con una palabra propia del nombre alcanza ("Esteco", "Torrontés"). */
function nombraAlVino(pedazo: string, nombre: string): boolean {
  const t = normal(pedazo);
  return normal(nombre)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^(vino|vinos|espumante|champagne|botella)$/.test(w) && !/^\d/.test(w))
    .some((w) => t.includes(w));
}

/** "$9.000" o "$9000", con o sin el punto de los miles, como lo escriba el modelo. */
function reDelPrecio(precio: number): RegExp {
  const conPuntos = String(Math.round(precio)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return new RegExp(`\\$\\s?${conPuntos.replace(/\./g, '\\.?')}(?![\\d])`);
}

/**
 * Sin lo que habla del precio (ya está en la placa: "(antes $10.000)", "o
 * $8.100 en efectivo") ni la puntuación que queda colgando. Otros importes
 * quedan ("para no pasar de $15.000" es parte del porqué).
 */
function limpiar(s: string): string {
  const t = s
    .replace(/\([^)]*(?:\$|\bantes\b|\bpromo|efectivo|transferencia)[^)]*\)/gi, '')
    .replace(/,?\s*(?:\bo\s+)?\$\s?[\d.]+\s+(?:pagando\s+)?en\s+efectivo(?:\s+o\s+transferencia)?/gi, '')
    .replace(/,?\s*\bantes\s+\$\s?[\d.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s)\].,;:—–-]+/, '')
    .replace(/[\s(,;:—–-]+$/, '')
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * El porqué dentro de la oración que nombra al vino: lo que sigue al precio
 * («Alamos Malbec ($9.000): fruta roja…») o, si el precio va al final, lo que
 * sigue al nombre («Alamos Malbec: fruta roja…, a $9.000»).
 */
function porqueDe(oracion: string, precio: number): string {
  const m = reDelPrecio(precio).exec(oracion);
  if (!m) return '';
  const antes = oracion.slice(0, m.index);
  let despues = oracion.slice(m.index + m[0].length);
  // el precio estaba entre paréntesis con algo más ("($9.000, en promo)"): eso es precio, no porqué
  if (antes.lastIndexOf('(') > antes.lastIndexOf(')') && despues.includes(')')) despues = despues.slice(despues.indexOf(')') + 1);
  const luego = limpiar(despues);
  if (palabras(luego) >= 2) return luego;
  const corte = antes.search(/:|\s[—–-]\s/);
  if (corte >= 0) {
    const medio = limpiar(antes.slice(corte + 1).replace(/\b(?:a|por|a solo|cuesta|sale|desde)\s*$/i, ''));
    if (palabras(medio) >= 2) return medio;
  }
  return luego;
}

/**
 * Separa de la respuesta los vinos recomendados. Una oración (o un renglón de
 * lista) que nombra UN vino con su precio es de ese vino, y también las
 * oraciones que la siguen en el mismo renglón, salvo una pregunta. Si una
 * oración nombra dos vinos juntos, no se puede partir: queda en el texto y los
 * vinos van a la placa sin porqué.
 */
export function vinosDeLaRespuesta(respuesta: string, cava: VinoDeLaCava[]): RespuestaConVinos {
  const texto = String(respuesta ?? '').trim();
  const sinVinos = { recomendaciones: [], introduccion: texto, cierre: '' };
  const catalogo: ProductoConPrecio[] = cava.filter((v) => v.precio > 0).map((v) => ({ sku: v.sku, nombre: v.nombre, precio: v.precio }));
  const nombrados = preciosDeLaRespuesta(texto, catalogo);
  if (!nombrados.length) return sinVinos;
  const porSku = new Map(cava.map((v) => [v.sku, v]));
  const elegidos = nombrados.map((n) => porSku.get(String(n.sku))).filter((v): v is VinoDeLaCava => !!v);
  const delTexto: ProductoConPrecio[] = elegidos.map((v) => ({ sku: v.sku, nombre: v.nombre, precio: v.precio }));

  const porque = new Map<string, string[]>(elegidos.map((v) => [v.sku, []]));
  const quedan: { pos: number; linea: number; texto: string }[] = [];
  let pos = 0;
  let ultimoVino = -1;
  // un vino nombrado sin porqué en su renglón: el renglón siguiente puede ser el porqué
  let pendiente: string | null = null;
  texto.split('\n').forEach((crudo, linea) => {
    const renglon = crudo.replace(RE_MARCA, '').trim();
    if (!renglon) { pendiente = null; return; }
    let abierto: string | null = pendiente && !RE_MARCA.test(crudo) ? pendiente : null;
    pendiente = null;
    for (const oracion of renglon.split(/(?<=[.!?])\s+/)) {
      pos++;
      const aca = preciosDeLaRespuesta(oracion, delTexto);
      if (aca.length === 1) {
        const sku = String(aca[0].sku);
        let delVino = oracion;
        // "Con sushi va muy bien un blanco fresco: el Esteco Torrontés, $14.900,
        // aromático…": lo de antes de los dos puntos presenta al vino, es texto
        const precioEn = reDelPrecio(aca[0].precio).exec(oracion);
        const dosPuntos = precioEn ? oracion.lastIndexOf(':', precioEn.index) : -1;
        if (precioEn && dosPuntos > 0 && palabras(oracion.slice(0, dosPuntos)) >= 3 && nombraAlVino(oracion.slice(dosPuntos + 1, precioEn.index), aca[0].nombre)) {
          quedan.push({ pos, linea, texto: oracion.slice(0, dosPuntos + 1).trim() });
          pos++;
          delVino = oracion.slice(dosPuntos + 1);
        }
        const p = porqueDe(delVino, aca[0].precio);
        if (p) porque.get(sku)?.push(p);
        abierto = sku;
        ultimoVino = pos;
        continue;
      }
      if (!aca.length && abierto && !esPregunta(oracion) && !/:\s*$/.test(oracion)) {
        const p = limpiar(oracion);
        if (p) porque.get(abierto)?.push(p);
        ultimoVino = pos;
        continue;
      }
      quedan.push({ pos, linea, texto: oracion });
      abierto = null;
    }
    if (abierto && !porque.get(abierto)?.length) pendiente = abierto;
  });

  const juntar = (partes: typeof quedan) => {
    let salida = '';
    let previa = -1;
    for (const p of partes) {
      if (previa === -1) salida = p.texto;
      else if (p.linea === previa) salida += ' ' + p.texto;
      else salida += (p.linea - previa > 1 ? '\n\n' : '\n') + p.texto;
      previa = p.linea;
    }
    return salida.trim();
  };

  return {
    recomendaciones: elegidos.map((v) => ({
      sku: v.sku,
      nombre: v.nombre,
      categoria: v.categoria,
      precio: v.precio,
      precioEfectivo: v.precio > 0 && tieneDescuentoEfectivo(v.categoria) ? conDescuentoEfectivo(v.precio) : null,
      promo: v.promo,
      porque: (porque.get(v.sku) ?? []).join(' ').trim(),
    })),
    // si ningún vino tuvo su renglón (dos en la misma oración), el texto queda entero
    introduccion: ultimoVino < 0 ? texto : juntar(quedan.filter((q) => q.pos < ultimoVino)),
    cierre: ultimoVino < 0 ? '' : juntar(quedan.filter((q) => q.pos > ultimoVino)),
  };
}
