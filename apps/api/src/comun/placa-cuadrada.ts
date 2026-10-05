// Páginas CUADRADAS para las tarjetas Placa roja (3/10/2026).
//
// WhatsApp en iPhone muestra cualquier imagen sin ancho y alto declarados
// como un CUADRADO recortado desde el centro, y WAHA (motor NOWEB) manda las
// tarjetas sin esos datos (comprobado en la charla de las picadas: width,
// height y miniatura vacíos). Una tarjeta de 1 producto (1080×780) se veía
// "O.B … RESU … $133.5". Por eso toda tarjeta es de 1080×1080:
// - si entra en una página, el contenido se agranda (hasta 1,35) para llenar
//   el cuadrado y se centra debajo de la franja;
// - si no entra, se reparte en varias páginas cuadradas: la primera con la
//   franja completa, las siguientes con una franja angosta "TÍTULO · 2/3", y
//   el pie (total, entrega, nota) siempre junto, en la última;
// - con unaSola (nota al proveedor, aviso de devolución), lo que no entra se
//   corta y la última línea dice cuántos faltan.
//
// Cada bloque se dibuja en coordenadas propias: x de 0 a `ancho` (el ancho
// útil a escala 1) e y desde 0; acá se ubica con translate y scale.

import { LOGO_ODB_BLANCO } from './logo-odb';

export const LADO = 1080;
const M = 48;
const ANCHO_UTIL = LADO - 2 * M; // 984
const FRANJA = 200;
const FRANJA_CHICA = 116;
const INICIO = FRANJA + 40; // donde empieza el contenido en la primera página
const INICIO_CHICA = FRANJA_CHICA + 30;
const FIN = LADO - 40;
const SEP = 14; // entre renglones
const SEP_PIE = 26; // entre bloques del pie
const ESCALA_MAX = 1.35;
const ESCALA_MIN_UNA = 0.8; // más chico ya no se lee en el globo
const ESCALA_MIN_VARIAS = 0.85;

export type Bloque = { alto: number; dibujar: (y: number, ancho: number) => string };

export type OpcionesPlaca = {
  titulo: string;
  sub: string;
  /** Los renglones, armados para un ancho dado (el texto se parte según el ancho). */
  renglones: (ancho: number) => Bloque[];
  /** Lo que va al final y nunca se separa: total, entrega, nota. */
  pie: (ancho: number) => Bloque[];
  /** Una sola página: lo que no entra se corta y `masTexto(n)` avisa cuántos quedaron afuera. */
  unaSola?: { masTexto: (n: number) => string };
  fondo: string;
  rojo: string;
  gris: string;
};

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const alturaDe = (bloques: Bloque[], sep: number) =>
  bloques.reduce((s, b, i) => s + b.alto + (i > 0 ? sep : 0), 0);

function franjaCompleta(o: OpcionesPlaca, sub: string): string {
  return `
  <rect width="${LADO}" height="${FRANJA}" fill="${o.rojo}"/>
  <image x="${M}" y="40" width="190" height="${Math.round((190 * 74) / 121)}" href="data:image/png;base64,${LOGO_ODB_BLANCO}"/>
  <text x="${LADO - M}" y="96" font-family="Montserrat" font-weight="800" font-size="42" fill="#FFFFFF" text-anchor="end">${esc(o.titulo.toUpperCase())}</text>
  <text x="${LADO - M}" y="142" font-family="Inter" font-size="27" fill="#FFFFFF" fill-opacity="0.8" text-anchor="end">${esc(sub)}</text>`;
}

function franjaChica(o: OpcionesPlaca, pagina: number, total: number): string {
  return `
  <rect width="${LADO}" height="${FRANJA_CHICA}" fill="${o.rojo}"/>
  <image x="${M}" y="22" width="118" height="${Math.round((118 * 74) / 121)}" href="data:image/png;base64,${LOGO_ODB_BLANCO}"/>
  <text x="${LADO - M}" y="72" font-family="Montserrat" font-weight="800" font-size="34" fill="#FFFFFF" text-anchor="end">${esc(`${o.titulo.toUpperCase()} · ${pagina}/${total}`)}</text>`;
}

