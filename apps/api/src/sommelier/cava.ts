// La cava entera para el Somelier del panel (13/11/2026). Leandro, mirando el
// Somelier: «es una cagada el somelier, ¿no?». El de antes veía los 80 vinos
// con más stock sumando los dos locales (de unos 1.430 con stock) y no sabía en
// qué local estaba cada uno. Ahora el panel recibe la cava entera, por local,
// y el vendedor la filtra al instante; al somelier le llegan los vinos que el
// vendedor está mirando.

export type TipoVino = 'tinto' | 'blanco' | 'rosado' | 'espumante' | 'otro';

export type VinoCava = {
  sku: string;
  nombre: string;
  /** La marca cargada (casi siempre la bodega). */
  bodega: string | null;
  /** La categoría tal cual está en la base: es la verdad del tipo. */
  categoria: string | null;
  tipo: TipoVino;
  /** La cepa o el estilo que dice la categoría: Malbec, Corte, Extra Brut… */
  cepa: string | null;
  dulce: boolean;
  descripcion: string | null;
  /** El maridaje de la nota de cata, si ya se escribió. */
  maridaje: string | null;
  /** Precio final (con la promo, si hay). */
  precio: number;
  /** Pagando en efectivo o transferencia; null si no corre. */
  precioEfectivo: number | null;
  promo: { nombre: string; antes: number } | null;
  /** Unidades por sucursal (id → cantidad), solo las que tienen. */
  stock: Record<string, number>;
  /** Las unidades vendidas que guarda el producto (para desempatar). */
  vendidas: number;
};

export type CavaPanel = {
  sucursales: { id: string; nombre: string }[];
  vinos: VinoCava[];
  /** Cuándo se armó (la cava se guarda unos minutos). */
  generada: string;
};

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * El tipo, la cepa y si es dulce, leídos de la categoría de la base:
 * «Vinos Tintos Malbec» → tinto, Malbec; «Espumantes Extra Brut» → espumante,
 * Extra Brut; «Vinos Blancos Dulces» → blanco, dulce.
 */
export function tipoDeCategoria(categoria: string | null | undefined): { tipo: TipoVino; cepa: string | null; dulce: boolean } {
  const limpia = String(categoria ?? '').replace(/\s+/g, ' ').trim();
  const c = sinTildes(limpia).toLowerCase();
  let tipo: TipoVino = 'otro';
  let resto = limpia;
  const quitar = (re: RegExp) => { resto = limpia.replace(re, '').trim(); };
  if (/^espumantes?\b|^champa(gne|na)\b/.test(c)) { tipo = 'espumante'; quitar(/^(espumantes?|champa(gne|ña|na))\s*/i); }
  else if (/^vinos? tintos?\b/.test(c)) { tipo = 'tinto'; quitar(/^vinos?\s+tintos?\s*/i); }
  else if (/^vinos? blancos?\b/.test(c)) { tipo = 'blanco'; quitar(/^vinos?\s+blancos?\s*/i); }
  else if (/^vinos? rosados?\b/.test(c)) { tipo = 'rosado'; quitar(/^vinos?\s+rosados?\s*/i); }
  else quitar(/^vinos?\s*/i);
  const dulce = /\bdulces?\b/i.test(sinTildes(resto));
  // «Dulces» es el estilo, no la cepa; «Rose» en espumantes se escribe Rosé
  let cepa: string | null = dulce ? null : resto || null;
  if (cepa) {
    cepa = cepa
      .replace(/^Rose$/i, 'Rosé').replace(/^Brut Rose$/i, 'Brut Rosé')
      .replace(/Viogner/i, 'Viognier').replace(/Torrontes/i, 'Torrontés')
      .replace(/^Importados$/i, 'Importado');
  }
  return { tipo, cepa, dulce };
}

/** El nombre de la sucursal para mostrar: «Suc Santa Ines» → «Santa Inés». */
export function nombreDeSucursal(nombre: string): string {
  return String(nombre ?? '')
    .replace(/^suc(ursal)?\.?\s+/i, '')
    .replace(/\bInes\b/, 'Inés')
    .trim();
}
