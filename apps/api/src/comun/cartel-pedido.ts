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
// El total puede venir con texto pegado en el mismo renglón: el bot escribe
// "*Total: $18.200* (envío sin cargo) El reparto de hoy ya cerró...". Antes se
// exigía que la línea terminara en el monto y la tarjeta no salía nunca
// (26/9/2026: ni un cartel entre el 19 y el 26). Ahora se toma el monto y lo
// que sigue viaja como epígrafe de la foto.
const RE_TOTAL = /^\*?\s*total[^:\n]{0,25}:\s*\$\s?([\d.]+)\s*\*?\s*(.*)$/i;
const RE_ENVIO = /^Env[ií]o sin cargo(?: a (.+?))?\.\s*(?:Recibe (.+?)\.)?\s*$/i;
const RE_RETIRO = /^Retiro en la sucursal Saint Thomas\.?\s*$/i;
// la misma información, pero dicha dentro de una oración ("El envío es sin cargo.")
const RE_ENVIO_SUELTO = /env[ií]o\s+(?:es\s+)?sin\s+cargo(?:\s+a\s+([^.;,\n(]{3,60}))?/i;
// "Recibe Catalina": el nombre con mayúscula; "nombre de quien recibe y la dirección" no es un nombre
const RE_RECIBE = /\b[Rr]ecibe:?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/;

/** El envío dicho en cualquier parte del texto (no como renglón propio). */
function entregaEnElTexto(texto: string): ResumenPedido['entrega'] {
  // el retiro solo cuenta como renglón propio: dicho al pasar suele ser la
  // alternativa que se le ofrece ("o retiralo sin mínimo en la sucursal")
  if (/retir/i.test(texto)) return null;
  const e = RE_ENVIO_SUELTO.exec(texto);
  if (!e) return null;
  let donde = (e[1] ?? '').split(/\s+(?:es|para|desde|que|y|con|porque)\s+/i)[0].trim();
  if (/^(?:domicilio|tu casa)\b/i.test(donde)) donde = '';
  const quien = RE_RECIBE.exec(texto)?.[1]?.trim();
  const detalle = [donde || null, quien ? `recibe ${quien}` : null].filter(Boolean).join(' · ');
  return { titulo: 'Envío sin cargo', detalle: detalle || null };
}

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
    if (t) {
      total = numero(t[1]);
      const cola = (t[2] ?? '').replace(/^[\s*)\]]+/, '')
        .replace(/^\(\s*env[ií]o\s+sin\s+cargo\s*\)\s*/i, '')          // ya está en el recuadro de la tarjeta
        .trim();                                                       // lo que sigue al monto
      if (cola) resto.push(cola);
      continue;
    }
    const e = RE_ENVIO.exec(l);
    if (e) {
      entrega = { titulo: 'Envío sin cargo', detalle: [e[1], e[2] ? `recibe ${e[2]}` : null].filter(Boolean).join(' · ') || null };
      continue;
    }
    if (RE_RETIRO.test(l)) { entrega = { titulo: 'Retiro en la sucursal Saint Thomas', detalle: 'Castex 3601, Canning' }; continue; }
    resto.push(cruda);
  }
  if (renglones.length < 2 || total === null) return null;
  // la entrega también se reconoce dicha dentro de una oración; ahí la frase se
  // queda en el epígrafe, porque suele traer más datos ("el reparto ya cerró")
  if (!entrega) entrega = entregaEnElTexto(texto);
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
  // la medida no se parte ("750" en un renglón y "cc" en el otro): espacio duro
  for (const p of txt.replace(/(\d) (cc|ml|L|kg|g)\b/g, '$1\u00a0$2').split(' ')) {
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

// ============================================================================
// NOTA DE PEDIDO AL PROVEEDOR COMO IMAGEN (2/10/2026). Pedido de Leandro: "que
// usen la gráfica que venimos usando para los pedidos". Es la misma Placa roja
// del resumen: cantidad en el círculo rojo, producto y su código del proveedor;
// sin precios (el precio lo pone su factura) y, en lugar del total, el número
// de pedido y a dónde se entrega.
// ============================================================================

export type NotaDePedidoCartel = {
  folio: string;
  renglones: { nombre: string; cantidad: number; codigoProveedor?: string | null }[];
  sucursal: string;
  direccion?: string | null;
  fechaEntrega?: string | null; // ya legible ("viernes 9/10")
};

export const MAX_RENGLONES_CARTEL = 30;

export async function cartelNotaDePedido(n: NotaDePedidoCartel): Promise<Buffer> {
  const W = 1080, M = 48, TOP = 250, SEP = 14;
  const visibles = n.renglones.slice(0, MAX_RENGLONES_CARTEL);
  const resto = n.renglones.length - visibles.length;
  const filas = visibles.map((x) => ({ ...x, lineas: partir(x.nombre, 33, 760, 2) }));
  const tieneCodigo = (f: { codigoProveedor?: string | null }) => !!f.codigoProveedor;
  const altoFila = (f: (typeof filas)[number]) => 56 + f.lineas.length * 38 + (tieneCodigo(f) ? 34 : 0) + 6;
  const altoFilas = filas.reduce((s, f) => s + Math.max(112, altoFila(f)) + SEP, 0) + (resto > 0 ? 60 : 0);
  const alto = TOP + altoFilas + 148 + 136 + 100;
  const enteras = n.renglones.every((x) => Number.isInteger(x.cantidad));
  const unidades = n.renglones.reduce((s, x) => s + x.cantidad, 0);
  const sub = `${n.renglones.length} producto${n.renglones.length === 1 ? '' : 's'}${enteras ? ` · ${unidades.toLocaleString('es-AR')} unidades` : ''}`;
  const cant = (v: number) => (Number.isInteger(v) ? v.toLocaleString('es-AR') : String(v).replace('.', ','));

  let y = TOP;
  const cuerpo = filas.map((f) => {
    const h = Math.max(112, altoFila(f));
    const cy = y + h / 2;
    const c = cant(f.cantidad);
    // el bloque de texto (nombre y código) va centrado en la fila
    const bloque = f.lineas.length * 38 + (tieneCodigo(f) ? 38 : 0);
    const base = y + (h - bloque) / 2 + 28;
    const s = `
    <rect x="${M}" y="${y}" width="${W - 2 * M}" height="${h}" rx="18" fill="#FFFFFF" stroke="${LINEA}" stroke-width="2"/>
    <circle cx="${M + 66}" cy="${cy}" r="40" fill="${ROJO}"/>
    <text x="${M + 66}" y="${cy + (c.length > 3 ? 9 : 14)}" font-family="Montserrat" font-weight="800" font-size="${c.length > 3 ? 22 : c.length > 2 ? 28 : 38}" fill="#FFFFFF" text-anchor="middle">${esc(c)}</text>
    ${f.lineas.map((t, k) => `<text x="${M + 134}" y="${base + k * 38}" font-family="Inter" font-weight="600" font-size="33" fill="${NEGRO}">${esc(t)}</text>`).join('')}
    ${tieneCodigo(f) ? `<text x="${M + 134}" y="${base + f.lineas.length * 38 + 2}" font-family="Inter" font-size="26" fill="${GRIS}">${esc(`Su código: ${f.codigoProveedor}`)}</text>` : ''}`;
    y += h + SEP;
    return s;
  }).join('');
  const masProductos = resto > 0
    ? `<text x="${W / 2}" y="${y + 36}" font-family="Inter" font-weight="600" font-size="28" fill="${GRIS}" text-anchor="middle">${esc(`…y ${resto} producto${resto === 1 ? '' : 's'} más: están todos en el PDF`)}</text>`
    : '';
  if (resto > 0) y += 60;

  const yE = y + 2;
  const detalle = [n.direccion, n.fechaEntrega].filter(Boolean).join(' · ');
  const entrega = `
  <rect x="${M}" y="${yE}" width="${W - 2 * M}" height="120" rx="18" fill="#FFFFFF" stroke="${LINEA}" stroke-width="2"/>
  <text x="${M + 36}" y="${yE + (detalle ? 50 : 70)}" font-family="Inter" font-weight="800" font-size="30" fill="${ROJO}">${esc(partir(`Entregar en ${n.sucursal}`, 30, W - 2 * M - 72, 1)[0])}</text>
  ${detalle ? `<text x="${M + 36}" y="${yE + 92}" font-family="Inter" font-size="28" fill="${GRIS}">${esc(partir(detalle, 28, W - 2 * M - 72, 1)[0])}</text>` : ''}`;
  const yP = yE + 148;
  const pedido = `
  <rect x="${M}" y="${yP}" width="${W - 2 * M}" height="120" rx="60" fill="${NEGRO}"/>
  <text x="${M + 56}" y="${yP + 76}" font-family="Montserrat" font-weight="800" font-size="38" fill="#FFFFFF">PEDIDO</text>
  <text x="${W - M - 56}" y="${yP + 78}" font-family="Inter" font-weight="800" font-size="46" fill="#FFFFFF" text-anchor="end">${esc(n.folio)}</text>`;
  const confirmar = `<text x="${W / 2}" y="${yP + 120 + 58}" font-family="Inter" font-weight="600" font-size="28" fill="${NEGRO}" text-anchor="middle">Respondan este mensaje para confirmar</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${alto}" viewBox="0 0 ${W} ${alto}">
  <rect width="${W}" height="${alto}" fill="${CREMA}"/>
  <rect width="${W}" height="200" fill="${ROJO}"/>
  <image x="${M}" y="40" width="190" height="${Math.round((190 * 74) / 121)}" href="data:image/png;base64,${LOGO_ODB_BLANCO}"/>
  <text x="${W - M}" y="96" font-family="Montserrat" font-weight="800" font-size="42" fill="#FFFFFF" text-anchor="end">NOTA DE PEDIDO</text>
  <text x="${W - M}" y="142" font-family="Inter" font-size="27" fill="#FFFFFF" fill-opacity="0.8" text-anchor="end">${esc(sub)}</text>
  ${cuerpo}
  ${masProductos}
  ${entrega}
  ${pedido}
  ${confirmar}
</svg>`;
  const png = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: await tipografias(), defaultFontFamily: 'Inter' },
    fitTo: { mode: 'width', value: W },
  });
  return Buffer.from(png.render().asPng());
}

