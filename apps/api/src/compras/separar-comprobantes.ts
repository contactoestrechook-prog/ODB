// UN PDF, VARIOS COMPROBANTES (5/11/2026). Ana escanea la factura y su nota de
// crédito juntas, o dos facturas del mismo reparto, en un solo PDF. El lector
// lee UN comprobante por lectura: leía el primero y dejaba una duda («el adjunto
// trae una segunda factura… se extrajo solo la primera»). Leandro: «quiere
// cargar una nota de crédito con una factura a la vez y no le permite… que
// aprenda y lo haga».
//
// Antes de leer, se mira qué comprobantes trae el PDF y qué hojas son de cada
// uno, y se arma un PDF por comprobante: cada uno sigue después el camino de
// siempre (QR de ARCA, reglas del proveedor, lectura), como si lo hubieran
// subido aparte.
//
// El QR de ARCA no alcanza para separarlos: en los dos PDF del 5/11 (Glorilact
// con su nota de crédito, Grupo Modo con dos facturas) el QR de la segunda hoja
// no se pudo leer. Por eso lo decide una mirada corta de la IA a las hojas.
//
// Nunca frena la carga: si no se puede saber, devuelve null y el PDF se lee
// entero, como antes.
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { esfuerzo, RAZONAMIENTO } from '../comun/modelos';
import { jpegsDelPdf } from './qr-arca.lector';

export const TIPOS_COMPROBANTE = ['factura', 'nota_credito', 'nota_debito', 'remito', 'otro'] as const;
export type ComprobanteDelPdf = { hojas: number[]; tipo: (typeof TIPOS_COMPROBANTE)[number]; numero: string };
export type ParteDelPdf = ComprobanteDelPdf & { buffer: Buffer; etiqueta: string };

const ROTULO: Record<string, string> = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito', remito: 'Remito', otro: 'Comprobante' };
const TOPE_HOJAS = 12;

type Hoja = { jpeg: Buffer; ancho: number; alto: number; canales: number };

/** Las hojas escaneadas del PDF (una foto JPEG por hoja); los logos y sellos sueltos no cuentan. */
export async function hojasDelPdf(pdf: Buffer): Promise<Hoja[]> {
  const hojas: Hoja[] = [];
  for (const jpeg of jpegsDelPdf(pdf)) {
    const m = await sharp(jpeg).metadata().catch(() => null);
    if (!m?.width || !m?.height || m.width < 400 || m.height < 400) continue;
    // una hoja girada por EXIF se endereza: dentro de un PDF esa marca no se respeta
    if ((m.orientation ?? 1) > 1) {
      const { data, info } = await sharp(jpeg).rotate().jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
      hojas.push({ jpeg: data, ancho: info.width, alto: info.height, canales: info.channels });
    } else {
      hojas.push({ jpeg, ancho: m.width, alto: m.height, canales: m.channels ?? 3 });
    }
  }
  return hojas;
}

/**
 * Lo que contestó la IA, solo si sirve para partir el PDF: dos comprobantes o
 * más, y cada hoja en uno y solo uno. Si no, null (se lee entero, como antes).
 */
export function comprobantesValidos(crudo: unknown, cantidadDeHojas: number): ComprobanteDelPdf[] | null {
  const lista = Array.isArray((crudo as any)?.comprobantes) ? (crudo as any).comprobantes : null;
  if (!lista || lista.length < 2 || lista.length > cantidadDeHojas) return null;
  const vistas = new Set<number>();
  const salida: ComprobanteDelPdf[] = [];
  for (const c of lista) {
    const hojas = (Array.isArray(c?.hojas) ? c.hojas : []).map((h: unknown) => Number(h));
    if (!hojas.length) return null;
    for (const h of hojas) {
      if (!Number.isInteger(h) || h < 1 || h > cantidadDeHojas || vistas.has(h)) return null;
      vistas.add(h);
    }
    const tipo = (TIPOS_COMPROBANTE as readonly string[]).includes(c?.tipo) ? c.tipo : 'otro';
    salida.push({ hojas: [...hojas].sort((a, b) => a - b), tipo, numero: String(c?.numero ?? '').trim().slice(0, 30) });
  }
  if (vistas.size !== cantidadDeHojas) return null;
  return salida.sort((a, b) => a.hojas[0] - b.hojas[0]);
}

/** «CamScanner 14.40.pdf · 2 de 2 · Nota de crédito 0001-00003945» */
export function etiquetaDeLaParte(nombre: string | undefined, k: number, total: number, c: ComprobanteDelPdf): string {
  return `${nombre?.trim() || 'Comprobante.pdf'} · ${k} de ${total} · ${ROTULO[c.tipo] ?? 'Comprobante'}${c.numero ? ` ${c.numero}` : ''}`.slice(0, 180);
}

