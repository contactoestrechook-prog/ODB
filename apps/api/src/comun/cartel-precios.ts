import { Resvg } from '@resvg/resvg-js';
import { decompress } from 'wawoff2';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Cartel de precios para WhatsApp. Los proveedores les mandan flyers, no
// párrafos: un listado como imagen se mira de un vistazo, se reenvía y se
// guarda en el teléfono. El texto igual va como pie de foto, para que el
// cliente pueda copiar un precio si lo necesita.
//
// La tipografía viaja con el código (paquete @fontsource/inter, licencia
// abierta) y se descomprime a TTF la primera vez: el contenedor de producción
// no tiene tipografías instaladas y, sin esto, los carteles saldrían en blanco.

const ROJO = '#B82D25';
const CREMA = '#F0EBE2';
const NEGRO = '#141414';
const ORO = '#C9A96E';

let fuentes: string[] | null = null;

async function tipografias(): Promise<string[]> {
  if (fuentes) return fuentes;
  const dir = join(tmpdir(), 'odb-fuentes');
  await mkdir(dir, { recursive: true });
  const salida: string[] = [];
  for (const [peso, archivo] of [['700', 'inter-latin-700-normal.woff2'], ['400', 'inter-latin-400-normal.woff2']]) {
    const destino = join(dir, `inter-${peso}.ttf`);
    if (!existsSync(destino)) {
      const origen = join(process.cwd(), 'node_modules', '@fontsource', 'inter', 'files', archivo);
      const ttf = await decompress(await readFile(origen));
      await writeFile(destino, Buffer.from(ttf));
    }
    salida.push(destino);
  }
  fuentes = salida;
  return salida;
}

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// El texto va dentro del SVG: hay que escapar lo que rompería el XML
const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Corta el nombre para que no se monte con el precio. Inter a 26px mide
// aproximadamente 0,55em por carácter.
const recortar = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…');

export type RenglonCartel = { nombre: string; precio: string; detalle?: string | null };

export async function cartelPrecios(opciones: {
  titulo: string;
  renglones: RenglonCartel[];
  pie?: string | null;
  total?: string | null;
}): Promise<Buffer> {
  const { titulo, renglones } = opciones;
  const ANCHO = 900;
  const MARGEN = 48;
  const ALTO_FILA = 62;
  const ENCABEZADO = 150;
  const PIE = opciones.total ? 150 : 96;
  const alto = ENCABEZADO + renglones.length * ALTO_FILA + PIE;

  const filas = renglones
    .map((r, i) => {
      const y = ENCABEZADO + i * ALTO_FILA;
      const fondo = i % 2 === 0 ? '' : `<rect x="${MARGEN}" y="${y}" width="${ANCHO - MARGEN * 2}" height="${ALTO_FILA}" fill="#00000008"/>`;
      const detalle = r.detalle
        ? `<text x="${MARGEN + 20}" y="${y + 48}" font-family="Inter" font-size="17" fill="#00000066">${esc(r.detalle)}</text>`
        : '';
      return `${fondo}
      <text x="${MARGEN + 20}" y="${y + (r.detalle ? 27 : 39)}" font-family="Inter" font-size="26" font-weight="400" fill="${NEGRO}">${esc(recortar(r.nombre, 42))}</text>
      <text x="${ANCHO - MARGEN - 20}" y="${y + 39}" font-family="Inter" font-size="28" font-weight="700" fill="${ROJO}" text-anchor="end">${esc(r.precio)}</text>`;
    })
    .join('\n');

  const yTotal = ENCABEZADO + renglones.length * ALTO_FILA;
  const total = opciones.total
    ? `<rect x="${MARGEN}" y="${yTotal + 14}" width="${ANCHO - MARGEN * 2}" height="62" fill="${NEGRO}" rx="10"/>
       <text x="${MARGEN + 20}" y="${yTotal + 54}" font-family="Inter" font-size="26" font-weight="700" fill="${CREMA}">TOTAL</text>
       <text x="${ANCHO - MARGEN - 20}" y="${yTotal + 54}" font-family="Inter" font-size="30" font-weight="700" fill="${CREMA}" text-anchor="end">${esc(opciones.total)}</text>`
    : '';

  const pie = opciones.pie
    ? `<text x="${ANCHO / 2}" y="${alto - 34}" font-family="Inter" font-size="18" fill="#00000059" text-anchor="middle">${esc(opciones.pie)}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${alto}" viewBox="0 0 ${ANCHO} ${alto}">
  <rect width="${ANCHO}" height="${alto}" fill="${CREMA}"/>
  <rect x="0" y="0" width="${ANCHO}" height="106" fill="${NEGRO}"/>
  <rect x="0" y="106" width="${ANCHO}" height="4" fill="${ORO}"/>
  <text x="${MARGEN}" y="48" font-family="Inter" font-size="21" font-weight="700" fill="${CREMA}" letter-spacing="3">O.D.B PREMIUM MARKET</text>
  <text x="${MARGEN}" y="84" font-family="Inter" font-size="30" font-weight="700" fill="${ORO}">${esc(recortar(titulo, 44))}</text>
  ${filas}
  ${total}
  ${pie}
</svg>`;

  const r = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: await tipografias(), defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: ANCHO },
  });
  return Buffer.from(r.render().asPng());
}

export { pesos as pesosCartel };
