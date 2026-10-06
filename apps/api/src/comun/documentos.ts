import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decompress } from 'wawoff2';
import { LOGO_ODB_BLANCO } from './logo-odb';
import { ROJO, NEGRO, CREMA, GRIS, LINEA as BORDE } from './cartel-pedido';
import { leyendaRechazo } from './rechazo';

// Documentos formales de administración: orden de compra (la que se le manda
// al proveedor) y recibo de cobranza (el que se le da al cliente).
//
// Por qué en papel/PDF y no solo en pantalla: son los documentos que salen de
// la empresa. Una orden de compra sin número ni firma es un mensaje de
// WhatsApp; con folio, fecha y responsable es un compromiso que se puede
// reclamar. Y un cobro sin recibo es la palabra de uno contra la del otro.
//
// El folio lo asigna la base (tabla documentos), no este archivo: acá solo se
// dibuja lo que ya quedó registrado.

// ROJO y NEGRO vienen de la Placa roja (son los mismos que tenía este archivo);
// lo que sigue es del diseño anterior, que conservan el recibo y la orden de
// pago (no detallan productos).
const ORO = '#C9A96E';
const TINTA = '#2A201C';
const HUMO = '#9B9088';
const LINEA = '#E5DCCB';
const W = 595.28;
const L = 50;
const R = W - 50;

const pesos = (n: any) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
// En un papel formal el CUIT va con guiones; en la base viene como venga
const cuitFmt = (c?: string | null) => {
  const d = String(c ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (c || '');
};
const fecha = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

function encabezado(doc: PDFKit.PDFDocument, titulo: string, folio: string, emitidoEn?: string) {
  doc.rect(0, 0, W, 96).fill(NEGRO);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(30).text('O.D.B', L, 28, { characterSpacing: 3 });
  doc.fillColor(ORO).font('Helvetica-Bold').fontSize(9).text('PREMIUM MARKET', L + 2, 64, { characterSpacing: 5 });
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(titulo, L, 30, { width: R - L, align: 'right' });
  doc.fillColor(ORO).font('Helvetica-Bold').fontSize(12).text(folio, L, 52, { width: R - L, align: 'right' });
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(8)
    .text(`Emitido ${fecha(emitidoEn ?? new Date().toISOString())}`, L, 70, { width: R - L, align: 'right' });
  doc.rect(0, 96, W, 3).fill(ORO);
}

function pie(doc: PDFKit.PDFDocument, y: number, nota: string) {
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.fillColor(HUMO).font('Helvetica').fontSize(7.5)
    .text('CHINVENGUENCHA SRL · Castex 3601, Canning · O.D.B Premium Market', L, y + 10, { width: R - L });
  doc.fillColor(HUMO).font('Helvetica-Oblique').fontSize(7.5).text(nota, L, y + 22, { width: R - L });
}

// ============================================================================
// PLACA ROJA EN PAPEL (2/10/2026). Pedido de Leandro: "siempre que se detallen
// productos vamos a usar el paquete gráfico de pedidos y lista de precio que
// estamos usando, cambialo en todo el sistema". Los papeles que detallan
// productos (nota de pedido, orden de compra, acta de recepción y el
// presupuesto de eventos) se dibujan como la tarjeta que sale por WhatsApp
// (cartel-pedido.ts): franja roja con el logo y el título, fondo crema, un
// renglón por producto en su caja blanca con la cantidad en el círculo rojo, y
// el total en la píldora negra. Los datos son los mismos de antes (folio, CUIT,
// fechas, firmas, leyendas): cambia cómo se ven, no qué dicen.
//
// Las medidas salen del SVG del cartel (1080 px de ancho) llevadas a A4 y un
// poco más compactas, para que entren ~15 renglones en la primera hoja y ~19 en
// las siguientes (el cartel es para leer en el celular; esto se imprime).
// ============================================================================

const H = 841.89;
const M = 30; // margen: los 48 px del cartel, llevados a A4
const ANCHO = W - 2 * M;
const FRANJA = 96;
const ARRIBA = 46; // donde siguen los renglones en las hojas 2 en adelante
const TOPE = H - 40; // ninguna caja pasa de acá: abajo va "Hoja 1 de 2"
const PIE_Y = H - 72; // el pie (razón social y leyenda) del último papel
const TOPE_CIERRE = PIE_Y - 10;
const SEP = 4; // entre caja y caja
export const PILDORA = 40;
const R_CIRCULO = 11;
const X_CIRCULO = M + 21;
const X_NOMBRE = M + 44; // el nombre, a la derecha del círculo
const DER = W - M - 14; // borde derecho del importe, dentro de la caja
const RESERVA_IMPORTE = 112; // lo que ocupa "$123.456.789" a la derecha
const COLUMNA = 58; // acta: ancho de "pedido" y "diferencia"
// el nombre del producto: 10 pt, renglones cada 12; la línea gris, 11 más abajo
const PASO = 12;
const ALTO_MAYUSCULA = 7.3; // de la base a la parte de arriba de una mayúscula de 10 pt
const BAJA_GRIS = 11;
// observaciones: con 30 renglones (≈ 360 pt) el cierre todavía entra en una hoja
const MAX_OBS = 30;

const LOGO = Buffer.from(LOGO_ODB_BLANCO, 'base64');

/** "$1.234.567", como en la tarjeta (sin espacio después del signo). */
export const importe = (n: unknown) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
/** 24 → "24", 1200 → "1.200", 2.5 (kilos) → "2,5". */
export const cantidad = (n: unknown) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });

