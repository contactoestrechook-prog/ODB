import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

// Todas las fotos de la tienda con la misma medida y el mismo margen.
//
// Pedido de Leandro (11/9/2026): «tenés que hacer un trabajo foto por foto,
// achicar, agrandar, para que queden todas simétricas con el recuadro». Las
// fotos llegan de mil fuentes: una botella ocupa toda la imagen, otra es un
// punto en el medio de un fondo blanco enorme, una caja viene apaisada. En la
// grilla eso se ve desparejo aunque el recuadro sea el mismo.
//
// Qué hace, siempre igual:
//   1. endereza la foto según su EXIF y la aplana sobre blanco (las PNG/WebP
//      con transparencia quedaban con fondo negro o gris);
//   2. recorta el blanco sobrante alrededor del producto;
//   3. lo escala para que ocupe el OCUPA del lado que manda (alto en una
//      botella, ancho en una caja), agrandando si hace falta;
//   4. lo centra en un lienzo blanco de 1000×1250 (4:5, la medida de la tarjeta).
export const LIENZO = { ancho: 1000, alto: 1250 };
export const OCUPA = 0.84;
/** Qué tan blanco tiene que ser un píxel para considerarlo fondo al recortar. */
const UMBRAL_FONDO = 24;

export type FotoNormalizada = {
  buffer: Buffer;
  recortada: boolean;
  original: { ancho: number; alto: number };
  producto: { ancho: number; alto: number };
};

export async function normalizarFoto(entrada: Buffer): Promise<FotoNormalizada> {
  const plano = await sharp(entrada, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toBuffer({ resolveWithObject: true });
  const original = { ancho: plano.info.width, alto: plano.info.height };

  // Recortar el blanco. Si la imagen es casi toda blanca, o el recorte deja algo
  // ridículo, se usa entera: mejor una foto con margen que un producto mutilado.
  let recorte = plano.data;
  let recortada = false;
  try {
    const t = await sharp(plano.data).trim({ background: '#ffffff', threshold: UMBRAL_FONDO }).toBuffer({ resolveWithObject: true });
    const suficiente = t.info.width >= 12 && t.info.height >= 12;
    if (suficiente) {
      recorte = t.data;
      recortada = t.info.width < original.ancho || t.info.height < original.alto;
    }
  } catch {
    // sharp tira error si no queda nada después de recortar: foto toda blanca
  }

  const producto = await sharp(recorte)
    .resize({
      width: Math.round(LIENZO.ancho * OCUPA),
      height: Math.round(LIENZO.alto * OCUPA),
      fit: 'inside',
      withoutEnlargement: false,
      kernel: 'lanczos3',
    })
    .toBuffer({ resolveWithObject: true });

  const buffer = await sharp({ create: { width: LIENZO.ancho, height: LIENZO.alto, channels: 3, background: '#ffffff' } })
    .composite([
      {
        input: producto.data,
        left: Math.round((LIENZO.ancho - producto.info.width) / 2),
        top: Math.round((LIENZO.alto - producto.info.height) / 2),
      },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  return { buffer, recortada, original, producto: { ancho: producto.info.width, alto: producto.info.height } };
}

// Registro de una foto recién normalizada al guardarla (ficha o catálogo
// externo). Vive acá y no en el servicio del lote: catalogo.service la usa, y
// si importara el servicio (que a su vez importa CatalogoService) quedaba una
// referencia circular que Nest resuelve como `undefined` al arrancar.
export async function anotarNormalizada(
  db: SupabaseClient,
  sku: string,
  n: { recortada: boolean; original: { ancho: number; alto: number } },
  productoId?: string | null,
) {
  await db.from('fotos_normalizadas').upsert({
    sku, producto_id: productoId ?? null, ancho_original: n.original.ancho, alto_original: n.original.alto, recortada: n.recortada,
  });
}
