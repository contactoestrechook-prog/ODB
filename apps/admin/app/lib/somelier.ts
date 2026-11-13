// El Somelier del panel (13/11/2026), la parte que no dibuja: los filtros, lo
// que se entiende de lo que escribe el vendedor, el orden de la cava según la
// ocasión y el texto para mandarle al cliente por WhatsApp. Todo corre en el
// navegador, al instante: el somelier (la IA) elige después entre los vinos
// que quedan arriba de esta lista. Pruebas: apps/api/src/sommelier/somelier-panel.spec.ts.

export type TipoVino = 'tinto' | 'blanco' | 'rosado' | 'espumante' | 'otro';

/** Un vino de la cava, como lo manda el API (apps/api/src/sommelier/cava.ts). */
export type VinoCava = {
  sku: string;
  nombre: string;
  bodega: string | null;
  categoria: string | null;
  tipo: TipoVino;
  cepa: string | null;
  dulce: boolean;
  descripcion: string | null;
  maridaje: string | null;
  precio: number;
  precioEfectivo: number | null;
  promo: { nombre: string; antes: number } | null;
  stock: Record<string, number>;
  vendidas: number;
};

export type CavaPanel = { sucursales: { id: string; nombre: string }[]; vinos: VinoCava[]; generada: string };

/** Un vino que recomendó el somelier (apps/api/src/sommelier/vinos-recomendados.ts). */
export type VinoRecomendado = {
  sku: string;
  nombre: string;
  categoria: string | null;
  precio: number;
  precioEfectivo: number | null;
  promo: { nombre: string; antes: number } | null;
  porque: string;
};

// ------------------------------------------------------------
// Los filtros
// ------------------------------------------------------------

export type Ocasion = 'asado' | 'pastas' | 'pescado' | 'sushi' | 'picada' | 'pollo' | 'postre' | 'brindis' | 'regalo' | 'aperitivo';
/** Tinto, blanco, rosado y espumante; «dulce» es aparte (cosecha tardía, espumantes dulces). */
export type Estilo = 'tinto' | 'blanco' | 'rosado' | 'espumante' | 'dulce';
export type Orden = 'recomendar' | 'barato' | 'caro' | 'stock';

export type Filtros = {
  ocasion: Ocasion | null;
  estilos: Estilo[];
  cepas: string[];
  precioMin: number | null;
  precioMax: number | null;
  soloPromo: boolean;
  texto: string;
};

export const SIN_FILTROS: Filtros = { ocasion: null, estilos: [], cepas: [], precioMin: null, precioMax: null, soloPromo: false, texto: '' };

export const OCASIONES: { valor: Ocasion; nombre: string; frase: string }[] = [
  { valor: 'asado', nombre: 'Asado', frase: 'para un asado' },
  { valor: 'pastas', nombre: 'Pastas y pizza', frase: 'para pastas o pizza' },
  { valor: 'picada', nombre: 'Picada y quesos', frase: 'para una picada' },
  { valor: 'pollo', nombre: 'Pollo y cerdo', frase: 'para pollo o cerdo' },
  { valor: 'pescado', nombre: 'Pescados', frase: 'para pescados o mariscos' },
  { valor: 'sushi', nombre: 'Sushi', frase: 'para sushi' },
  { valor: 'postre', nombre: 'Postre', frase: 'para el postre' },
  { valor: 'brindis', nombre: 'Brindis', frase: 'para brindar' },
  { valor: 'aperitivo', nombre: 'Para tomar solo', frase: 'para tomar solo o de aperitivo' },
  { valor: 'regalo', nombre: 'Regalo', frase: 'para regalar' },
];

export const ESTILOS: { valor: Estilo; nombre: string; plural: string }[] = [
  { valor: 'tinto', nombre: 'Tinto', plural: 'Tintos' },
  { valor: 'blanco', nombre: 'Blanco', plural: 'Blancos' },
  { valor: 'rosado', nombre: 'Rosado', plural: 'Rosados' },
  { valor: 'espumante', nombre: 'Espumante', plural: 'Espumantes' },
  { valor: 'dulce', nombre: 'Dulce', plural: 'Dulces' },
];

/** Los tramos de precio de la barra (el último no tiene techo). */
export const TRAMOS_PRECIO: { min: number | null; max: number | null; nombre: string; corto: string }[] = [
  { min: null, max: 10_000, nombre: 'Hasta $10.000', corto: 'hasta 10 mil' },
  { min: 10_000, max: 20_000, nombre: '$10.000 a $20.000', corto: '10 a 20 mil' },
  { min: 20_000, max: 40_000, nombre: '$20.000 a $40.000', corto: '20 a 40 mil' },
  { min: 40_000, max: 80_000, nombre: '$40.000 a $80.000', corto: '40 a 80 mil' },
  { min: 80_000, max: null, nombre: 'Más de $80.000', corto: 'más de 80 mil' },
];

