// Busca el QR de ARCA en la foto o el escaneo de una factura (3/11/2026).
// Lo que se hace con el QR está en qr-arca.ts.
//
// Probado con las 30 últimas lecturas reales (ZXing contra jsQR):
// - ZXing lo encontró en 28 de 28, en unos 100 ms; jsQR, en 22.
// - jsQR fallaba en las de Rueda Que Rueda, que traen DOS QR (arriba, el de la
//   tienda de Mondelez), y en las fotos chicas de Branca (960 px).
// - Leer la hoja entera no alcanza: el QR de ARCA es chico y va en una esquina.
//   Se prueba la hoja y después cada cuarto agrandado.
// Nunca frena la lectura: si algo falla, devuelve null y se sigue sin QR.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { decodificarQrArca, esQrDeArca, type QrArca } from './qr-arca';

let preparado: Promise<unknown> | null = null;
function preparar() {
  // el wasm sale de node_modules: sin esto lo baja de internet en cada arranque
  preparado ??= Promise.resolve(
    prepareZXingModule({
      overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) as any },
      fireImmediately: true,
    }),
  );
  return preparado;
}

// Los escaneos del iPhone (los 23 PDF de octubre) son una foto JPEG por hoja
// metida en el PDF: se sacan tal cual, sin renderizar nada. Un PDF digital
// (texto) no tiene JPEG y devuelve [].
export function jpegsDelPdf(pdf: Buffer): Buffer[] {
  const salida: Buffer[] = [];
  let i = 0;
  while ((i = pdf.indexOf('/DCTDecode', i)) !== -1) {
    const s = pdf.indexOf('stream', i);
    if (s < 0) break;
    let ini = s + 6;
    if (pdf[ini] === 0x0d) ini++;
    if (pdf[ini] === 0x0a) ini++;
    const fin = pdf.indexOf('endstream', ini);
    if (fin < 0) break;
    salida.push(pdf.subarray(ini, fin));
    i = fin;
  }
  return salida;
}

async function qrsDe(imagen: Buffer, region?: { left: number; top: number; width: number; height: number }, ancho?: number): Promise<string[]> {
  let p = sharp(imagen).rotate();
  if (region) p = sharp(await p.toBuffer()).extract(region);
  if (ancho) p = p.resize({ width: ancho, kernel: 'lanczos3' });
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = await readBarcodes(
    { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, colorSpace: 'SRGB' } as any,
    { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 },
  );
  return r.filter((x) => x.isValid).map((x) => x.text);
}

async function qrDeLaHoja(imagen: Buffer): Promise<QrArca | null> {
  const { width: W = 0, height: H = 0 } = await sharp(imagen).rotate().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  if (W < 400 || H < 400) return null; // logos y sellos sueltos del PDF
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  const intentos: [{ left: number; top: number; width: number; height: number } | undefined, number][] = [
    [undefined, Math.min(W, 2000)],
    // abajo primero: es donde lo ponen casi todos
    ...([[0, hh], [hw, hh], [0, 0], [hw, 0]] as const).map(([left, top]) => [{ left, top, width: hw, height: hh }, Math.max(1400, hw * 2)] as [any, number]),
  ];
  for (const [region, ancho] of intentos) {
    const texto = (await qrsDe(imagen, region, ancho)).find(esQrDeArca);
    if (texto) return decodificarQrArca(texto);
  }
  return null;
}

export async function buscarQrArca(archivo: { buffer: Buffer; mimetype: string; originalname?: string }): Promise<QrArca | null> {
  try {
    await preparar();
    const esPdf = archivo.mimetype === 'application/pdf' || /\.pdf$/i.test(archivo.originalname ?? '');
    const hojas = esPdf ? jpegsDelPdf(archivo.buffer) : [archivo.buffer];
    for (const hoja of hojas.slice(0, 6)) {
      const qr = await qrDeLaHoja(hoja).catch(() => null);
      if (qr) return qr;
    }
  } catch {
    /* sin QR se lee igual */
  }
  return null;
}
