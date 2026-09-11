import sharp from 'sharp';
import { normalizarFoto, LIENZO, OCUPA } from './normalizar-foto';

// Una "foto" de prueba: fondo blanco grande con un producto (rectángulo oscuro)
// en cualquier lado, como las que vienen del catálogo externo.
async function foto(ancho: number, alto: number, prod: { x: number; y: number; w: number; h: number }, fondo = '#ffffff', formato: 'png' | 'jpeg' = 'png') {
  const rect = await sharp({ create: { width: prod.w, height: prod.h, channels: 3, background: '#3a1510' } }).png().toBuffer();
  const img = sharp({ create: { width: ancho, height: alto, channels: 4, background: fondo } }).composite([{ input: rect, left: prod.x, top: prod.y }]);
  return formato === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

// Caja del contenido no blanco de la salida
async function caja(buf: Buffer) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { ancho: info.width, alto: info.height, izq: x0, der: info.width - 1 - x1, arr: y0, aba: info.height - 1 - y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

describe('normalizarFoto: todas del mismo tamaño y centradas', () => {
  it('una botella chiquita perdida en un fondo enorme sale grande y centrada', async () => {
    const r = await normalizarFoto(await foto(1600, 1600, { x: 90, y: 1100, w: 60, h: 200 }));
    const c = await caja(r.buffer);
    expect([c.ancho, c.alto]).toEqual([LIENZO.ancho, LIENZO.alto]);
    expect(r.recortada).toBe(true);
    // manda el alto: ocupa el 84% del alto del lienzo
    expect(c.h).toBeGreaterThanOrEqual(Math.round(LIENZO.alto * OCUPA) - 4);
    // centrada: mismos márgenes a izquierda/derecha y arriba/abajo
    expect(Math.abs(c.izq - c.der)).toBeLessThanOrEqual(3);
    expect(Math.abs(c.arr - c.aba)).toBeLessThanOrEqual(3);
  });

  it('una caja apaisada queda con el mismo margen a los costados', async () => {
    const r = await normalizarFoto(await foto(900, 700, { x: 40, y: 300, w: 600, h: 150 }));
    const c = await caja(r.buffer);
    // manda el ancho: ocupa el 84% del ancho del lienzo
    expect(c.w).toBeGreaterThanOrEqual(Math.round(LIENZO.ancho * OCUPA) - 4);
    expect(Math.abs(c.izq - c.der)).toBeLessThanOrEqual(3);
    expect(Math.abs(c.arr - c.aba)).toBeLessThanOrEqual(3);
  });

  it('dos fotos del mismo producto con márgenes distintos terminan iguales', async () => {
    const chica = await caja((await normalizarFoto(await foto(2000, 2000, { x: 900, y: 800, w: 100, h: 300 }))).buffer);
    const grande = await caja((await normalizarFoto(await foto(340, 1020, { x: 20, y: 10, w: 300, h: 900 }))).buffer);
    expect(Math.abs(chica.h - grande.h)).toBeLessThanOrEqual(4);
    expect(Math.abs(chica.w - grande.w)).toBeLessThanOrEqual(4);
  });

  it('una PNG con fondo transparente queda sobre blanco, no sobre negro', async () => {
    const r = await normalizarFoto(await foto(800, 800, { x: 300, y: 200, w: 200, h: 400 }, '#00000000'));
    const { data } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((v) => v > 245)).toBe(true); // la esquina es blanca
  });

  it('una imagen toda blanca no revienta: sale el lienzo sin recortar', async () => {
    const blanca = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const r = await normalizarFoto(blanca);
    const m = await sharp(r.buffer).metadata();
    expect([m.width, m.height]).toEqual([LIENZO.ancho, LIENZO.alto]);
  });

  it('sale en JPEG, que es lo que sirve Storage como productos/{sku}.jpg', async () => {
    const r = await normalizarFoto(await foto(400, 400, { x: 100, y: 100, w: 100, h: 200 }, '#ffffff', 'jpeg'));
    expect((await sharp(r.buffer).metadata()).format).toBe('jpeg');
  });
});