export const tramoDe = (precio: number) => TRAMOS_PRECIO.findIndex((t) => (t.min == null || precio >= t.min) && (t.max == null || precio < t.max));

/** El estilo de un vino para los filtros: los dulces van aparte. */
export const estiloDe = (v: Pick<VinoCava, 'tipo' | 'dulce'>): Estilo | null => (v.dulce ? 'dulce' : v.tipo === 'otro' ? null : v.tipo);

// ------------------------------------------------------------
// Lo que se entiende de lo que escribe el vendedor
// ------------------------------------------------------------

export const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PALABRAS_OCASION: Record<Ocasion, RegExp> = {
  asado: /\b(asados?|parrill\w*|carnes?( roja)?s?|vacio|costillar|achuras|chorizos?|cordero|bife|ojo de bife|entrana|matambre|chivito)\b/,
  pastas: /\b(pastas?|fideos|ravioles|sorrentinos|lasagn?as?|noquis|tallarines|pizzas?|salsa|bolognesa|tuco|risotto|guisos?|lentejas|locro|empanadas?)\b/,
  picada: /\b(picadas?|quesos?|fiambres?|tablas?|embutidos?|tapas|jamon|salame)\b/,
  pollo: /\b(pollo|pollos|cerdo|bondiola|matambrito|pavo|aves?|pato|milanesas?|cerdito|lechon)\b/,
  pescado: /\b(pescados?|mariscos?|frutos de mar|salmon|merluza|trucha|langostinos?|camarones|rabas|paella|ceviche|atun|mejillones|pulpo)\b/,
  sushi: /\b(sushi|japones\w*|oriental|asiatic\w*|thai|wok|poke|ceviche nikkei)\b/,
  postre: /\b(postres?|chocolates?|tortas?|tartas?|helados?|frutillas|dulce de leche|flan|tiramisu)\b/,
  brindis: /\b(brindis|brindar|festej\w*|celebr\w*|cumple(anos)?s?|aniversario|casamiento|fiesta|ano nuevo|navidad|fin de ano|despedida)\b/,
  aperitivo: /\b(aperitivo|para tomar solo|tomar solo|de tarde|pileta|terraza|verano|fresquito|previa|after)\b/,
  regalo: /\b(regal\w*|obsequio|quedar bien|especial|jefe|suegr[oa])\b/,
};

const PALABRAS_ESTILO: Record<Estilo, RegExp> = {
  tinto: /\b(tintos?)\b/,
  blanco: /\b(blancos?)\b/,
  rosado: /\b(rosados?|rose)\b/,
  espumante: /\b(espumantes?|champa(gne|na)s?|burbujas|brut|nature|bubbles)\b/,
  dulce: /\b(dulces?|cosecha tardia|tardio|late harvest|moscatel)\b/,
};

/** Un número de plata como lo escribe la gente: «15.000», «15 mil», «15k», «15 lucas», «20» (= 20 mil). */
function plata(numero: string, unidad?: string): number | null {
  const n = Number(numero.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unidad && /^(mil|k|lucas?|luca)$/.test(unidad)) return Math.round(n * 1000);
  // «hasta 20» o «unos 25»: en vinos son miles de pesos
  if (n < 1000) return Math.round(n * 1000);
  return Math.round(n);
}

const NUM = String.raw`\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil|k|lucas?|luca)?\b`;

/**
 * Lo que dice el texto del vendedor sobre lo que busca el cliente: la
 * ocasión, el tipo, la cepa y la plata. Lo que no dice queda afuera (null o
 * vacío) y no pisa los filtros que ya estaban.
 */