// Las letras: Inter 400, 600 y 800, las que se ven en la tarjeta. El cartel le
// pide "Montserrat" al título y al TOTAL, pero la de @fontsource se llama
// "Montserrat Thin ExtraBold", resvg no la encuentra y dibuja Inter ExtraBold:
// eso es lo que ve el cliente, y eso se copia. pdfkit no puede recortar las
// woff2 tal cual (fontkit revienta al cerrar el PDF: "Offset is outside the
// bounds of the DataView"), así que se pasan a TTF en memoria, una sola vez.
// Si no están, el papel sale igual en Helvetica: un documento no deja de salir
// por una tipografía.
export type Letra = 'normal' | 'media' | 'fuerte' | 'cursiva';
const HELVETICA: Record<Letra, string> = { normal: 'Helvetica', media: 'Helvetica-Bold', fuerte: 'Helvetica-Bold', cursiva: 'Helvetica-Oblique' };
const INTER: Record<Letra, [nombre: string, archivo: string]> = {
  normal: ['Inter', 'inter-latin-400-normal.woff2'],
  media: ['Inter-SemiBold', 'inter-latin-600-normal.woff2'],
  fuerte: ['Inter-ExtraBold', 'inter-latin-800-normal.woff2'],
  cursiva: ['Inter-Italic', 'inter-latin-400-italic.woff2'],
};
const LETRAS = Object.keys(INTER) as Letra[];

let interTTF: Promise<Record<Letra, Buffer> | null> | null = null;

function archivoInter(archivo: string): string {
  try {
    return require.resolve(`@fontsource/inter/files/${archivo}`);
  } catch {
    return join(process.cwd(), 'node_modules', '@fontsource', 'inter', 'files', archivo);
  }
}

function letrasInter(): Promise<Record<Letra, Buffer> | null> {
  interTTF ??= (async () => {
    try {
      const ttf = {} as Record<Letra, Buffer>;
      for (const l of LETRAS) ttf[l] = Buffer.from(await decompress(await readFile(archivoInter(INTER[l][1]))));
      return ttf;
    } catch {
      return null;
    }
  })();
  return interTTF;
}

export type Estilo = { letra: Letra; tam: number; color?: string; opacidad?: number; espaciado?: number };
export type Quien = { rotulo: string; nombre: string; detalle?: string | null };
export type RenglonPlaca = {
  /** va en el círculo rojo */
  cantidad: number;
  nombre: string;
  /** la línea gris de abajo: código, "cantidad × unitario" */
  gris?: string | null;
  /** a la derecha, en negrita (el subtotal) */
  importe?: string | null;
  /** acta de recepción: pedido y diferencia, alineados a la derecha */
  columnas?: { texto: string; color?: string; letra?: Letra }[];
};
export type Lugar = { pagina: number; y: number };

/**
 * Dónde va cada renglón (hoja y altura) y dónde arranca el cierre (total,
 * observaciones, firmas). Ninguna caja queda cortada entre hojas, y el último
 * renglón no se separa del cierre: el TOTAL nunca queda solo en una hoja sin
 * productos arriba. `pagina` cuenta desde 0.
 */
export function repartirRenglones(
  altos: number[],
  o: { desde: number; arriba: number; tope: number; sep: number; cierre: number; topeCierre: number },
): { renglones: Lugar[]; cierre: Lugar } {
  const renglones: Lugar[] = [];
  let pagina = 0;
  let y = o.desde;
  const hojaVacia = () => pagina > 0 && y === o.arriba;
  altos.forEach((alto, i) => {
    // si el cierre es tan alto que ni con un renglón solo entra en una hoja, se suelta
    const juntoAlCierre = i === altos.length - 1 && o.arriba + alto + o.sep + o.cierre <= o.topeCierre;
    const entra = y + alto <= o.tope && (!juntoAlCierre || y + alto + o.sep + o.cierre <= o.topeCierre);
    if (!entra && !hojaVacia()) { pagina++; y = o.arriba; }
    renglones.push({ pagina, y });
    y += alto + o.sep;
  });
  if (y + o.cierre > o.topeCierre && !hojaVacia()) { pagina++; y = o.arriba; }
  return { renglones, cierre: { pagina, y } };
}

const altoRenglon = (lineas: number, conGris: boolean) =>
  Math.max(30, ALTO_MAYUSCULA + (lineas - 1) * PASO + (conGris ? BAJA_GRIS : 0) + 16);

/**
 * Un papel con el diseño Placa roja. Se dibuja en orden: abrir (franja), datos
 * (recuadro de arriba), renglones, cierre (píldora, recuadros, firmas), pie y
 * cerrar. Lo usa también el presupuesto de eventos (eventos/presupuesto.ts).
 */
export class HojaPlacaRoja {
  private pagina = 0;
  /** El ancho de las cajas (de margen a margen). */
  readonly anchoUtil = ANCHO;