// ============================================================================
// LISTA DE PRECIOS COMO IMAGEN (1/10/2026). El bot pasaba los precios en un
// párrafo corrido ("Havana Blanco $17.800, Havana Añejo $20.300, …") y la tarjeta
// de listas solo salía con renglones con viñeta: no salía nunca. Ahora la
// imagen se arma con los productos que el bot CONSULTÓ en el turno (nombre y
// precio del sistema), los que nombró en la respuesta, escriba como escriba.
// ============================================================================

export type ProductoConPrecio = { sku?: string; nombre: string; precio: number; precioEfectivo?: number | null };

const normal = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RE_PALABRA_VACIA = /^(cc|ml|lts?|litros?|kg|gr|x\d.*|\d.*|con|sin|de|del|la|el|los|las|y|o|en|por|para|blanco|tinto|clasico|clasica|botella|unidad)$/;

/**
 * Los productos consultados que el bot nombró en la respuesta, en el orden en
 * que los nombró. Por cada precio del texto se elige el producto de ese precio
 * cuyo nombre coincide MEJOR con lo escrito justo antes (desde el precio
 * anterior): «Coca Cola 1.75l $4.700» es la Coca común, no la Zero ni la Light
 * que cuestan lo mismo. Si empatan con el nombre completo («Martini Rosso y
 * Bianco $9.400») van los dos.
 */