export function interpretar(texto: string, cepasConocidas: string[] = []): Partial<Filtros> {
  const t = ` ${normal(texto)} `;
  const salida: Partial<Filtros> = {};

  const ocasion = (Object.keys(PALABRAS_OCASION) as Ocasion[]).find((o) => PALABRAS_OCASION[o].test(t));
  if (ocasion) salida.ocasion = ocasion;

  const estilos = (Object.keys(PALABRAS_ESTILO) as Estilo[]).filter((e) => PALABRAS_ESTILO[e].test(t));
  // «brut» o «nature» ya dicen espumante; «blanco dulce» queda en dulce
  if (estilos.length) salida.estilos = estilos.includes('dulce') ? ['dulce'] : estilos;

  const cepas = cepasConocidas.filter((c) => {
    const n = normal(c);
    if (n.length < 4 || /^(corte|importado|otras cepas|rose|brut rose)$/.test(n)) return false;
    return t.includes(` ${n} `) || t.includes(` ${n},`) || t.includes(` ${n}.`) || t.includes(` ${n}?`);
  });
  // «cabernet» solo, sin franc ni sauvignon: los dos
  if (/\bcabernet\b/.test(t) && !cepas.some((c) => /cabernet/i.test(c))) cepas.push(...cepasConocidas.filter((c) => /cabernet/i.test(c)));
  if (/\b(blend|corte)\b/.test(t)) cepas.push(...cepasConocidas.filter((c) => /^corte$/i.test(c)));
  if (cepas.length) salida.cepas = [...new Set(cepas)];

  const entre = new RegExp(String.raw`\b(?:entre|de)\s+${NUM}\s+(?:y|a)\s+${NUM}`).exec(t);
  const hasta = new RegExp(String.raw`\b(?:hasta|menos de|no mas de|maximo|max|tope de|tope|por debajo de|abajo de|que no pase de|no pasar de)\s+${NUM}`).exec(t);
  const desde = new RegExp(String.raw`\b(?:mas de|desde|arriba de|minimo|por encima de|no menos de)\s+${NUM}`).exec(t);
  const cerca = new RegExp(String.raw`\b(?:unos|alrededor de|cerca de|tipo|por|de|a)\s+${NUM}`).exec(t);
  if (entre) {
    // «entre 10 y 20 mil»: el «mil» del segundo vale para los dos
    const a = plata(entre[1], entre[2] ?? entre[4]);
    const b = plata(entre[3], entre[4]);
    if (a && b) { salida.precioMin = Math.min(a, b); salida.precioMax = Math.max(a, b); }
  } else {
    if (hasta) { const v = plata(hasta[1], hasta[2]); if (v) salida.precioMax = v; }
    if (desde) { const v = plata(desde[1], desde[2]); if (v) salida.precioMin = v; }
    if (!hasta && !desde && cerca) {
      const v = plata(cerca[1], cerca[2]);
      const crudo = Number(cerca[1].replace(/[.,]/g, ''));
      // «unos 20 mil»: un cuarto para cada lado. Solo si de verdad es plata:
      // «una caja de 6» o «somos 8» no son precios
      if (v && v >= 3000 && (cerca[2] || /\$/.test(cerca[0]) || crudo >= 1000)) {
        salida.precioMin = Math.round((v * 0.75) / 500) * 500;
        salida.precioMax = Math.round((v * 1.25) / 500) * 500;
      }
    }
  }
  if (/\b(en promo|con promo|ofertas?|promocion|promociones|lo que este en promo)\b/.test(t)) salida.soloPromo = true;
  return salida;
}

/** Junta lo que se entendió con los filtros que había (lo nuevo manda). */
export function sumarFiltros(antes: Filtros, nuevo: Partial<Filtros>): Filtros {
  const f = { ...antes };
  if (nuevo.ocasion !== undefined) f.ocasion = nuevo.ocasion;
  if (nuevo.estilos?.length) f.estilos = nuevo.estilos;
  if (nuevo.cepas?.length) f.cepas = nuevo.cepas;
  if (nuevo.precioMin !== undefined || nuevo.precioMax !== undefined) {
    f.precioMin = nuevo.precioMin ?? null;
    f.precioMax = nuevo.precioMax ?? null;
  }
  if (nuevo.soloPromo) f.soloPromo = true;
  return f;
}

// ------------------------------------------------------------
// El orden de la cava
// ------------------------------------------------------------

/** Cuánto le sienta cada estilo a cada ocasión (-3 a +4). */
const AFINIDAD: Record<Ocasion, Partial<Record<Estilo, number>>> = {
  asado: { tinto: 4, rosado: 0, blanco: -2, espumante: -2, dulce: -4 },
  pastas: { tinto: 3, rosado: 1, blanco: 1, espumante: -1, dulce: -4 },
  picada: { tinto: 2, rosado: 2, blanco: 1, espumante: 2, dulce: -2 },
  pollo: { blanco: 3, rosado: 2, tinto: 1, espumante: 1, dulce: -3 },
  pescado: { blanco: 4, espumante: 2, rosado: 2, tinto: -2, dulce: -3 },
  sushi: { espumante: 4, blanco: 3, rosado: 2, tinto: -3, dulce: -2 },
  postre: { dulce: 5, espumante: 1, tinto: -2, blanco: -2, rosado: -1 },
  brindis: { espumante: 5, rosado: 1, blanco: 0, tinto: -1, dulce: 0 },
  aperitivo: { espumante: 3, rosado: 3, blanco: 3, tinto: -1, dulce: 0 },
  regalo: { tinto: 2, espumante: 2, blanco: 0, rosado: 0, dulce: 0 },
};

