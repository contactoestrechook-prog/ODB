import { Resvg } from '@resvg/resvg-js';
import { decompress } from 'wawoff2';
import { LOGO_ODB_BLANCO } from './logo-odb';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// RESUMEN DE PEDIDO COMO IMAGEN, diseño "Placa roja" (elegido por Leandro el
// 25/9/2026 entre cuatro maquetas). El cartel anterior metía "$20.500 c/u =
// $41.000" en una sola columna y al nombre le quedaba pegado el "2 ×"; este
// muestra cantidad, producto, cantidad × unitario y subtotal por separado, el
// total en una píldora negra y la entrega en su recuadro.

const ROJO = '#B82D25';
const CREMA = '#F0EBE2';
const NEGRO = '#141414';
const GRIS = '#6B6660';
const LINEA = '#DDD5C8';

export type RenglonPedido = { nombre: string; cantidad: number; unitario: number; subtotal: number };
export type ResumenPedido = {
  renglones: RenglonPedido[];
  total: number;
  entrega: { titulo: string; detalle: string | null } | null;
  confirmar: boolean;
  /** lo que no va en la imagen: viaja como epígrafe de la foto */
  pie: string;
};

const numero = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

/** El nombre como se lee: sin dobles espacios y con la medida escrita bien ("x750cc" → "750 cc"). */
export function nombreParaCartel(n: string): string {
  return String(n ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\bx\s*(\d+(?:[.,]\d+)?)\s*(cc|ml)\b/gi, (_m, v: string, u: string) => `${v.replace('.', ',')} ${u.toLowerCase()}`)
    .replace(/\bx\s*(\d+(?:[.,]\d+)?)\s*(l|lt|lts|litros?)\b/gi, (_m, v: string) => `${v.replace('.', ',')} L`)
    .replace(/(\S)\s*x?\s*(\d+(?:[.,]\d+)?)\s*kg\b/gi, (_m, a: string, v: string) => `${/x/i.test(a) ? '' : a} ${v.replace('.', ',')} kg`)
    .replace(/\bx\s*(\d+)\s*(gr|grs|g)\b/gi, (_m, v: string) => `${v} g`)
    .replace(/(\d)\s*(gr|grs)\b/gi, '$1 g')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// "• Fernet Branca x750cc — 2 × $20.500 c/u = $41.000"
const RE_RENGLON = /^•\s*(.+?)\s+[—–-]\s+(\d+(?:[.,]\d+)?)\s*[×x]\s*\$\s?([\d.]+)(?:\s*c\/u)?\s*=\s*\$\s?([\d.]+)\s*$/i;
const RE_TOTAL = /^\*?\s*total[^:\n]{0,20}:\s*\$\s?([\d.]+)\s*\*?\s*$/i;
const RE_ENVIO = /^Env[ií]o sin cargo(?: a (.+?))?\.\s*(?:Recibe (.+?)\.)?\s*$/i;
const RE_RETIRO = /^Retiro en la sucursal Saint Thomas\.?\s*$/i;

/**
 * Lee el resumen que manda el bot. Devuelve null si no es un pedido con
 * renglones y total, o si algún renglón con viñeta no se puede leer: en ese
 * caso va el texto tal cual (la imagen nunca esconde un renglón).
 */
export function leerResumenDePedido(texto: string): ResumenPedido | null {
  const lineas = String(texto ?? '').split('\n');
  const renglones: RenglonPedido[] = [];
  const resto: string[] = [];
  let total: number | null = null;
  let entrega: ResumenPedido['entrega'] = null;
  for (const cruda of lineas) {
    const l = cruda.trim();
    const r = RE_RENGLON.exec(l);
    if (r) {
      renglones.push({ nombre: nombreParaCartel(r[1]), cantidad: numero(r[2]), unitario: numero(r[3]), subtotal: numero(r[4]) });
      continue;
    }
    if (l.startsWith('•')) return null;
    const t = RE_TOTAL.exec(l);
    if (t) { total = numero(t[1]); continue; }
    const e = RE_ENVIO.exec(l);
    if (e) {
      entrega = { titulo: 'Envío sin cargo', detalle: [e[1], e[2] ? `recibe ${e[2]}` : null].filter(Boolean).join(' · ') || null };
      continue;
    }
    if (RE_RETIRO.test(l)) { entrega = { titulo: 'Retiro en la sucursal Saint Thomas', detalle: 'Castex 3601, Canning' }; continue; }
    resto.push(cruda);
  }
  if (renglones.length < 2 || total === null) return null;
  // si los renglones no suman el total, algo se leyó mal: mejor el texto
  if (Math.abs(renglones.reduce((s, r) => s + r.subtotal, 0) - total) > 1) return null;
  const pie = resto.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { renglones, total, entrega, confirmar: /¿lo confirmo\?/i.test(texto), pie };
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// corte en renglones por ancho estimado (Inter ≈ 0,54 em por carácter)
function partir(txt: string, px: number, ancho: number, max = 2): string[] {
  const cap = Math.floor(ancho / (px * 0.54));
  const out: string[] = [];
  let l = '';
  for (const p of txt.split(' ')) {
    if ((l + ' ' + p).trim().length > cap) { if (l.trim()) out.push(l.trim()); l = p; } else l += ' ' + p;
  }
  if (l.trim()) out.push(l.trim());
  if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].slice(0, cap - 1).trimEnd() + '…'; }
  return out.map((x) => (x.length > cap ? x.slice(0, cap - 1) + '…' : x));
}