export function preciosDeLaRespuesta(respuesta: string, catalogo: ProductoConPrecio[]): ProductoConPrecio[] {
  const texto = normal(respuesta);
  // un resumen de pedido ("2 × $20.500 c/u = $41.000") tiene su propia tarjeta
  if (/\d\s*[×x]\s*\$\s?\d/.test(texto)) return [];
  // palabras propias del nombre y, también, su medida ("600" de "x600cc"): el bot
  // abrevia ("la de 600 cc $2.500") y sin la medida no se reconocía el producto
  const palabrasDe = (n: string) => [...new Set([
    ...normal(n).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !RE_PALABRA_VACIA.test(w)),
    ...(normal(n).match(/\d{2,4}(?=\s*(?:cc|ml|g|gr|kg|l|lt)\b)/g) ?? []),
  ])];
  const elegidos: ProductoConPrecio[] = [];
  const usados = new Set<string>();
  const re = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g;
  let previo = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const monto = Number(m[1].replace(/\./g, ''));
    // lo escrito entre el precio anterior (o el comienzo del renglón) y este
    const desde = Math.max(previo, texto.lastIndexOf('\n', m.index) + 1, m.index - 160);
    const ventana = texto.slice(desde, m.index);
    previo = m.index + m[0].length;
    // "$53.460 en efectivo" o "($16.020)" después de otro precio: no es otro producto
    if (/^\s*(?:\(|,?\s*o)\s*$/.test(ventana) || /\b(?:total|subtotal|efectivo|transferencia)\b[^$]*$/.test(ventana) && !/[a-z]{4,}\s*[—–:-]?\s*$/.test(ventana.replace(/.*(efectivo|transferencia)/, ''))) continue;
    const candidatos = catalogo
      .filter((p) => p?.nombre && Math.round(p.precio) === monto && !usados.has(p.sku ?? p.nombre))
      .map((p) => { const ws = palabrasDe(p.nombre); const hits = ws.filter((w) => ventana.includes(w)).length; return { p, hits, puntaje: ws.length ? hits / ws.length : 0 }; })
      .filter((c) => c.hits > 0);
    if (!candidatos.length) continue;
    // gana el que coincide en más proporción y, a igualdad, en más palabras
    const mejor = Math.max(...candidatos.map((c) => c.puntaje));
    const masHits = Math.max(...candidatos.filter((c) => c.puntaje === mejor).map((c) => c.hits));
    const ganadores = candidatos.filter((c) => c.puntaje === mejor && c.hits === masHits);
    for (const c of mejor === 1 ? ganadores : ganadores.slice(0, 1)) { usados.add(c.p.sku ?? c.p.nombre); elegidos.push(c.p); }
  }
  return elegidos;
}

