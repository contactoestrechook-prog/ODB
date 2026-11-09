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