let fuentes: string[] | null = null;
async function tipografias(): Promise<string[]> {
  if (fuentes) return fuentes;
  const dir = join(tmpdir(), 'odb-fuentes');
  await mkdir(dir, { recursive: true });
  const origenes: [string, string][] = [
    ...['400', '600', '800'].map((p) => [join('@fontsource', 'inter', 'files', `inter-latin-${p}-normal.woff2`), `inter-${p}.ttf`] as [string, string]),
    [join('@fontsource', 'montserrat', 'files', 'montserrat-latin-800-normal.woff2'), 'montserrat-800.ttf'],
  ];
  const salida: string[] = [];
  for (const [origen, archivo] of origenes) {
    const destino = join(dir, archivo);
    if (!existsSync(destino)) {
      const ttf = await decompress(await readFile(join(process.cwd(), 'node_modules', origen)));
      await writeFile(destino, Buffer.from(ttf));
    }
    salida.push(destino);
  }
  fuentes = salida;
  return salida;
}

export async function cartelPedido(r: ResumenPedido): Promise<Buffer> {
  const W = 1080, M = 48, TOP = 250, SEP = 14;
  const filas = r.renglones.map((x) => ({ ...x, lineas: partir(x.nombre, 33, 560, 2) }));
  const altoFila = (n: number) => (n > 1 ? 160 : 132);
  const altoFilas = filas.reduce((s, f) => s + altoFila(f.lineas.length) + SEP, 0);
  const alto = TOP + altoFilas + 136 + (r.entrega ? 148 : 0) + (r.confirmar ? 100 : 40);
  const enteras = r.renglones.every((x) => Number.isInteger(x.cantidad));
  const unidades = r.renglones.reduce((s, x) => s + x.cantidad, 0);
  const sub = `${r.renglones.length} productos${enteras ? ` · ${unidades} unidades` : ''}`;
  const cant = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));

  let y = TOP;
  const cuerpo = filas.map((f) => {
    const h = altoFila(f.lineas.length);
    const cy = y + h / 2;
    const n = f.lineas;
    const s = `
    <rect x="${M}" y="${y}" width="${W - 2 * M}" height="${h}" rx="18" fill="#FFFFFF" stroke="${LINEA}" stroke-width="2"/>
    <circle cx="${M + 66}" cy="${cy}" r="40" fill="${ROJO}"/>
    <text x="${M + 66}" y="${cy + 14}" font-family="Montserrat" font-weight="800" font-size="${cant(f.cantidad).length > 2 ? 28 : 38}" fill="#FFFFFF" text-anchor="middle">${esc(cant(f.cantidad))}</text>
    ${n.map((t, k) => `<text x="${M + 134}" y="${y + 52 + k * 38}" font-family="Inter" font-weight="600" font-size="33" fill="${NEGRO}">${esc(t)}</text>`).join('')}
    <text x="${M + 134}" y="${y + 52 + n.length * 38 + 4}" font-family="Inter" font-size="26" fill="${GRIS}">${esc(`${cant(f.cantidad)} × ${pesos(f.unitario)}`)}</text>
    <text x="${W - M - 32}" y="${cy + 14}" font-family="Inter" font-weight="800" font-size="38" fill="${NEGRO}" text-anchor="end">${esc(pesos(f.subtotal))}</text>`;
    y += h + SEP;
    return s;
  }).join('');

  const yT = y + 2;
  const total = `
  <rect x="${M}" y="${yT}" width="${W - 2 * M}" height="120" rx="60" fill="${NEGRO}"/>
  <text x="${M + 56}" y="${yT + 76}" font-family="Montserrat" font-weight="800" font-size="38" fill="#FFFFFF">TOTAL</text>
  <text x="${W - M - 56}" y="${yT + 80}" font-family="Inter" font-weight="800" font-size="52" fill="#FFFFFF" text-anchor="end">${esc(pesos(r.total))}</text>`;
  let yE = yT + 148;
  const entrega = r.entrega
    ? `
  <rect x="${M}" y="${yE}" width="${W - 2 * M}" height="120" rx="18" fill="#FFFFFF" stroke="${LINEA}" stroke-width="2"/>
  <text x="${M + 36}" y="${yE + (r.entrega.detalle ? 50 : 70)}" font-family="Inter" font-weight="800" font-size="30" fill="${ROJO}">${esc(partir(r.entrega.titulo, 30, W - 2 * M - 72, 1)[0])}</text>
  ${r.entrega.detalle ? `<text x="${M + 36}" y="${yE + 92}" font-family="Inter" font-size="28" fill="${GRIS}">${esc(partir(r.entrega.detalle, 28, W - 2 * M - 72, 1)[0])}</text>` : ''}`
    : '';
  if (r.entrega) yE += 148;
  const confirmar = r.confirmar
    ? `<text x="${W / 2}" y="${yE + 42}" font-family="Inter" font-weight="600" font-size="28" fill="${NEGRO}" text-anchor="middle">Respondé SÍ y lo confirmamos</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${alto}" viewBox="0 0 ${W} ${alto}">
  <rect width="${W}" height="${alto}" fill="${CREMA}"/>
  <rect width="${W}" height="200" fill="${ROJO}"/>
  <image x="${M}" y="40" width="190" height="${Math.round((190 * 74) / 121)}" href="data:image/png;base64,${LOGO_ODB_BLANCO}"/>
  <text x="${W - M}" y="96" font-family="Montserrat" font-weight="800" font-size="42" fill="#FFFFFF" text-anchor="end">RESUMEN</text>
  <text x="${W - M}" y="142" font-family="Inter" font-size="27" fill="#FFFFFF" fill-opacity="0.8" text-anchor="end">${esc(sub)}</text>
  ${cuerpo}
  ${total}
  ${entrega}
  ${confirmar}
</svg>`;
  const png = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: await tipografias(), defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: W },
  });
  return Buffer.from(png.render().asPng());
}
