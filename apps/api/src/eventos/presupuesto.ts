import PDFDocument from 'pdfkit';

const WINE = '#5A1A16';
const ROJO = '#B82D25';
const ORO = '#C9A96E';
const TINTA = '#2A201C';
const HUMO = '#9B9088';
const LINEA = '#E5DCCB';

const pesos = (n: any) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const TIPO_LABEL: Record<string, string> = {
  cumpleanos: 'Cumpleaños', casamiento: 'Casamiento', corporativo: 'Evento corporativo',
  fin_de_ano: 'Fiesta de fin de año', otro: 'Evento',
};

export type DatosPresupuesto = {
  folio: string;
  fecha: string;
  cliente?: { nombre?: string; dni?: string } | null;
  evento: { nombre: string; tipo: string; fecha?: string | null; invitados?: number | null };
  items: { descripcion: string; cantidad: number; precio_unitario: number }[];
};

export function generarPresupuesto(d: DatosPresupuesto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const L = 50;
    const R = W - 50;

    // ---- Encabezado de marca ----
    doc.rect(0, 0, W, 96).fill(WINE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(30).text('O.D.B', L, 30, { characterSpacing: 3 });
    doc.fillColor(ORO).font('Helvetica-Bold').fontSize(9).text('PREMIUM MARKET', L + 2, 66, { characterSpacing: 5 });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('PRESUPUESTO', L, 32, { width: R - L, align: 'right' });
    doc.fillColor('rgba(255,255,255,0.85)').font('Helvetica').fontSize(9)
      .fillColor('#EAD9BE').text(`N° ${d.folio}`, L, 58, { width: R - L, align: 'right' })
      .text(d.fecha, L, 72, { width: R - L, align: 'right' });

    let y = 128;

    // ---- Datos del cliente / evento ----
    const col2 = 320;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('PARA', L, y, { characterSpacing: 1 });
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('EVENTO', col2, y, { characterSpacing: 1 });
    y += 14;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(12).text(d.cliente?.nombre || 'Cliente', L, y, { width: col2 - L - 20 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(12).text(d.evento.nombre, col2, y, { width: R - col2 });
    y += 17;
    doc.fillColor(HUMO).font('Helvetica').fontSize(9);
    if (d.cliente?.dni) doc.text(`DNI ${d.cliente.dni}`, L, y, { width: col2 - L - 20 });
    const evLinea = [TIPO_LABEL[d.evento.tipo] ?? 'Evento',
      d.evento.invitados ? `${d.evento.invitados} invitados` : null,
      d.evento.fecha ? new Date(d.evento.fecha).toLocaleDateString('es-AR') : null]
      .filter(Boolean).join(' · ');
    doc.text(evLinea, col2, y, { width: R - col2 });

    y += 34;

    // ---- Tabla de la propuesta ----
    const cDesc = L + 12;
    const xCant = 370;
    const xUnit = 460;
    const xSub = R - 12;

    doc.rect(L, y, R - L, 26).fill(WINE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
    doc.text('DETALLE', cDesc, y + 8.5);
    doc.text('CANT.', xCant - 60, y + 8.5, { width: 60, align: 'right' });
    doc.text('P. UNIT.', xUnit - 70, y + 8.5, { width: 70, align: 'right' });
    doc.text('SUBTOTAL', xSub - 90, y + 8.5, { width: 90, align: 'right' });
    y += 26;

    let total = 0;
    doc.font('Helvetica').fontSize(10);
    for (const it of d.items) {
      const sub = Number(it.cantidad) * Number(it.precio_unitario);
      total += sub;
      const alto = 24;
      doc.fillColor(TINTA).font('Helvetica').fontSize(10).text(it.descripcion, cDesc, y + 7.5, { width: xCant - 70 - cDesc, ellipsis: true });
      doc.fillColor(TINTA).text(String(it.cantidad), xCant - 60, y + 7.5, { width: 60, align: 'right' });
      doc.fillColor(HUMO).text(pesos(it.precio_unitario), xUnit - 70, y + 7.5, { width: 70, align: 'right' });
      doc.fillColor(TINTA).font('Helvetica-Bold').text(pesos(sub), xSub - 90, y + 7.5, { width: 90, align: 'right' });
      y += alto;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINEA).stroke();
      if (y > 720) { doc.addPage({ margin: 0 }); y = 60; }
    }

    // ---- Total ----
    y += 14;
    doc.rect(R - 230, y, 230, 34).fill(WINE);
    doc.fillColor(ORO).font('Helvetica-Bold').fontSize(10).text('TOTAL', R - 218, y + 11);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text(pesos(total), R - 230, y + 9, { width: 218, align: 'right' });

    y += 60;
    doc.fillColor(HUMO).font('Helvetica').fontSize(8.5)
      .text('Presupuesto válido por 15 días. Sujeto a disponibilidad de stock al momento de la confirmación.', L, y, { width: R - L });

    // ---- Pie ----
    const py = 800;
    doc.moveTo(L, py).lineTo(R, py).lineWidth(1).strokeColor(ORO).stroke();
    doc.fillColor(WINE).font('Helvetica-Bold').fontSize(9).text('O.D.B Premium Market', L, py + 8, { width: R - L, align: 'center', characterSpacing: 1 });
    doc.fillColor(HUMO).font('Helvetica').fontSize(8).text('Outlet de bebidas · Gracias por elegirnos', L, py + 21, { width: R - L, align: 'center' });

    doc.end();
  });
}