/** Cepas que van mejor con cada ocasión (suman un poco, nunca mandan). */
const CEPA_IDEAL: Partial<Record<Ocasion, RegExp>> = {
  asado: /malbec|cabernet sauvignon|corte|tannat|syrah|petit verdot|cabernet franc/,
  pastas: /bonarda|merlot|corte|sangiovese|malbec|pinot/,
  pollo: /chardonnay|pinot noir|viognier|torront/,
  pescado: /sauvignon blanc|chardonnay|torront|viognier|extra brut|brut nature/,
  sushi: /extra brut|brut nature|sauvignon blanc|torront|rose/,
  aperitivo: /rose|torront|sauvignon blanc|extra brut/,
};

/** Palabras de la ficha que suman para cada ocasión. */
const FICHA_OCASION: Record<Ocasion, RegExp> = {
  asado: /asado|parrilla|carnes? (rojas|asadas|a la)|carnes|cordero|costillar|achuras|chorizo/g,
  pastas: /pastas?|pizza|salsa|tomate|guiso|risotto|lasagn/g,
  picada: /picada|quesos?|fiambres?|embutidos|tabla|jamon/g,
  pollo: /pollo|cerdo|aves?|bondiola|carnes blancas|pavo/g,
  pescado: /pescados?|mariscos|frutos de mar|salmon|trucha|langostinos|ceviche/g,
  sushi: /sushi|japones|oriental|asiatic|ceviche|salmon/g,
  postre: /postres?|chocolate|frutas|tarta|dulce/g,
  brindis: /brindis|brindar|festej|celebra|ocasiones especiales|fiesta/g,
  aperitivo: /aperitivo|solo|tarde|terraza|verano|fresco|refrescante/g,
  regalo: /regal|especial|guarda|elegante|complejo|gran reserva|reserva|icono|single vineyard/g,
};

export type VinoOrdenado = { vino: VinoCava; puntos: number; aca: number; otro: number };

/** Las unidades del vino en el local elegido (o en todos) y en los otros. */
export function stockDe(v: VinoCava, sucursal: string): { aca: number; otro: number } {
  const total = Object.values(v.stock).reduce((a, b) => a + b, 0);
  if (!sucursal) return { aca: total, otro: 0 };
  const aca = v.stock[sucursal] ?? 0;
  return { aca, otro: total - aca };
}

/** ¿El vino pasa los filtros? (el stock del local se mira aparte) */
export function pasa(v: VinoCava, f: Filtros): boolean {
  const estilo = estiloDe(v);
  if (f.estilos.length && (!estilo || !f.estilos.includes(estilo))) return false;
  if (f.cepas.length && (!v.cepa || !f.cepas.includes(v.cepa))) return false;
  if (f.precioMin != null && v.precio < f.precioMin) return false;
  if (f.precioMax != null && v.precio > f.precioMax) return false;
  if (f.soloPromo && !v.promo) return false;
  if (f.texto.trim()) {
    const ficha = normal(`${v.nombre} ${v.bodega ?? ''} ${v.categoria ?? ''} ${v.sku}`);
    if (!normal(f.texto).split(/\s+/).filter(Boolean).every((p) => ficha.includes(p))) return false;
  }
  return true;
}

/**
 * Los puntos para recomendar: lo que le sienta a la ocasión (el estilo, la
 * cepa y lo que dice su ficha), y para desempatar la promo, el stock del local
 * y lo que se vende. Sin ocasión, manda lo que conviene mover.
 */
export function puntos(v: VinoCava, f: Filtros, aca: number, vendidasTope: number): number {
  let p = 0;
  const estilo = estiloDe(v);
  if (f.ocasion) {
    p += estilo ? AFINIDAD[f.ocasion][estilo] ?? 0 : 0;
    const cepa = normal(v.cepa ?? '');
    if (cepa && CEPA_IDEAL[f.ocasion]?.test(cepa)) p += 1;
    const ficha = normal(`${v.descripcion ?? ''} ${v.maridaje ?? ''} ${v.nombre}`);
    const hits = ficha.match(FICHA_OCASION[f.ocasion])?.length ?? 0;
    p += Math.min(hits, 2) * 1.5;
    if (f.ocasion === 'regalo') p += v.precio >= 40_000 ? 1.5 : v.precio >= 25_000 ? 1 : v.precio < 12_000 ? -1 : 0;
  }
  if (v.promo) p += 1.5;
  p += aca >= 24 ? 1 : aca >= 12 ? 0.75 : aca >= 6 ? 0.4 : aca <= 1 ? -0.5 : 0;
  if (vendidasTope > 0 && v.vendidas > 0) p += 1.2 * Math.sqrt(v.vendidas / vendidasTope);
  return Math.round(p * 100) / 100;
}

