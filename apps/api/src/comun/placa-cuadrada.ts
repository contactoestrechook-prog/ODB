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
  // 1) ¿Entra todo en una página? Se prueba de la escala más grande a 1.
  for (let s = ESCALA_MAX; s >= 1 - 1e-9; s -= 0.05) {
    const ancho = ANCHO_UTIL / s;
    const r = o.renglones(ancho);
    const p = o.pie(ancho);
    const alto = alturaDe(r, SEP) + (r.length && p.length ? SEP_PIE : 0) + alturaDe(p, SEP_PIE);
    if (INICIO + alto * s <= FIN) {
      const y0 = INICIO + (FIN - INICIO - alto * s) / 2;
      const a = pila(r, SEP, ancho);
      const b = pila(p, SEP_PIE, ancho);
      const cuerpo = `<g transform="translate(${M} ${y0.toFixed(1)}) scale(${s.toFixed(3)})">
    ${a.svg}
    <g transform="translate(0 ${a.alto + (r.length && p.length ? SEP_PIE : 0)})">${b.svg}</g>
  </g>`;
      return [pagina(o, franjaCompleta(o, o.sub), cuerpo)];
    }
  }

  const renglones = o.renglones(ANCHO_UTIL);
  const pie = o.pie(ANCHO_UTIL);
  const altoPie = alturaDe(pie, SEP_PIE);

  // 2) Una sola página, cortada: entran los renglones que quepan junto con el
  //    pie y la línea de "…y N más".
  if (o.unaSola) {
    const lugar = FIN - INICIO - altoPie - SEP_PIE;
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
    const a = pila(lista, SEP, ANCHO_UTIL);
    const b = pila(pie, SEP_PIE, ANCHO_UTIL);
    const cuerpo = `<g transform="translate(${M} ${INICIO})">${a.svg}<g transform="translate(0 ${a.alto + SEP_PIE})">${b.svg}</g></g>`;
    return [pagina(o, franjaCompleta(o, o.sub), cuerpo)];
  }

  // 3) Varias páginas: se llena cada una con renglones; el pie va entero en
  //    la última, con al menos un renglón para que no quede solo.
  const grupos: Bloque[][] = [];
  let actual: Bloque[] = [];
  let usado = 0;
  let lugar = FIN - INICIO;
  for (const r of renglones) {
    const necesita = usado + (actual.length ? SEP : 0) + r.alto;
    if (necesita > lugar && actual.length) {
      grupos.push(actual);
      actual = [];
      usado = 0;
      lugar = FIN - INICIO_CHICA;
    }
    usado += (actual.length ? SEP : 0) + r.alto;
    actual.push(r);
  }
  // ¿entra el pie en la última?
  while (actual.length && usado + SEP_PIE + altoPie > lugar) {
    // se pasa el último renglón a una página nueva, junto con el pie
    const ultimo = actual.pop()!;
    if (!actual.length) { actual.push(ultimo); break; }
    grupos.push(actual);
    actual = [ultimo];
    usado = ultimo.alto;
    lugar = FIN - INICIO_CHICA;
  }
  grupos.push(actual);

  const total = grupos.length;
  return grupos.map((g, i) => {
    const primera = i === 0;
    const ultima = i === total - 1;
    const inicio = primera ? INICIO : INICIO_CHICA;
    const a = pila(g, SEP, ANCHO_UTIL);
    const b = ultima ? pila(pie, SEP_PIE, ANCHO_UTIL) : null;
    const cuerpo = `<g transform="translate(${M} ${inicio})">${a.svg}${b ? `<g transform="translate(0 ${a.alto + SEP_PIE})">${b.svg}</g>` : ''}</g>`;
    const cabecera = primera ? franjaCompleta(o, `${o.sub} · 1/${total}`) : franjaChica(o, i + 1, total);
    return pagina(o, cabecera, cuerpo);
  });
}
