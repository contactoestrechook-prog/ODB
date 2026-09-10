// Qué se le pide al modelo para decidir si una foto sirve para la tienda, y
// cómo se lee lo que contesta. Aparte del servicio para poder probarlo solo.
//
// Pedido de Leandro (10/9/2026): «veo muchas fotos que no son foto de producto,
// son fotos malísimas; fijate si las podés detectar y dar de baja».
//
// La primera versión del pedido salió mal: al decirle que era «una tienda de
// vinos y almacén», el modelo rechazaba una lámpara LED y un huevo Kinder por
// no ser vino. El pedido tiene que hablar SOLO de la foto, nunca del producto.

export const INSTRUCCION = [
  'Mirás fotos de productos para una tienda online. Juzgá SOLO la calidad de la foto.',
  'NO juzgues qué producto es: cualquier rubro vale (limpieza, golosinas, bazar, bebidas, lo que sea).',
  'Que el producto no parezca caro, o sea infantil, o no combine con la tienda, NO es motivo para rechazarlo.',
  '',
  'SIRVE si el producto se ve completo y nítido, ocupando buena parte de la imagen, sobre un fondo liso',
  "(blanco o de cualquier color) o recortado. Los carteles gráficos de catálogo ('750 cc', el varietal,",
  "'sin TACC'), los fondos de color y los packs de varias unidades SIRVEN.",
  '',
  'NO SIRVE solo si pasa alguna de estas: se ve el lugar donde se sacó la foto (mesa de madera, mostrador,',
  'góndola, heladera, piso, pared); hay una mano o una persona; hay otros objetos alrededor que no son el',
  'producto; está borrosa, muy oscura o torcida; tiene marca de agua o el logo de otra tienda; es una captura',
  'de pantalla de una web; o el producto se ve tan chico o tapado que no se distingue.',
  '',
  'Respondé SOLO un JSON: {"sirve": true|false, "motivo": "<seis palabras como mucho>"}',
].join('\n');

export type Veredicto = { sirve: boolean; motivo: string };

// El modelo a veces envuelve el JSON en texto o en un bloque de código.
// Ante la duda, la foto SE QUEDA: borrar una foto buena es peor que dejar una fea.
export function leerVeredicto(texto: string | null | undefined): Veredicto {
  const t = texto ?? '';
  const desde = t.indexOf('{');
  const hasta = t.lastIndexOf('}');
  if (desde === -1 || hasta <= desde) return { sirve: true, motivo: 'no se pudo leer la respuesta' };
  try {
    const j = JSON.parse(t.slice(desde, hasta + 1));
    if (typeof j.sirve !== 'boolean') return { sirve: true, motivo: 'no se pudo leer la respuesta' };
    return { sirve: j.sirve, motivo: String(j.motivo ?? '').slice(0, 120) };
  } catch {
    return { sirve: true, motivo: 'no se pudo leer la respuesta' };
  }
}

// El tipo real de la imagen sale de sus primeros bytes: en Storage todas se
// llaman .jpg pero el catálogo externo manda webp y png.
export function tipoDeImagen(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).toString('binary') === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const gif = b.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  return null;
}