/** La cava filtrada y ordenada para el local elegido (solo lo que hay ahí). */
export function ordenar(vinos: VinoCava[], f: Filtros, sucursal: string, orden: Orden): VinoOrdenado[] {
  const vendidasTope = vinos.reduce((m, v) => Math.max(m, v.vendidas), 0);
  const salida: VinoOrdenado[] = [];
  for (const v of vinos) {
    const { aca, otro } = stockDe(v, sucursal);
    if (aca <= 0 || !pasa(v, f)) continue;
    salida.push({ vino: v, aca, otro, puntos: orden === 'recomendar' ? puntos(v, f, aca, vendidasTope) : 0 });
  }
  const porNombre = (a: VinoOrdenado, b: VinoOrdenado) => a.vino.nombre.localeCompare(b.vino.nombre, 'es');
  if (orden === 'barato') salida.sort((a, b) => a.vino.precio - b.vino.precio || porNombre(a, b));
  else if (orden === 'caro') salida.sort((a, b) => b.vino.precio - a.vino.precio || porNombre(a, b));
  else if (orden === 'stock') salida.sort((a, b) => b.aca - a.aca || porNombre(a, b));
  else salida.sort((a, b) => b.puntos - a.puntos || b.aca - a.aca || a.vino.precio - b.vino.precio);
  return salida;
}

// ------------------------------------------------------------
// En palabras: para el somelier, para la pantalla y para el cliente
// ------------------------------------------------------------

const miles = (n: number) => n.toLocaleString('es-AR');
// como pesos() del panel: «$25.000»
export const precioCorto = (n: number) => `$${miles(n)}`;

/** El precio en palabras: «hasta $20.000», «$10.000 a $20.000», «desde $40.000». */
export function rangoPrecio(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `${precioCorto(min)} a ${precioCorto(max)}`;
  if (max != null) return `hasta ${precioCorto(max)}`;
  if (min != null) return `desde ${precioCorto(min)}`;
  return null;
}

/** Lo que busca el cliente, en una línea: «Para un asado · Tinto · Malbec · hasta $20.000». */
export function enPalabras(f: Filtros): string {
  const partes: string[] = [];
  const o = OCASIONES.find((x) => x.valor === f.ocasion);
  if (o) partes.push(o.frase[0].toUpperCase() + o.frase.slice(1));
  if (f.estilos.length) partes.push(f.estilos.map((e) => ESTILOS.find((x) => x.valor === e)?.nombre ?? e).join(' o '));
  if (f.cepas.length) partes.push(f.cepas.join(' o '));
  const r = rangoPrecio(f.precioMin, f.precioMax);
  if (r) partes.push(r);
  if (f.soloPromo) partes.push('en promo');
  if (f.texto.trim()) partes.push(`que diga «${f.texto.trim()}»`);
  return partes.join(' · ');
}

/** El pedido armado con los filtros, para el botón «Que elija el somelier». */
export function pedidoDeFiltros(f: Filtros, local: string | null): string {
  const que = enPalabras(f);
  const donde = local ? ` en ${local}` : '';
  return que ? `Elegime 3 vinos. Busca: ${que}${donde}.` : `Elegime 3 vinos variados para recomendar hoy${donde}.`;
}

/**
 * El mensaje para el cliente por WhatsApp: un vino por renglón con su precio
 * (y el de efectivo o transferencia), y el porqué si lo hay. Sin emojis, como
 * escribe ODB.
 */
export function textoParaCliente(vinos: { nombre: string; precio: number; precioEfectivo: number | null; promo?: { nombre: string } | null; porque?: string }[], intro?: string): string {
  const renglones = vinos.map((v) => {
    const efectivo = v.precioEfectivo != null && v.precioEfectivo < v.precio ? ` (${precioCorto(v.precioEfectivo)} en efectivo o transferencia)` : '';
    const promo = v.promo ? ` · promo ${v.promo.nombre}` : '';
    const porque = v.porque?.trim() ? `\n  ${v.porque.trim()}` : '';
    return `• ${v.nombre}: ${precioCorto(v.precio)}${efectivo}${promo}${porque}`;
  });
  return [intro?.trim() || (vinos.length === 1 ? 'Te paso esta opción:' : `Te paso ${vinos.length} opciones:`), ...renglones].join('\n');
}