/**
 * Qué imagen le corresponde a una respuesta, mirando SOLO el texto: un resumen
 * con 2 renglones o más («• X — 2 × $… c/u = $…»), o una lista de precios con 3
 * productos o más. Sirve para controlar que la imagen salga (banco de pruebas).
 */
export function imagenEsperada(respuesta: string): 'resumen' | 'precios' | null {
  const t = String(respuesta ?? '');
  if ((t.match(/^\s*•[^\n]*\d\s*[×x]\s*\$\s?[\d.]+[^\n]*=\s*\$/gm) ?? []).length >= 2) return 'resumen';
  if (/\d\s*[×x]\s*\$/.test(t)) return null;
  // precios de lista: sacando totales y los precios en efectivo que acompañan a otro
  const limpio = t
    .replace(/\b(?:sub)?total[^$\n]{0,40}\$\s?[\d.]+/gi, '')
    .replace(/(?:\(|,?\s+o\s+)\$\s?[\d.]+[^)\n]{0,40}(?:\)|efectivo[^\n,;]*)/gi, '')
    .replace(/\$\s?[\d.]+\s+en efectivo[^\n,;]*/gi, '');
  return (limpio.match(/\$\s?\d/g) ?? []).length >= 3 ? 'precios' : null;
}

/** El texto que acompaña la imagen: lo que no son precios (la pregunta, una aclaración). */
export function pieSinPrecios(respuesta: string): string {
  return String(respuesta ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^•/.test(l))
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .filter((o) => !/\$\s?\d/.test(o))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function cartelListaPrecios(productos: ProductoConPrecio[], fecha: string): Promise<Buffer> {
  const W = 1080, M = 48, TOP = 250, SEP = 12;
  const pesosN = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  const conEfectivo = productos.some((p) => p.precioEfectivo && p.precioEfectivo < p.precio);
  const filas = productos.map((p) => ({ ...p, lineas: partir(nombreParaCartel(p.nombre), 32, 600, 2) }));
  const altoFila = (f: { lineas: string[]; precioEfectivo?: number | null; precio: number }) =>
    (f.lineas.length > 1 ? 40 : 0) + (f.precioEfectivo && f.precioEfectivo < f.precio ? 128 : 96);
  const alto = TOP + filas.reduce((s, f) => s + altoFila(f) + SEP, 0) + (conEfectivo ? 150 : 90);
  let y = TOP;
  const cuerpo = filas.map((f) => {
    const h = altoFila(f);
    const efectivo = f.precioEfectivo && f.precioEfectivo < f.precio;
    const s = `
    <rect x="${M}" y="${y}" width="${W - 2 * M}" height="${h}" rx="18" fill="#FFFFFF" stroke="${LINEA}" stroke-width="2"/>
    ${f.lineas.map((t, k) => `<text x="${M + 32}" y="${y + 56 + k * 38}" font-family="Inter" font-weight="600" font-size="32" fill="${NEGRO}">${esc(t)}</text>`).join('')}
    ${efectivo ? `<text x="${M + 32}" y="${y + 56 + f.lineas.length * 38 + 6}" font-family="Inter" font-size="26" fill="${ROJO}">${esc(`${pesosN(f.precioEfectivo!)} en efectivo o transferencia`)}</text>` : ''}
    <text x="${W - M - 32}" y="${y + 60}" font-family="Inter" font-weight="800" font-size="38" fill="${NEGRO}" text-anchor="end">${esc(pesosN(f.precio))}</text>`;
    y += h + SEP;
    return s;
  }).join('');
  const pie = conEfectivo
    ? `<text x="${W / 2}" y="${y + 52}" font-family="Inter" font-weight="600" font-size="26" fill="${NEGRO}" text-anchor="middle">En rojo: pagando en efectivo o transferencia</text>
       <text x="${W / 2}" y="${y + 96}" font-family="Inter" font-size="24" fill="${GRIS}" text-anchor="middle">Precios al ${esc(fecha)}</text>`
    : `<text x="${W / 2}" y="${y + 52}" font-family="Inter" font-size="24" fill="${GRIS}" text-anchor="middle">Precios al ${esc(fecha)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${alto}" viewBox="0 0 ${W} ${alto}">
  <rect width="${W}" height="${alto}" fill="${CREMA}"/>
  <rect width="${W}" height="200" fill="${ROJO}"/>
  <image x="${M}" y="40" width="190" height="${Math.round((190 * 74) / 121)}" href="data:image/png;base64,${LOGO_ODB_BLANCO}"/>
  <text x="${W - M}" y="96" font-family="Montserrat" font-weight="800" font-size="42" fill="#FFFFFF" text-anchor="end">PRECIOS</text>
  <text x="${W - M}" y="142" font-family="Inter" font-size="27" fill="#FFFFFF" fill-opacity="0.8" text-anchor="end">${productos.length} productos</text>
  ${cuerpo}
  ${pie}
</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: await tipografias(), defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: W } });
  return Buffer.from(png.render().asPng());
}