/** Un PDF con una foto JPEG por hoja, igual que los escaneos del celular. */
export function pdfDeHojas(hojas: Hoja[]): Buffer {
  const partes: Buffer[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const agregar = (b: Buffer | string) => { const x = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; partes.push(x); largo += x.length; };
  const objeto = (n: number, cuerpo: (Buffer | string)[]) => {
    posiciones[n] = largo;
    agregar(`${n} 0 obj\n`);
    for (const c of cuerpo) agregar(c);
    agregar('\nendobj\n');
  };
  agregar('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  // 1 catálogo, 2 páginas; por hoja: página, contenido e imagen
  const idPagina = (k: number) => 3 + k * 3;
  objeto(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  objeto(2, [`<< /Type /Pages /Count ${hojas.length} /Kids [${hojas.map((_, k) => `${idPagina(k)} 0 R`).join(' ')}] >>`]);
  hojas.forEach((h, k) => {
    const pagina = idPagina(k);
    // A4 a lo alto o a lo ancho, con la foto ocupando la hoja entera
    const W = h.ancho >= h.alto ? 842 : 595;
    const H = Math.round((W * h.alto) / h.ancho);
    const dibujo = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    objeto(pagina, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pagina + 2} 0 R >> >> /Contents ${pagina + 1} 0 R >>`]);
    objeto(pagina + 1, [`<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`]);
    const color = h.canales === 1 ? '/DeviceGray' : h.canales === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    objeto(pagina + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${h.ancho} /Height ${h.alto} /ColorSpace ${color} /BitsPerComponent 8 /Filter /DCTDecode /Length ${h.jpeg.length} >>\nstream\n`,
      h.jpeg,
      '\nendstream',
    ]);
  });
  const inicioTabla = largo;
  const total = 3 + hojas.length * 3;
  agregar(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) agregar(`${String(posiciones[n]).padStart(10, '0')} 00000 n \n`);
  agregar(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioTabla}\n%%EOF\n`);
  return Buffer.concat(partes);
}

const ESQUEMA = {
  type: 'object',
  properties: {
    comprobantes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hojas: { type: 'array', items: { type: 'integer' }, description: 'Las hojas de este comprobante, por su número (la primera es 1)' },
          tipo: { type: 'string', enum: [...TIPOS_COMPROBANTE] },
          numero: { type: 'string', description: 'El número impreso (0001-00149951); vacío si no se lee' },
        },
        required: ['hojas', 'tipo', 'numero'],
        additionalProperties: false,
      },
    },
  },
  required: ['comprobantes'],
  additionalProperties: false,
};

const PEDIDO =
  'Estas son las hojas escaneadas de un PDF que subió administración de un almacén, en orden (hoja 1, hoja 2…). Decime cuántos comprobantes DISTINTOS hay y qué hojas son de cada uno. Dos hojas son del mismo comprobante solo si tienen el mismo tipo y el mismo número (una factura larga que sigue en otra hoja, «Hoja 2 de 2», «transporte»). Una factura y su nota de crédito son dos comprobantes; dos facturas con distinto número, también. Cada hoja va en un comprobante y en uno solo. Si todo es un solo comprobante, devolvé uno solo con todas las hojas.';

/**
 * Si el PDF trae más de un comprobante, lo devuelve partido: un PDF por
 * comprobante. null = es uno solo, no es un escaneo, o no se pudo saber.
 */
export async function separarComprobantes(archivo: { buffer: Buffer; mimetype: string; originalname?: string }): Promise<ParteDelPdf[] | null> {
  const esPdf = archivo.mimetype === 'application/pdf' || /\.pdf$/i.test(archivo.originalname ?? '');
  if (!esPdf || !process.env.ANTHROPIC_API_KEY) return null;
  const hojas = await hojasDelPdf(archivo.buffer);
  if (hojas.length < 2 || hojas.length > TOPE_HOJAS) return null;

  // para decidir alcanza con una copia chica de cada hoja
  const chicas = await Promise.all(hojas.map((h) => sharp(h.jpeg).resize({ width: 1100, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()));
  const contenido: any[] = [];
  chicas.forEach((b, k) => {
    contenido.push({ type: 'text', text: `Hoja ${k + 1}:` });
    contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } });
  });
  contenido.push({ type: 'text', text: PEDIDO });

  const r: any = await new Anthropic().messages.create({
    // el mismo modelo que lee las facturas; es una pregunta corta
    model: 'claude-sonnet-5-5',
    max_tokens: 4000,
    thinking: RAZONAMIENTO,
    output_config: { format: { type: 'json_schema', schema: ESQUEMA as any }, effort: esfuerzo('SEPARAR_COMPROBANTES_ESFUERZO', 'low', { general: false }) },
    messages: [{ role: 'user', content: contenido }],
  } as any);
  const texto = (r?.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
  let crudo: unknown = null;
  try { crudo = JSON.parse(texto); } catch { return null; }
  const comprobantes = comprobantesValidos(crudo, hojas.length);
  if (!comprobantes) return null;
  return comprobantes.map((c, k) => ({
    ...c,
    buffer: pdfDeHojas(c.hojas.map((h) => hojas[h - 1])),
    etiqueta: etiquetaDeLaParte(archivo.originalname, k + 1, comprobantes.length, c),
  }));
}