  private constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly letras: Record<Letra, string>,
    private readonly titulo: string,
    private readonly folio: string,
    private readonly listo: Promise<Buffer>,
  ) {}

  static async abrir(titulo: string, folio: string, subtitulo: string): Promise<HojaPlacaRoja> {
    const ttf = await letrasInter();
    // bufferPages: el "Hoja 1 de 2" se escribe al final, cuando ya se sabe cuántas son
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const trozos: Buffer[] = [];
    const listo = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c) => trozos.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(trozos)));
      doc.on('error', reject);
    });
    let letras = HELVETICA;
    if (ttf) {
      for (const l of LETRAS) doc.registerFont(INTER[l][0], ttf[l]);
      letras = { normal: INTER.normal[0], media: INTER.media[0], fuerte: INTER.fuerte[0], cursiva: INTER.cursiva[0] };
    }
    const h = new HojaPlacaRoja(doc, letras, titulo, folio, listo);
    h.fondo();
    h.franja(subtitulo);
    return h;
  }

  medir(t: string, e: Estilo): number {
    return this.doc.font(this.letras[e.letra]).fontSize(e.tam).widthOfString(t, { characterSpacing: e.espaciado ?? 0 });
  }

  /** Un renglón de texto con la BASE en y, como en el SVG del cartel. Devuelve el ancho. */
  texto(t: string, x: number, y: number, e: Estilo & { alinear?: 'der' | 'centro' }): number {
    const ancho = this.medir(t, e);
    const x0 = e.alinear === 'der' ? x - ancho : e.alinear === 'centro' ? x - ancho / 2 : x;
    this.doc.fillColor(e.color ?? NEGRO, e.opacidad ?? 1)
      .text(t, x0, y, { lineBreak: false, baseline: 'alphabetic', characterSpacing: e.espaciado ?? 0 });
    // la opacidad queda pegada a los rellenos que siguen (cajas, círculos): se vuelve a 1
    this.doc.fillOpacity(1);
    return ancho;
  }

  /** Corta un texto en renglones que entran en `ancho`; si sobra, el último termina en "…". */
  partir(texto: string, e: Estilo, ancho: number, max: number): string[] {
    const mide = (s: string) => this.medir(s, e);
    const lineas: string[] = [];
    for (const parrafo of String(texto ?? '').split(/\r?\n/)) {
      // la medida no se parte ("750" en un renglón y "cc" en el otro): espacio duro, como en el cartel
      const palabras = parrafo.replace(/\s+/g, ' ').trim().replace(/(\d) (cc|ml|L|kg|g)\b/g, '$1 $2').split(' ').filter(Boolean);
      let actual = '';
      for (const p of palabras) {
        const prueba = actual ? `${actual} ${p}` : p;
        if (!actual || mide(prueba) <= ancho) actual = prueba;
        else { lineas.push(actual); actual = p; }
      }
      if (actual) lineas.push(actual);
    }
    if (!lineas.length) return ['—'];
    if (lineas.length > max) lineas.splice(max - 1, lineas.length, lineas.slice(max - 1).join(' '));
    return lineas.map((l) => {
      if (mide(l) <= ancho) return l;
      let r = l;
      while (r.length > 1 && mide(`${r}…`) > ancho) r = r.slice(0, -1);
      return `${r.trimEnd()}…`;
    });
  }

  private fondo() {
    this.doc.rect(0, 0, W, H).fill(CREMA);
  }

  private franja(subtitulo: string) {
    this.doc.rect(0, 0, W, FRANJA).fill(ROJO);
    const ancho = 92;
    const alto = (ancho * 74) / 121;
    this.doc.image(LOGO, M, (FRANJA - alto) / 2, { width: ancho, height: alto });
    const lugar = ANCHO - ancho - 24; // lo que queda a la derecha del logo
    this.texto(this.partir(this.titulo, { letra: 'fuerte', tam: 20 }, lugar, 1)[0], W - M, 46, { letra: 'fuerte', tam: 20, color: '#FFFFFF', alinear: 'der' });
    this.texto(this.partir(subtitulo, { letra: 'normal', tam: 12 }, lugar, 1)[0], W - M, 67, { letra: 'normal', tam: 12, color: '#FFFFFF', opacidad: 0.8, alinear: 'der' });
  }

  /** Pasa a la hoja `pagina` (las hojas que siguen no llevan franja: los renglones siguen arriba). */
  irA(pagina: number) {
    while (this.pagina < pagina) {
      this.doc.addPage({ size: 'A4', margin: 0 });
      this.pagina++;
      this.fondo();
      // de qué papel es, por si las hojas se separan
      this.texto(`${this.titulo} · ${this.folio}`, M, 30, { letra: 'media', tam: 8, color: GRIS, espaciado: 0.4 });
    }
  }

  private caja(y: number, alto: number) {
    this.doc.lineWidth(0.75).roundedRect(M, y, ANCHO, alto, 7).fillAndStroke('#FFFFFF', BORDE);
  }

  /**
   * El recuadro blanco de arriba: a quién (izquierda) y las condiciones o el
   * otro "quién" (derecha). Devuelve dónde termina.
   */
  datos(izq: Quien, der: Quien | [string, string][]): number {
    const y = FRANJA + 16;
    const PAD = 16;
    const col = (ANCHO - 2 * PAD - 24) / 2;
    const xIzq = M + PAD;
    const xDer = xIzq + col + 24;
    const ROTULO: Estilo = { letra: 'fuerte', tam: 8, color: ROJO, espaciado: 1.2 };
    const NOMBRE: Estilo = { letra: 'fuerte', tam: 13, color: NEGRO };
    const DETALLE: Estilo = { letra: 'normal', tam: 9, color: GRIS };
    const CLAVE: Estilo = { letra: 'normal', tam: 8.5, color: GRIS };
    const VALOR: Estilo = { letra: 'media', tam: 9, color: NEGRO };

    // primero se mide todo (para saber el alto de la caja), después se dibuja.
    // Acá no se recorta nada en la práctica (topes altos): son los datos del papel
    // (razón social, CUIT, dirección de entrega) y no pueden perderse en un "…".
    const quien = (q: Quien, x: number) => {
      const nombre = this.partir(q.nombre, NOMBRE, col, 3);
      const detalle = q.detalle ? this.partir(q.detalle, DETALLE, col, 4) : [];
      const fin = 40 + (nombre.length - 1) * 16 + (detalle.length ? 15 + (detalle.length - 1) * 12 : 0);
      const dibujar = () => {
        this.texto(q.rotulo, x, y + 22, ROTULO);
        nombre.forEach((l, k) => this.texto(l, x, y + 40 + k * 16, NOMBRE));
        detalle.forEach((l, k) => this.texto(l, x, y + 40 + (nombre.length - 1) * 16 + 15 + k * 12, DETALLE));
      };
      return { fin, dibujar };
    };
    const pares = (lista: [string, string][]) => {
      const anchoClave = Math.max(...lista.map(([k]) => this.medir(k, CLAVE)));
      const filas: { clave: string; valor: string[]; base: number }[] = [];
      let base = 22;
      for (const [clave, valor] of lista) {
        // un valor largo (sucursal y dirección) ocupa los renglones que haga falta: no se pisa con el siguiente
        const v = this.partir(valor, VALOR, col - anchoClave - 10, 5);
        filas.push({ clave, valor: v, base });
        base += 15 + (v.length - 1) * 12;
      }
      const fin = filas.length ? filas[filas.length - 1].base + (filas[filas.length - 1].valor.length - 1) * 12 : 22;
      const dibujar = () => filas.forEach((f) => {
        this.texto(f.clave, xDer, y + f.base, CLAVE);
        f.valor.forEach((l, k) => this.texto(l, M + ANCHO - PAD, y + f.base + k * 12, { ...VALOR, alinear: 'der' }));
      });
      return { fin, dibujar };
    };
    const a = quien(izq, xIzq);
    const b = Array.isArray(der) ? pares(der) : quien(der, xDer);
    const alto = Math.max(a.fin, b.fin) + 15;
    this.caja(y, alto);
    a.dibujar();
    b.dibujar();
    return y + alto;
  }

  /**
   * Los renglones, uno por caja, repartidos en las hojas que hagan falta.
   * `altoCierre` es lo que va abajo (píldora, recuadros, firmas): se mide antes
   * para que el último renglón quede en la misma hoja que el total. Devuelve
   * dónde arranca el cierre (ya en su hoja).
   */
  renglones(filas: RenglonPlaca[], o: { desde: number; altoCierre: number; rotuloCirculo?: string; columnas?: string[] }): Lugar {
    const reserva = o.columnas ? COLUMNA * o.columnas.length + 10 : filas.some((f) => f.importe) ? RESERVA_IMPORTE : 0;
    const anchoNombre = DER - reserva - X_NOMBRE;
    const medidas = filas.map((f) => {
      const nombre = this.partir(f.nombre, { letra: 'media', tam: 10 }, anchoNombre, 2);
      const gris = f.gris ? this.partir(f.gris, { letra: 'normal', tam: 8 }, anchoNombre, 1)[0] : null;
      return { f, nombre, gris, alto: altoRenglon(nombre.length, !!gris) };
    });
    // el acta lleva arriba de los renglones qué es cada número (en cada hoja)
    const rotulos = o.columnas ? 16 : 0;
    const plan = repartirRenglones(medidas.map((m) => m.alto), {
      desde: o.desde + rotulos, arriba: ARRIBA + rotulos, tope: TOPE, sep: SEP, cierre: o.altoCierre, topeCierre: TOPE_CIERRE,
    });
    let conRotulos = -1;
    medidas.forEach((m, i) => {
      const { pagina, y } = plan.renglones[i];
      this.irA(pagina);
      if (o.columnas && conRotulos !== pagina) {
        this.rotulosColumnas(y - rotulos, o.rotuloCirculo ?? '', o.columnas);
        conRotulos = pagina;
      }
      this.renglon(y, m.alto, m.f, m.nombre, m.gris);
    });
    this.irA(plan.cierre.pagina);
    return plan.cierre;
  }

  private rotulosColumnas(y: number, circulo: string, columnas: string[]) {
    const e: Estilo = { letra: 'fuerte', tam: 6.5, color: GRIS, espaciado: 0.6 };
    if (circulo) this.texto(circulo, X_CIRCULO, y + 10, { ...e, alinear: 'centro' });
    this.texto('PRODUCTO', X_NOMBRE, y + 10, e);
    columnas.forEach((c, k) => this.texto(c, DER - (columnas.length - 1 - k) * COLUMNA, y + 10, { ...e, alinear: 'der' }));
  }

  private renglon(y: number, alto: number, f: RenglonPlaca, nombre: string[], gris: string | null) {
    const cy = y + alto / 2;
    this.caja(y, alto);
    // la cantidad en el círculo rojo; si es larga ("1.200") se achica la letra, como en el cartel
    this.doc.circle(X_CIRCULO, cy, R_CIRCULO).fill(ROJO);
    const c = cantidad(f.cantidad);
    let tam = 10.5;
    while (tam > 5.5 && this.medir(c, { letra: 'fuerte', tam }) > 2 * R_CIRCULO - 4) tam -= 0.5;
    this.texto(c, X_CIRCULO, cy + tam * 0.36, { letra: 'fuerte', tam, color: '#FFFFFF', alinear: 'centro' });
    // nombre y línea gris, centrados en la caja
    const visual = ALTO_MAYUSCULA + (nombre.length - 1) * PASO + (gris ? BAJA_GRIS : 0);
    const base = y + (alto - visual) / 2 + ALTO_MAYUSCULA;
    nombre.forEach((l, k) => this.texto(l, X_NOMBRE, base + k * PASO, { letra: 'media', tam: 10, color: NEGRO }));
    if (gris) this.texto(gris, X_NOMBRE, base + (nombre.length - 1) * PASO + BAJA_GRIS, { letra: 'normal', tam: 8, color: GRIS });
    if (f.importe) this.texto(f.importe, DER, cy + 4, { letra: 'fuerte', tam: 11, color: NEGRO, alinear: 'der' });
    f.columnas?.forEach((col, k, todas) => {
      this.texto(col.texto, DER - (todas.length - 1 - k) * COLUMNA, cy + 3.6, { letra: col.letra ?? 'media', tam: 10, color: col.color ?? NEGRO, alinear: 'der' });
    });
  }

  /** La píldora negra: "TOTAL" a la izquierda y el monto a la derecha, en blanco. */
  pildora(y: number, izq: string, der: string) {
    this.doc.roundedRect(M, y, ANCHO, PILDORA, PILDORA / 2).fill(NEGRO);
    const ancho = this.texto(izq, M + 22, y + 25, { letra: 'fuerte', tam: 13, color: '#FFFFFF' });
    let tam = 18;
    while (tam > 10 && this.medir(der, { letra: 'fuerte', tam }) > ANCHO - 44 - ancho - 24) tam -= 0.5;
    this.texto(der, W - M - 22, y + 26.5, { letra: 'fuerte', tam, color: '#FFFFFF', alinear: 'der' });
  }

  altoRecuadro(detalle: string[]): number {
    return detalle.length ? 42 + (detalle.length - 1) * 12 : 30;
  }

  /** Recuadro blanco como el de la entrega: título en negrita (rojo) y el detalle en gris. Devuelve el alto. */
  recuadro(y: number, titulo: string, detalle: string[], colorTitulo = ROJO): number {
    const alto = this.altoRecuadro(detalle);
    this.caja(y, alto);
    const t = this.partir(titulo, { letra: 'fuerte', tam: 10 }, ANCHO - 32, 1)[0];
    this.texto(t, M + 16, y + (detalle.length ? 18 : 19), { letra: 'fuerte', tam: 10, color: colorTitulo });
    detalle.forEach((l, k) => this.texto(l, M + 16, y + 31 + k * 12, { letra: 'normal', tam: 9, color: GRIS }));
    return alto;
  }

  altoLeyenda(lineas: string[]): number {
    return lineas.length ? 8 + lineas.length * 12 : 0;
  }

  /** Texto gris suelto, debajo de la píldora. Devuelve el alto. */
  leyenda(y: number, lineas: string[]): number {
    lineas.forEach((l, k) => this.texto(l, M + 4, y + 16 + k * 12, { letra: 'normal', tam: 9, color: GRIS }));
    return this.altoLeyenda(lineas);
  }

  /** Quién hizo qué: "Emitida por: Fulano" a la izquierda y lo mismo a la derecha. */
  firmas(y: number, izq: [string, string], der: [string, string]) {
    const ROT: Estilo = { letra: 'normal', tam: 8.5, color: GRIS };
    const VAL: Estilo = { letra: 'media', tam: 8.5, color: NEGRO };
    const mitad = ANCHO / 2 - 16;
    const a = this.texto(`${izq[0]} `, M + 4, y, ROT);
    this.texto(this.partir(izq[1], VAL, mitad - a, 1)[0], M + 4 + a, y, VAL);
    const rot = `${der[0]} `;
    const val = this.partir(der[1], VAL, mitad - this.medir(rot, ROT), 1)[0];
    const b = this.texto(val, W - M - 4, y, { ...VAL, alinear: 'der' });
    this.texto(rot, W - M - 4 - b, y, { ...ROT, alinear: 'der' });
  }

  /** El pie del último papel, debajo de una línea. */
  pie(renglones: (Estilo & { texto: string })[], centrado = false) {
    this.doc.moveTo(M, PIE_Y).lineTo(W - M, PIE_Y).lineWidth(0.5).strokeColor(BORDE).stroke();
    let y = PIE_Y + 13;
    for (const r of renglones) {
      for (const l of this.partir(r.texto, r, ANCHO, 2)) {
        this.texto(l, centrado ? W / 2 : M, y, { ...r, alinear: centrado ? 'centro' : undefined });
        y += 11;
      }
    }
  }

  /** Numera las hojas (si hay más de una) y devuelve el PDF. */
  cerrar(): Promise<Buffer> {
    const { start, count } = this.doc.bufferedPageRange();
    if (count > 1) {
      for (let i = 0; i < count; i++) {
        this.doc.switchToPage(start + i);
        this.texto(`Hoja ${i + 1} de ${count}`, W - M, H - 20, { letra: 'normal', tam: 7.5, color: GRIS, alinear: 'der' });
      }
    }
    this.doc.end();
    return this.listo;
  }
}

