// Antes de subir la foto de una factura/remito: si es una imagen, la
// redimensiona y re-comprime en el navegador (canvas) a un tamaño que la IA
// lee perfecto y que sube rápido. Así una foto de celular de 12-20 MB queda en
// menos de 1 MB sin perder legibilidad, y de paso normaliza formatos raros
// (HEIC del iPhone, etc.) a JPG. Los PDF y cualquier no-imagen pasan tal cual:
// el servidor los acepta hasta 32 MB.
export async function prepararComprobante(archivo: File): Promise<File> {
  const esImagen =
    /^image\//.test(archivo.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(archivo.name);
  if (!esImagen) return archivo; // PDF u otro: sin tocar

  try {
    const bitmap = await cargarBitmap(archivo);
    const anchoOrig = 'width' in bitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth;
    const altoOrig = 'height' in bitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight;
    if (!anchoOrig || !altoOrig) return archivo;

    const MAX = 2200; // lado más largo: suficiente para leer la letra chica del pie
    const escala = Math.min(1, MAX / Math.max(anchoOrig, altoOrig));
    const w = Math.round(anchoOrig * escala);
    const h = Math.round(altoOrig * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;
    ctx.fillStyle = '#fff'; // fondo blanco por si el original tiene transparencia
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close();

    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob || blob.size === 0) return archivo;

    const nombre = archivo.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg' });
  } catch {
    return archivo; // ante cualquier problema, subo el original y que decida el server
  }
}

async function cargarBitmap(archivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(archivo);
    } catch {
      /* HEIC u otros que createImageBitmap no decodifica: probamos con <img> (Safari sí puede) */
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    await new Promise<void>((ok, err) => {
      img.onload = () => ok();
      img.onerror = () => err(new Error('no se pudo decodificar la imagen'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
