// DOS COPIAS IDÉNTICAS (10/11/2026): apps/admin/app/lib/marca.ts (el control antes de
// registrar) y apps/api/src/listas/marca.ts (el lector). La API y el panel se
// compilan por separado en el servidor y cada uno necesita la suya. Una prueba
// (apps/api/src/listas/marca.spec.ts) falla si dejan de ser iguales: se cambian las dos.
// LA MARCA DE UN RENGLÓN (9/11/2026). El guardián de marca del vínculo por
// nombre tomaba la PRIMERA palabra del renglón como marca, y en «Alfajor Jorgito
// Chocolate Negro» la primera es «alfajor»: pasaba contra «Alfajor Cachafaz
// Chocolate Negro» y 18 Jorgito entraron como Cachafaz (Distri Sur
// 00007-00057487; lo mismo con Terrabusi). La marca es la primera palabra que
// NO dice qué tipo de producto es.

const TIPOS = new Set(
  ('alfajor alfajores galletita galletitas galleta galletas bizcocho bizcochos tostada tostadas budin pan panes ' +
    'yerba yerbas mate cafe te infusion vino vinos espumante sidra cerveza cervezas gaseosa gaseosas agua aguas jugo jugos bebida ' +
    'licor aperitivo whisky fernet vodka ron gin queso quesos leche leches yogur yogures manteca crema dulce mermelada ' +
    'aceite aceites vinagre arroz fideo fideos harina azucar sal salsa pure mayonesa ketchup mostaza aderezo ' +
    'chocolate chocolates bombon bombones caramelo caramelos chicle chicles pastilla pastillas turron bocadito bocaditos oblea obleas ' +
    'mani nachos papas snack snacks palitos chizitos conserva conservas atun arvejas choclo tomate tomates aceitunas ' +
    'jamon salame fiambre mortadela salchicha salchichas hamburguesa hamburguesas helado helados ' +
    'jabon detergente lavandina desinfectante limpiador suavizante shampoo acondicionador desodorante papel rollo bolsa bolsas bsa ' +
    'pack caja cajas tubo tira unidad unidades x').split(/\s+/),
);

const normalizar = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').toLowerCase();

/** La marca que nombra el renglón: la primera palabra de 3+ letras que no es un tipo de producto ni un número. */
export function marcaDelRenglon(descripcion: string): string | null {
  for (const p of normalizar(descripcion).split(/\s+/)) {
    if (p.length < 3 || /\d/.test(p) || TIPOS.has(p)) continue;
    return p;
  }
  return null;
}

/** ¿El producto del catálogo es de la marca que nombra el renglón? Sin marca reconocible, no frena. */
export function mismaMarca(descripcionProveedor: string, nombreProducto: string): boolean {
  const marca = marcaDelRenglon(descripcionProveedor);
  if (!marca) return true;
  return normalizar(nombreProducto).split(/\s+/).includes(marca);
}

// ============================================================
// LA PREGUNTA «¿ES EL MISMO PRODUCTO?» (19/11/2026). `mismaMarca` es estricta
// a propósito: la usa el lector para vincular solo, y ahí más vale no vincular.
// Para FRENAR a una persona antes de registrar era una máquina de falsas
// alarmas: del 10 al 19/11 Ana y Juan Pablo contestaron «está bien» 172 veces en
// 59 facturas porque el papel abrevia («MAY» = mayonesa, «GELAT», «FINL»), pone
// el singular («Garbanzo» contra «Garbanzos INCA»), el lector lee mal una letra
// («Macricas» = Macritas, «Hellmanns» = Hellmans) o la marca va al final
// («Nachos Rest. Style … Macricas»). Con tantas preguntas de mentira la de
// verdad (Jorgito vinculado a Cachafaz) se contesta igual, sin leer.
// Cómo decide:
//   1. Las palabras que pueden ser marca, en orden: 3+ letras, sin números, que
//      no son un tipo de producto (TIPOS) ni una unidad («grs», «cc»).
//   2. Si las dos empiezan con la MISMA palabra, es la misma marca (como hasta hoy).
//   3. Si empiezan con una parecida pero no igual («Garbanzo» / «Garbanzos INCA»,
//      «Raviol» / «Raviolones Furatti»), esa palabra es el tipo: se saltea en
//      los dos y se compara lo que sigue («Inca» / «INCA», «Furatti» no está).
//   4. Es otra marca solo si la marca del papel no aparece en el producto Y la
//      del producto tampoco aparece en el papel: con abreviaturas («gelat»), una
//      letra mal leída («Macricas»), «Mc Cain» separado o la sigla del proveedor
//      («LS» = La Serenísima, «DD» = Delicias Doradas, «CTC» = Citric).
// Se repasa con todo lo registrado: apps/api/scripts/repasar-marca.ts (falsas
// alarmas, y los vínculos mal hechos que una persona corrigió: esos tienen que
// seguir preguntándose).
// ============================================================

