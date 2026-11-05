// Un PDF con varios comprobantes (5/11/2026): la factura de Glorilact con su
// nota de crédito, y dos facturas de Grupo Modo, escaneadas juntas. Se leía
// solo el primero.
import sharp from 'sharp';
import { jpegsDelPdf } from './qr-arca.lector';
import { comprobantesValidos, etiquetaDeLaParte, hojasDelPdf, pdfDeHojas } from './separar-comprobantes';

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