const RAZON_SOCIAL = 'CHINVENGUENCHA SRL · Castex 3601, Canning · O.D.B Premium Market';

export type DatosOrdenCompra = {
  folio: string;
  emitidoEn?: string;
  numeroInterno: number | string;
  fecha?: string | null;
  proveedor: { razon_social?: string | null; cuit?: string | null; email?: string | null; telefono?: string | null } | null;
  sucursal?: string | null;
  condicionPago?: string | null;
  fechaEntrega?: string | null;
  observaciones?: string | null;
  items: { nombre: string; sku?: string | null; codigoProveedor?: string | null; cantidad: number; costo_unitario: number }[];
  total: number;
  emitidaPor?: string | null;
  aprobadaPor?: string | null;
  // La copia que se le manda al proveedor: "NOTA DE PEDIDO", sin costos ni total.
  // El costo que tenemos puede ser viejo o estar en cero, y un número mal en el
  // papel que recibe el proveedor termina usándose como referencia de precio.
  // El precio lo confirma su factura.
  sinPrecios?: boolean;
};

// Orden de compra y nota de pedido, con el diseño Placa roja (2/10/2026): la
// nota de pedido en PDF viaja junto con la tarjeta de WhatsApp
// (cartelNotaDePedido) y ahora se ven iguales: cantidad en el círculo, producto
// y su código del proveedor, y en la píldora el número de pedido. La orden de
// compra lleva además "cantidad × costo" en la línea gris, el subtotal a la
// derecha y el TOTAL en la píldora.
export async function ordenDeCompraPDF(d: DatosOrdenCompra): Promise<Buffer> {
  const titulo = d.sinPrecios ? 'NOTA DE PEDIDO' : 'ORDEN DE COMPRA';
  const h = await HojaPlacaRoja.abrir(titulo, d.folio, `${d.folio} · Emitido ${fecha(d.emitidoEn ?? new Date().toISOString())}`);

  // A quién se le compra y en qué condiciones
  const datosProv = [d.proveedor?.cuit ? `CUIT ${cuitFmt(d.proveedor.cuit)}` : null, d.proveedor?.telefono, d.proveedor?.email]
    .filter(Boolean).join(' · ');
  const y0 = h.datos({ rotulo: 'PROVEEDOR', nombre: d.proveedor?.razon_social ?? '—', detalle: datosProv || null }, [
    ['Orden interna', `#${d.numeroInterno}`],
    ['Fecha', fecha(d.fecha)],
    ['Entrega en', d.sucursal ?? '—'],
    ['Fecha de entrega', d.fechaEntrega ? fecha(d.fechaEntrega) : 'a convenir'],
    ['Condición de pago', d.condicionPago ?? 'a convenir'],
  ]);

  // Lo que va debajo de los renglones se mide antes: el último renglón no se separa del total
  // (con productos por peso, cantidades con decimales, no se suman "unidades")
  const enteras = d.items.every((it) => Number.isInteger(Number(it.cantidad)));
  const unidades = d.items.reduce((s, it) => s + Number(it.cantidad || 0), 0);
  const resumen = d.sinPrecios
    ? h.partir(`${d.items.length} producto${d.items.length === 1 ? '' : 's'}${enteras ? ` · ${unidades.toLocaleString('es-AR')} unidad${unidades === 1 ? '' : 'es'}` : ''}. Precios según su lista vigente: se confirman con la factura.`, { letra: 'normal', tam: 9 }, ANCHO - 8, 2)
    : [];
  const obs = d.observaciones ? h.partir(d.observaciones, { letra: 'normal', tam: 9 }, ANCHO - 32, MAX_OBS) : [];
  const altoCierre = 4 + PILDORA + h.altoLeyenda(resumen) + (obs.length ? 10 + h.altoRecuadro(obs) : 0) + 26;

  const cierre = h.renglones(d.items.map((it) => ({
    cantidad: Number(it.cantidad),
    nombre: it.nombre,
    gris: d.sinPrecios
      ? (it.codigoProveedor ? `Su código: ${it.codigoProveedor}` : null)
      : [it.sku ? `SKU ${it.sku}` : null, `${cantidad(it.cantidad)} × ${importe(it.costo_unitario)}`].filter(Boolean).join(' · '),
    importe: d.sinPrecios ? null : importe(Number(it.cantidad) * Number(it.costo_unitario)),
  })), { desde: y0 + 12, altoCierre });

  // Total (en la nota de pedido no va: el precio lo pone la factura; va el
  // número de pedido, como en la tarjeta de WhatsApp)
  let y = cierre.y + 4;
  if (d.sinPrecios) h.pildora(y, 'PEDIDO', d.folio);
  else h.pildora(y, 'TOTAL', importe(d.total));
  y += PILDORA;
  y += h.leyenda(y, resumen);
  if (obs.length) y += 10 + h.recuadro(y + 10, 'Observaciones', obs);

  // Responsables: es lo que convierte el papel en trazabilidad
  h.firmas(y + 20, ['Emitida por:', d.emitidaPor ?? '—'], ['Aprobada por:', d.aprobadaPor ?? 'pendiente de aprobación']);

  h.pie([
    { texto: RAZON_SOCIAL, letra: 'normal', tam: 7.5, color: GRIS },
    {
      texto: d.sinPrecios
        ? 'Por favor, confirmen por WhatsApp si pueden entregar todo. La recepción se controla contra este pedido y su remito.'
        : 'Este documento acredita el pedido de la mercadería detallada. La recepción se confirma contra remito.',
      letra: 'cursiva', tam: 7.5, color: GRIS,
    },
  ]);
  return h.cerrar();
}