const palabras = (s: string) => normalizar(s).split(/\s+/).filter(Boolean);
const UNIDADES = new Set('gr grs grms gramos kg kgs kilo kilos cc ml lt lts ltr ltrs cm mm un uni und unid uds'.split(' '));
/** las palabras que pueden ser la marca, en orden */
const candidatas = (s: string) => palabras(s).filter((p) => p.length >= 3 && !/\d/.test(p) && !TIPOS.has(p) && !UNIDADES.has(p));

/** cambios de letra entre dos palabras (Levenshtein), cortando apenas pasa el tope */
function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(prev[j] + 1, fila[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (fila[j] < menor) menor = fila[j];
    }
    if (menor > tope) return tope + 1;
    prev = fila;
  }
  return prev[b.length];
}

/** ¿La palabra del papel es esta del producto? Igual, abreviada (el papel corta: «gelat»), o con una letra mal leída. */
function esLaMisma(delPapel: string, delProducto: string): boolean {
  if (delPapel === delProducto) return true;
  if (delPapel.length >= 3 && delProducto.length > delPapel.length && delProducto.startsWith(delPapel)) return true;
  const corta = Math.min(delPapel.length, delProducto.length);
  if (corta < 5) return false;
  return distancia(delPapel, delProducto, corta >= 8 ? 2 : 1) <= (corta >= 8 ? 2 : 1);
}

/** las palabras del texto y cada par de vecinas juntas («mc cain» → «mccain») */
const conVecinas = (s: string) => {
  const ws = palabras(s);
  return [...ws, ...ws.slice(1).map((w, i) => ws[i] + w)];
};

/** ¿Es una subsecuencia que arranca con la misma letra? «ctc» en «citric», «bct» en «bocatti» */
const subsecuencia = (corta: string, larga: string) => {
  if (!corta || corta[0] !== larga[0]) return false;
  let j = 0;
  for (const c of larga) if (c === corta[j]) j++;
  return j === corta.length;
};

/** ¿El papel nombra esta marca del producto, aunque sea con la sigla del proveedor? */
function papelNombra(descripcionProveedor: string, nombreProducto: string, suya: string): boolean {
  if (conVecinas(descripcionProveedor).some((w) => esLaMisma(w, suya))) return true;
  // la sigla: «LS» = «La Serenisima», «DD» = «Delicias Doradas», «LSNA», «CTC», «BG» (Baggio)
  // La sigla tiene que salir de la marca: de su palabra, o de «la»/«el»/«de» + la
  // marca («LSNA» de «La SereNisimA»), nunca de la palabra de al lado sola («LS»
  // de «Manteca LS ligth» no dice que «ligth» esté en el papel).
  const ws = palabras(nombreProducto);
  const k = ws.indexOf(suya);
  const previa = k > 0 && ws[k - 1].length <= 3 && /^[a-z]+$/.test(ws[k - 1]) ? ws[k - 1] : '';
  const iniciales = [previa ? previa[0] + suya[0] : '', k >= 0 && k + 1 < ws.length && /^[a-z]/.test(ws[k + 1]) ? suya[0] + ws[k + 1][0] : ''].filter(Boolean);
  return palabras(descripcionProveedor)
    .filter((t) => t.length >= 2 && t.length <= 4 && /^[a-z]+$/.test(t) && !UNIDADES.has(t) && t !== previa)
    .some((t) => iniciales.includes(t) || subsecuencia(t, suya) || (!!previa && t.length > previa.length && subsecuencia(t, previa + suya)));
}

/**
 * La marca que dice el papel cuando el producto vinculado es de OTRA (la que va
 * en la pregunta «el papel dice «jorgito»…»); null si es la misma o no se puede saber.
 */
export function marcaDistinta(descripcionProveedor: string, nombreProducto: string): string | null {
  let p = candidatas(descripcionProveedor), q = candidatas(nombreProducto);
  if (!p.length || !q.length) return null;
  if (p[0] === q[0]) return null;
  // empiezan con una palabra parecida pero no igual: es el tipo de producto, se compara lo que sigue
  if (esLaMisma(p[0], q[0]) || esLaMisma(q[0], p[0])) {
    p = p.slice(1); q = q.slice(1);
    if (!p.length || !q.length) return null;
  }
  const marca = p[0], suya = q[0];
  if (conVecinas(nombreProducto).some((w) => esLaMisma(marca, w))) return null;
  if (papelNombra(descripcionProveedor, nombreProducto, suya)) return null;
  return marca;
}

/** ¿«Antes de registrar» pregunta si es el mismo producto? Solo si ninguna de las dos marcas aparece en el otro texto. */
export const otraMarca = (descripcionProveedor: string, nombreProducto: string) => marcaDistinta(descripcionProveedor, nombreProducto) !== null;