function pila(bloques: Bloque[], sep: number, ancho: number): { svg: string; alto: number } {
  let y = 0;
  const partes = bloques.map((b, i) => {
    if (i > 0) y += sep;
    const s = b.dibujar(y, ancho);
    y += b.alto;
    return s;
  });
  return { svg: partes.join(''), alto: y };
}

function pagina(o: OpcionesPlaca, cabecera: string, cuerpo: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LADO}" height="${LADO}" viewBox="0 0 ${LADO} ${LADO}">
  <rect width="${LADO}" height="${LADO}" fill="${o.fondo}"/>
  ${cabecera}
  ${cuerpo}
</svg>`;
}

/** Línea centrada en gris ("…y 3 productos más"), como bloque. */
export function lineaCentrada(texto: string, color: string, tamano = 28, alto = 52): Bloque {
  return {
    alto,
    dibujar: (y, ancho) =>
      `<text x="${ancho / 2}" y="${y + alto / 2 + tamano / 3}" font-family="Inter" font-weight="600" font-size="${tamano}" fill="${color}" text-anchor="middle">${esc(texto)}</text>`,
  };
}

/**
 * Las páginas (SVG de 1080×1080) de una tarjeta. Una sola si entra; si no,
 * varias (o una cortada, con unaSola).
 */
export function paginasCuadradas(o: OpcionesPlaca): string[] {
  // 1) ¿Entra todo en una página? Se prueba de la escala más grande a la más
  //    chica que todavía se lee (0,8): con 3 o 4 productos, una sola imagen es
  //    mejor que dos.
  for (let s = ESCALA_MAX; s >= ESCALA_MIN_UNA - 1e-9; s -= 0.05) {
    const ancho = ANCHO_UTIL / s;
    const r = o.renglones(ancho);
    const p = o.pie(ancho);
    const alto = alturaDe(r, SEP) + (r.length && p.length ? SEP_PIE : 0) + alturaDe(p, SEP_PIE);
    if (INICIO + alto * s <= FIN) {
      return [pagina(o, franjaCompleta(o, o.sub), cuerpoCentrado(r, p, ancho, s, INICIO))];
    }
  }

  // 2) Una sola página, cortada: entran los renglones que quepan junto con el
  //    pie y la línea de "…y N más".
  if (o.unaSola) {
    // a 0,85, para que entren más renglones antes del "…y N más"
    const s = ESCALA_MIN_VARIAS;
    const anchoCorte = ANCHO_UTIL / s;
    const renglones = o.renglones(anchoCorte);
    const pie = o.pie(anchoCorte);
    const lugar = (FIN - INICIO) / s - alturaDe(pie, SEP_PIE) - SEP_PIE;
    const entran: Bloque[] = [];
    let usado = 0;
    for (let i = 0; i < renglones.length; i++) {
      const resto = renglones.length - (i + 1);
      const extra = resto > 0 ? SEP + 52 : 0;
      const necesita = usado + (entran.length ? SEP : 0) + renglones[i].alto;
      if (necesita + extra > lugar) break;
      entran.push(renglones[i]);
      usado = necesita;
    }
    const fuera = renglones.length - entran.length;
    const lista = fuera > 0 ? [...entran, lineaCentrada(o.unaSola.masTexto(fuera), o.gris)] : entran;
    return [pagina(o, franjaCompleta(o, o.sub), cuerpoCentrado(lista, pie, anchoCorte, s, INICIO))];
  }

  // 3) Varias páginas: la menor cantidad posible (achicando hasta 0,85 si con
  //    eso se ahorra una), cada una con su contenido centrado y el pie entero
  //    en la última.
  let mejor: { s: number; grupos: Bloque[][]; pie: Bloque[]; ancho: number } | null = null;
  for (let s = 1; s >= ESCALA_MIN_VARIAS - 1e-9; s -= 0.05) {
    const ancho = ANCHO_UTIL / s;
    const grupos = repartir(o.renglones(ancho), o.pie(ancho), s);
    if (!mejor || grupos.length < mejor.grupos.length) mejor = { s, grupos, pie: o.pie(ancho), ancho };
  }
  const { s, grupos, pie, ancho } = mejor!;
  const total = grupos.length;
  return grupos.map((g, i) => {
    const primera = i === 0;
    const ultima = i === total - 1;
    const cabecera = primera ? franjaCompleta(o, `${o.sub} · 1/${total}`) : franjaChica(o, i + 1, total);
    return pagina(o, cabecera, cuerpoCentrado(g, ultima ? pie : [], ancho, s, primera ? INICIO : INICIO_CHICA));
  });
}

/** Renglones y pie, escalados y centrados entre `inicio` y el final de la página. */
function cuerpoCentrado(r: Bloque[], p: Bloque[], ancho: number, s: number, inicio: number): string {
  const a = pila(r, SEP, ancho);
  const b = pila(p, SEP_PIE, ancho);
  const entre = r.length && p.length ? SEP_PIE : 0;
  const alto = a.alto + entre + b.alto;
  const y0 = inicio + Math.max(0, (FIN - inicio - alto * s) / 2);
  return `<g transform="translate(${M} ${y0.toFixed(1)}) scale(${s.toFixed(3)})">
    ${a.svg}
    ${p.length ? `<g transform="translate(0 ${a.alto + entre})">${b.svg}</g>` : ''}
  </g>`;
}

/** Reparte los renglones en páginas a escala s; el pie va en la última, con al menos un renglón. */
function repartir(renglones: Bloque[], pie: Bloque[], s: number): Bloque[][] {
  const altoPie = alturaDe(pie, SEP_PIE);
  const lugarPrimera = (FIN - INICIO) / s;
  const lugarOtras = (FIN - INICIO_CHICA) / s;
  const grupos: Bloque[][] = [];
  let actual: Bloque[] = [];
  let usado = 0;
  let lugar = lugarPrimera;
  for (const r of renglones) {
    const necesita = usado + (actual.length ? SEP : 0) + r.alto;
    if (necesita > lugar && actual.length) {
      grupos.push(actual);
      actual = [];
      usado = 0;
      lugar = lugarOtras;
    }
    usado += (actual.length ? SEP : 0) + r.alto;
    actual.push(r);
  }
  // si el pie no entra en la última, el último renglón pasa a una página
  // nueva junto con el pie
  if (actual.length > 1 && usado + SEP_PIE + altoPie > lugar) {
    const ultimo = actual.pop()!;
    grupos.push(actual);
    actual = [ultimo];
  }
  grupos.push(actual);
  return parejo(grupos, pie, s) ?? grupos;
}

/**
 * Las mismas páginas, con los renglones repartidos parejo (3 y 3 en vez de 5
 * y 1): una última página con un solo producto y medio cuadrado vacío se ve
 * descuidada. Lo que sobra va en las primeras (la última lleva el pie). null
 * si el reparto parejo no entra.
 */
function parejo(grupos: Bloque[][], pie: Bloque[], s: number): Bloque[][] | null {
  const n = grupos.length;
  if (n < 2) return null;
  const todos = grupos.flat();
  const base = Math.floor(todos.length / n);
  const extra = todos.length % n;
  const salida: Bloque[][] = [];
  let i = 0;
  for (let p = 0; p < n; p++) {
    const cuantos = base + (p < extra ? 1 : 0);
    const g = todos.slice(i, i + cuantos);
    i += cuantos;
    const lugar = (FIN - (p === 0 ? INICIO : INICIO_CHICA)) / s;
    const alto = alturaDe(g, SEP) + (p === n - 1 ? SEP_PIE + alturaDe(pie, SEP_PIE) : 0);
    if (!g.length || alto > lugar) return null;
    salida.push(g);
  }
  return salida;
}
