// Un PDF con varios comprobantes (5/11/2026): la factura de Glorilact con su
// nota de crédito, y dos facturas de Grupo Modo, escaneadas juntas. Se leía
// solo el primero.
import sharp from 'sharp';
import { jpegsDelPdf } from './qr-arca.lector';
import { comprobantesValidos, etiquetaDeLaParte, hojasDelPdf, mismoNumero, nombreSinParte, otrosComprobantes, pdfDeHojas, rotuloDelComprobante } from './separar-comprobantes';

describe('qué comprobantes trae el PDF', () => {
  it('factura + nota de crédito: dos comprobantes, una hoja cada uno', () => {
    expect(comprobantesValidos({ comprobantes: [
      { hojas: [2], tipo: 'nota_credito', numero: '0001-00003945' },
      { hojas: [1], tipo: 'factura', numero: '0001-00149951' },
    ] }, 2)).toEqual([
      { hojas: [1], tipo: 'factura', numero: '0001-00149951' },
      { hojas: [2], tipo: 'nota_credito', numero: '0001-00003945' },
    ]);
  });
  it('una factura larga de dos hojas es un solo comprobante: no se parte', () => {
    expect(comprobantesValidos({ comprobantes: [{ hojas: [1, 2], tipo: 'factura', numero: '06376-00001075' }] }, 2)).toBeNull();
  });
  it('si falta una hoja, se repite o no existe, no se parte (se lee entero, como antes)', () => {
    const f = (hojas: number[]) => ({ hojas, tipo: 'factura', numero: 'x' });
    expect(comprobantesValidos({ comprobantes: [f([1]), f([2])] }, 3)).toBeNull();
    expect(comprobantesValidos({ comprobantes: [f([1, 2]), f([2, 3])] }, 3)).toBeNull();
    expect(comprobantesValidos({ comprobantes: [f([1]), f([4])] }, 2)).toBeNull();
    expect(comprobantesValidos({ comprobantes: [f([1]), f([])] }, 2)).toBeNull();
    expect(comprobantesValidos(null, 2)).toBeNull();
  });
  it('un tipo que no se conoce pasa como «otro» y cada parte lleva su rótulo', () => {
    const r = comprobantesValidos({ comprobantes: [{ hojas: [1], tipo: 'recibo', numero: '' }, { hojas: [2, 3], tipo: 'factura', numero: '0005-00843293' }] }, 3)!;
    expect(r[0].tipo).toBe('otro');
    expect(etiquetaDeLaParte('CamScanner 14.40.pdf', 2, 2, r[1])).toBe('CamScanner 14.40.pdf · 2 de 2 · Factura 0005-00843293');
    expect(etiquetaDeLaParte(undefined, 1, 2, r[0])).toBe('Comprobante.pdf · 1 de 2 · Comprobante');
  });
});

describe('el PDF de cada comprobante', () => {
  it('se arma con las fotos tal cual y se vuelve a leer igual que un escaneo', async () => {
    const foto = (color: string) => sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).jpeg().toBuffer();
    const [a, b] = await Promise.all([foto('#ffffff'), foto('#cccccc')]);
    const sello = await sharp({ create: { width: 240, height: 90, channels: 3, background: '#000000' } }).jpeg().toBuffer();
    const hoja = (jpeg: Buffer) => ({ jpeg, ancho: 600, alto: 800, canales: 3 });
    const pdf = pdfDeHojas([hoja(a), { jpeg: sello, ancho: 240, alto: 90, canales: 3 }, hoja(b)]);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.subarray(-6).toString('latin1')).toBe('%%EOF\n');
    const fotos = jpegsDelPdf(pdf);
    expect(fotos).toHaveLength(3);
    // (el extractor deja el salto de línea que cierra el stream: se compara la foto)
    expect(fotos[0].subarray(0, a.length).equals(a)).toBe(true);
    expect(fotos[2].subarray(0, b.length).equals(b)).toBe(true);
    // el sello de CamScanner (240×90) no es una hoja
    const hojas = await hojasDelPdf(pdf);
    expect(hojas.map((h) => `${h.ancho}x${h.alto}`)).toEqual(['600x800', '600x800']);
    // la tabla de posiciones apunta a cada objeto
    const xref = Number(/startxref\n(\d+)/.exec(pdf.toString('latin1'))![1]);
    expect(pdf.subarray(xref, xref + 4).toString('latin1')).toBe('xref');
  });
});

// Ana tenía abierta la factura y pedía la nota de crédito del mismo PDF (5/11/2026)
describe('los otros comprobantes del mismo PDF', () => {
  const glorilact = [
    { hojas: [1], tipo: 'factura' as const, numero: '0001-00149951' },
    { hojas: [2], tipo: 'nota_credito' as const, numero: '0001-00003945' },
  ];
  it('con la factura abierta, lo que falta leer es la nota de crédito', () => {
    expect(otrosComprobantes(glorilact, '0001-00149951').map(rotuloDelComprobante)).toEqual(['Nota de crédito 0001-00003945']);
    // el número se escribe de varias formas según quién lo lea
    expect(otrosComprobantes(glorilact, '00001-00149951')).toHaveLength(1);
    expect(otrosComprobantes(glorilact, 'FAA000100149951').map((c) => c.tipo)).toEqual(['nota_credito']);
  });
  it('si el número de la lectura no aparece, la que ya se leyó es la primera', () => {
    expect(otrosComprobantes(glorilact, '').map((c) => c.numero)).toEqual(['0001-00003945']);
    expect(otrosComprobantes(glorilact, '9999-12345678').map((c) => c.numero)).toEqual(['0001-00003945']);
  });
  it('dos facturas de Grupo Modo: abierta la 843292, falta la 843293', () => {
    const modo = [{ hojas: [1], tipo: 'factura' as const, numero: '0005-00843292' }, { hojas: [2], tipo: 'factura' as const, numero: '0005-00843293' }];
    expect(otrosComprobantes(modo, '0005-00843292').map((c) => c.numero)).toEqual(['0005-00843293']);
    expect(otrosComprobantes(modo, '0005-00843293').map((c) => c.numero)).toEqual(['0005-00843292']);
  });
  it('mismo número aunque cambie el formato; distinto si cambia el punto de venta o el número', () => {
    expect(mismoNumero('0001-00149951', '00001-00149951')).toBe(true);
    expect(mismoNumero('FAA000500843292', '0005-00843292')).toBe(true);
    expect(mismoNumero('0001-00149951', '0002-00149951')).toBe(false);
    expect(mismoNumero('0001-00149951', '0001-00149952')).toBe(false);
    expect(mismoNumero('', '0001-00149951')).toBe(false);
  });
  it('el nombre de una parte vuelve al del archivo', () => {
    expect(nombreSinParte('CamScanner 5-11-26 14.40.pdf · 2 de 2 · Nota de crédito 0001-00003945')).toBe('CamScanner 5-11-26 14.40.pdf');
    expect(nombreSinParte('CamScanner 5-11-26 14.40.pdf')).toBe('CamScanner 5-11-26 14.40.pdf');
    expect(nombreSinParte(null)).toBe('Comprobante.pdf');
  });
});