export type DatosRecibo = {
  folio: string;
  emitidoEn?: string;
  cliente: { nombre?: string | null; dni?: string | null; cuit?: string | null } | null;
  monto: number;
  medio: string;
  concepto?: string | null;
  saldoAnterior?: number | null;
  saldoNuevo?: number | null;
  recibidoPor?: string | null;
  aprobadoPor?: string | null;
};

export function reciboCobranzaPDF(d: DatosRecibo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const trozos: Buffer[] = [];
    doc.on('data', (c) => trozos.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    encabezado(doc, 'RECIBO', d.folio, d.emitidoEn);

    let y = 132;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('RECIBIMOS DE', L, y, { characterSpacing: 1.5 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(15).text(d.cliente?.nombre ?? '—', L, y + 14);
    const doc2 = [d.cliente?.cuit ? `CUIT ${cuitFmt(d.cliente.cuit)}` : null, d.cliente?.dni ? `DNI ${d.cliente.dni}` : null]
      .filter(Boolean).join(' · ');
    if (doc2) doc.fillColor(HUMO).font('Helvetica').fontSize(9).text(doc2, L, y + 34);

    // El importe es lo que se lee primero
    y += 66;
    doc.rect(L, y, R - L, 66).fill('#F3EFE7');
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('LA SUMA DE', L + 16, y + 12, { characterSpacing: 1.2 });
    doc.fillColor(ROJO).font('Helvetica-Bold').fontSize(28).text(pesos(d.monto), L + 16, y + 26);
    doc.fillColor(HUMO).font('Helvetica').fontSize(9)
      .text(`en ${d.medio}`, L, y + 38, { width: R - L - 16, align: 'right' });

    y += 84;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('EN CONCEPTO DE', L, y, { characterSpacing: 1.2 });
    doc.fillColor(TINTA).font('Helvetica').fontSize(10)
      .text(d.concepto || 'Pago a cuenta de su cuenta corriente', L, y + 13, { width: R - L });

    // Cómo queda la cuenta después de este pago
    if (d.saldoAnterior != null || d.saldoNuevo != null) {
      y += 44;
      const filas: [string, string][] = [
        ['Saldo anterior', pesos(d.saldoAnterior ?? 0)],
        ['Este pago', '- ' + pesos(d.monto)],
        ['Saldo actual', pesos(d.saldoNuevo ?? 0)],
      ];
      for (const [k, v] of filas) {
        const ultima = k === 'Saldo actual';
        doc.fillColor(ultima ? TINTA : HUMO).font(ultima ? 'Helvetica-Bold' : 'Helvetica').fontSize(ultima ? 11 : 9.5)
          .text(k, L, y, { width: 240 });
        doc.text(v, L + 240, y, { width: R - L - 240, align: 'right' });
        y += ultima ? 20 : 16;
        if (ultima) doc.moveTo(L, y - 26).lineTo(R, y - 26).lineWidth(0.5).strokeColor(LINEA).stroke();
      }
    }

    y += 30;
    doc.fillColor(HUMO).font('Helvetica').fontSize(8.5)
      .text(`Recibido por: ${d.recibidoPor ?? '—'}`, L, y, { width: 240 });
    doc.text(`Aprobado por: ${d.aprobadoPor ?? '—'}`, L + 250, y, { width: R - L - 250, align: 'right' });

    pie(doc, 700, 'Recibo válido como constancia de pago a cuenta. El saldo definitivo surge de la cuenta corriente.');
    doc.end();
  });
}

export type DatosRemito = {
  folio: string;
  emitidoEn?: string;
  numeroRemito?: string | null; // el número del papel del proveedor
  fecha?: string | null;
  proveedor: { razon_social?: string | null; cuit?: string | null } | null;
  sucursal?: string | null;
  ordenCompra?: string | number | null;
  items: { nombre: string; sku?: string | null; pedido?: number | null; recibido: number }[];
  recibidoPor?: string | null;
  observaciones?: string | null;
};

// Acta de recepción: qué bajó del camión, quién lo contó y contra qué pedido.
// Es el eslabón del medio de la cadena (pedido → recepción → factura): sin
// este papel, un faltante después es la palabra del depósito contra la del
// proveedor. Por eso muestra pedido y recibido en la misma línea y marca en
// rojo lo que no coincide.
//
// Con el diseño Placa roja (2/10/2026): en el círculo rojo va lo RECIBIDO (lo
// que entró al stock, que es lo que certifica el acta) y a la derecha lo
// pedido y la diferencia, en rojo cuando no coincide.
export async function remitoRecepcionPDF(d: DatosRemito): Promise<Buffer> {
  const h = await HojaPlacaRoja.abrir('ACTA DE RECEPCIÓN', d.folio, `${d.folio} · Emitido ${fecha(d.emitidoEn ?? new Date().toISOString())}`);

  const y0 = h.datos({ rotulo: 'RECIBIDO DE', nombre: d.proveedor?.razon_social ?? '—', detalle: d.proveedor?.cuit ? `CUIT ${cuitFmt(d.proveedor.cuit)}` : null }, [
    ['Remito del proveedor', d.numeroRemito || 's/n'],
    ['Fecha de recepción', fecha(d.fecha)],
    ['Depósito', d.sucursal ?? '—'],
    ['Orden de compra', d.ordenCompra ? `#${d.ordenCompra}` : 'sin orden previa'],
  ]);

  let diferencias = 0;
  const filas: RenglonPlaca[] = d.items.map((it) => {
    const pedido = it.pedido == null ? null : Number(it.pedido);
    // al gramo: 2,5 kg pedidos y 2,5 kg recibidos no son "diferencia" por un error de coma flotante
    const dif = pedido == null ? 0 : Math.round((Number(it.recibido) - pedido) * 1000) / 1000;
    if (dif !== 0) diferencias++;
    return {
      cantidad: Number(it.recibido),
      nombre: it.nombre,
      gris: it.sku ? `SKU ${it.sku}` : null,
      columnas: [
        pedido == null ? { texto: '—', color: GRIS, letra: 'normal' } : { texto: cantidad(pedido) },
        dif === 0 ? { texto: '—', color: GRIS, letra: 'normal' } : { texto: dif > 0 ? `+${cantidad(dif)}` : `-${cantidad(-dif)}`, color: ROJO, letra: 'fuerte' },
      ],
    };
  });

  const estado: [string, string] = diferencias
    ? [`${diferencias} renglón/es con diferencia contra lo pedido.`, 'Reclamar al proveedor antes de conciliar la factura.']
    : ['Recepción completa', 'Lo recibido coincide con lo pedido.'];
  const obs = d.observaciones ? h.partir(d.observaciones, { letra: 'normal', tam: 9 }, ANCHO - 32, MAX_OBS) : [];
  const altoCierre = 4 + h.altoRecuadro([estado[1]]) + (obs.length ? 10 + h.altoRecuadro(obs) : 0) + 26;

  const cierre = h.renglones(filas, { desde: y0 + 12, altoCierre, rotuloCirculo: 'RECIBIDO', columnas: ['PEDIDO', 'DIF.'] });

  let y = cierre.y + 4;
  y += h.recuadro(y, estado[0], [estado[1]], diferencias ? ROJO : NEGRO);
  if (obs.length) y += 10 + h.recuadro(y + 10, 'Observaciones', obs);

  h.firmas(y + 20, ['Recibido y contado por:', d.recibidoPor ?? '—'], ['Firma del transportista:', '______________________']);

  h.pie([
    { texto: RAZON_SOCIAL, letra: 'normal', tam: 7.5, color: GRIS },
    { texto: 'Las cantidades de este acta son las que ingresaron al stock. La factura se concilia contra este documento.', letra: 'cursiva', tam: 7.5, color: GRIS },
  ]);
  return h.cerrar();
}

export type DatosOrdenPago = {
  folio: string;
  emitidoEn?: string;
  numeroInterno: number | string;
  proveedor?: string | null;
  medioPago?: string | null;
  vencimiento?: string | null;
  observaciones?: string | null;
  facturas: { numero: string; fecha?: string | null; total: number; imputado: number }[];
  total: number;
  pedidaPor?: string | null;
  aprobadaPor?: string | null;
  pagadaEn?: string | null;
  /** estado de la OP en la base: 'pendiente_aprobacion' | 'aprobada' | 'pagada' | 'rechazada' */
  estado?: string | null;
  rechazadaPor?: string | null;
  rechazadaEn?: string | null;
  rechazoMotivo?: string | null;
};

// Lo que el papel dice del estado y de la firma. Antes decía "autorizada, sin
// pagar" aunque nadie la hubiera firmado, y una OP rechazada salía "Autorizada
// por" el que la rechazó (el rechazo se guardaba en las columnas de la firma).
export function textosOrdenPago(d: DatosOrdenPago): { estado: string; firma: string; nota: string; rechazada: boolean } {
  const rechazada = d.estado === 'rechazada' || !!d.rechazadaEn;
  if (rechazada) {
    return {
      rechazada,
      estado: 'rechazada',
      firma: leyendaRechazo(d.rechazadaPor, d.rechazadaEn, d.rechazoMotivo),
      nota: 'Orden rechazada: no habilita ningún pago.',
    };
  }
  const estado = d.pagadaEn
    ? `pagada ${fecha(d.pagadaEn)}`
    : d.aprobadaPor || d.estado === 'aprobada'
      ? 'autorizada, sin pagar'
      : 'pendiente de autorización';
  return {
    rechazada,
    estado,
    firma: `Autorizada por: ${d.aprobadaPor ?? 'SIN AUTORIZAR'}`,
    nota: 'Sin la firma de autorización esta orden no habilita ningún pago.',
  };
}

// Orden de pago: la autorización escrita para que salga plata de la casa.
// Es el documento que más importa de los cuatro, porque es el único que mueve
// dinero hacia afuera. Dice qué facturas se cancelan, por cuánto, con qué
// medio, quién lo pidió y quién lo firmó.
export function ordenDePagoPDF(d: DatosOrdenPago): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const trozos: Buffer[] = [];
    doc.on('data', (c) => trozos.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    encabezado(doc, 'ORDEN DE PAGO', d.folio, d.emitidoEn);

    let y = 126;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('PAGAR A', L, y, { characterSpacing: 1.5 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(13).text(d.proveedor ?? 'Varios proveedores', L, y + 13);

    const textos = textosOrdenPago(d);
    const dchaX = 340;
    const cond: [string, string][] = [
      ['Orden interna', `#${d.numeroInterno}`],
      ['Medio de pago', d.medioPago ?? 'transferencia'],
      ['Vencimiento', d.vencimiento ? fecha(d.vencimiento) : '—'],
      ['Estado', textos.estado],
    ];
    let yc = y;
    for (const [k, v] of cond) {
      doc.fillColor(HUMO).font('Helvetica').fontSize(8).text(k, dchaX, yc, { width: 110 });
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(v, dchaX + 100, yc - 1, { width: R - dchaX - 100, align: 'right' });
      yc += 15;
    }

    y = Math.max(y + 46, yc + 10);
    doc.rect(L, y, R - L, 22).fill('#F3EFE7');
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8);
    doc.text('FACTURA', L + 10, y + 7);
    doc.text('FECHA', L + 260, y + 7, { width: 70, align: 'right' });
    doc.text('TOTAL', L + 340, y + 7, { width: 75, align: 'right' });
    doc.text('SE PAGA', L + 425, y + 7, { width: R - L - 435, align: 'right' });
    y += 22;

    for (const f of d.facturas) {
      if (y > 690) { doc.addPage({ size: 'A4', margin: 0 }); y = 60; }
      const parcial = Number(f.imputado) < Number(f.total);
      doc.fillColor(TINTA).font('Helvetica').fontSize(9.5).text(f.numero, L + 10, y + 6, { width: 245, ellipsis: true });
      doc.text(f.fecha ? fecha(f.fecha) : '—', L + 260, y + 6, { width: 70, align: 'right' });
      doc.text(pesos(f.total), L + 340, y + 6, { width: 75, align: 'right' });
      doc.fillColor(parcial ? ROJO : TINTA).font('Helvetica-Bold')
        .text(pesos(f.imputado), L + 425, y + 6, { width: R - L - 435, align: 'right' });
      y += 22;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINEA).stroke();
    }

    y += 12;
    doc.rect(L + 300, y, R - L - 300, 34).fill(NEGRO);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('TOTAL A PAGAR', L + 312, y + 12);
    doc.fontSize(14).text(pesos(d.total), L + 300, y + 9, { width: R - L - 312, align: 'right' });
    y += 46;

    if (d.observaciones) {
      doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES', L, y, { characterSpacing: 1.2 });
      doc.fillColor(TINTA).font('Helvetica').fontSize(9).text(d.observaciones, L, y + 12, { width: R - L });
      y += 40;
    }

    y += 10;
    doc.fillColor(HUMO).font('Helvetica').fontSize(8.5)
      .text(`Solicitada por: ${d.pedidaPor ?? '—'}`, L, y, { width: 240 });
    // rechazada: en rojo y con quién, cuándo y por qué
    if (textos.rechazada) doc.fillColor(ROJO).font('Helvetica-Bold');
    doc.text(textos.firma, L + 250, y, { width: R - L - 250, align: 'right' });

    pie(doc, 760, textos.nota);
    doc.end();
  });
}
