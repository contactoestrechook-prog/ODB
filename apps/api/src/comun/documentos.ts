import PDFDocument from 'pdfkit';

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

const NEGRO = '#141414';
const ROJO = '#B82D25';
const ORO = '#C9A96E';
const TINTA = '#2A201C';
const HUMO = '#9B9088';
const LINEA = '#E5DCCB';
const W = 595.28;
const L = 50;
const R = W - 50;

const pesos = (n: any) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
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
  items: { nombre: string; sku?: string | null; cantidad: number; costo_unitario: number }[];
  total: number;
  emitidaPor?: string | null;
  aprobadaPor?: string | null;
};

export function ordenDeCompraPDF(d: DatosOrdenCompra): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const trozos: Buffer[] = [];
    doc.on('data', (c) => trozos.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    encabezado(doc, 'ORDEN DE COMPRA', d.folio, d.emitidoEn);

    // A quién se le compra
    let y = 126;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('PROVEEDOR', L, y, { characterSpacing: 1.5 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(13).text(d.proveedor?.razon_social ?? '—', L, y + 13);
    const datosProv = [d.proveedor?.cuit ? `CUIT ${d.proveedor.cuit}` : null, d.proveedor?.telefono, d.proveedor?.email]
      .filter(Boolean).join(' · ');
    if (datosProv) doc.fillColor(HUMO).font('Helvetica').fontSize(9).text(datosProv, L, y + 31);

    // Condiciones, a la derecha
    const dchaX = 340;
    const cond: [string, string][] = [
      ['Orden interna', `#${d.numeroInterno}`],
      ['Fecha', fecha(d.fecha)],
      ['Entrega en', d.sucursal ?? '—'],
      ['Fecha de entrega', d.fechaEntrega ? fecha(d.fechaEntrega) : 'a convenir'],
      ['Condición de pago', d.condicionPago ?? 'a convenir'],
    ];
    let yc = y;
    for (const [k, v] of cond) {
      doc.fillColor(HUMO).font('Helvetica').fontSize(8).text(k, dchaX, yc, { width: 110 });
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(v, dchaX + 110, yc - 1, { width: R - dchaX - 110, align: 'right' });
      yc += 15;
    }

    // Renglones
    y = Math.max(y + 58, yc + 10);
    doc.rect(L, y, R - L, 22).fill('#F3EFE7');
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8);
    doc.text('PRODUCTO', L + 10, y + 7);
    doc.text('CANT.', L + 300, y + 7, { width: 50, align: 'right' });
    doc.text('COSTO UNIT.', L + 355, y + 7, { width: 70, align: 'right' });
    doc.text('SUBTOTAL', L + 430, y + 7, { width: R - L - 440, align: 'right' });
    y += 22;

    for (const it of d.items) {
      if (y > 690) { doc.addPage({ size: 'A4', margin: 0 }); y = 60; }
      const sub = Number(it.cantidad) * Number(it.costo_unitario);
      doc.fillColor(TINTA).font('Helvetica').fontSize(9.5)
        .text(`${it.nombre}${it.sku ? `  (${it.sku})` : ''}`, L + 10, y + 6, { width: 285, ellipsis: true });
      doc.font('Helvetica').text(String(it.cantidad), L + 300, y + 6, { width: 50, align: 'right' });
      doc.text(pesos(it.costo_unitario), L + 355, y + 6, { width: 70, align: 'right' });
      doc.font('Helvetica-Bold').text(pesos(sub), L + 430, y + 6, { width: R - L - 440, align: 'right' });
      y += 22;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINEA).stroke();
    }

    // Total
    y += 12;
    doc.rect(L + 300, y, R - L - 300, 34).fill(NEGRO);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('TOTAL', L + 312, y + 12);
    doc.fontSize(14).text(pesos(d.total), L + 300, y + 9, { width: R - L - 312, align: 'right' });
    y += 46;

    if (d.observaciones) {
      doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES', L, y, { characterSpacing: 1.2 });
      doc.fillColor(TINTA).font('Helvetica').fontSize(9).text(d.observaciones, L, y + 12, { width: R - L });
      y += 40;
    }

    // Responsables: es lo que convierte el papel en trazabilidad
    y += 10;
    doc.fillColor(HUMO).font('Helvetica').fontSize(8.5)
      .text(`Emitida por: ${d.emitidaPor ?? '—'}`, L, y, { width: 240 });
    doc.text(`Aprobada por: ${d.aprobadaPor ?? 'pendiente de aprobación'}`, L + 250, y, { width: R - L - 250, align: 'right' });

    pie(doc, 760, 'Este documento acredita el pedido de la mercadería detallada. La recepción se confirma contra remito.');
    doc.end();
  });
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
    const doc2 = [d.cliente?.cuit ? `CUIT ${d.cliente.cuit}` : null, d.cliente?.dni ? `DNI ${d.cliente.dni}` : null]
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
export function remitoRecepcionPDF(d: DatosRemito): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const trozos: Buffer[] = [];
    doc.on('data', (c) => trozos.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    encabezado(doc, 'ACTA DE RECEPCIÓN', d.folio, d.emitidoEn);

    let y = 126;
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('RECIBIDO DE', L, y, { characterSpacing: 1.5 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(13).text(d.proveedor?.razon_social ?? '—', L, y + 13);
    if (d.proveedor?.cuit) doc.fillColor(HUMO).font('Helvetica').fontSize(9).text(`CUIT ${d.proveedor.cuit}`, L, y + 31);

    const dchaX = 340;
    const cond: [string, string][] = [
      ['Remito del proveedor', d.numeroRemito || 's/n'],
      ['Fecha de recepción', fecha(d.fecha)],
      ['Depósito', d.sucursal ?? '—'],
      ['Orden de compra', d.ordenCompra ? `#${d.ordenCompra}` : 'sin orden previa'],
    ];
    let yc = y;
    for (const [k, v] of cond) {
      doc.fillColor(HUMO).font('Helvetica').fontSize(8).text(k, dchaX, yc, { width: 120 });
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(v, dchaX + 110, yc - 1, { width: R - dchaX - 110, align: 'right' });
      yc += 15;
    }

    y = Math.max(y + 58, yc + 10);
    doc.rect(L, y, R - L, 22).fill('#F3EFE7');
    doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8);
    doc.text('PRODUCTO', L + 10, y + 7);
    doc.text('PEDIDO', L + 300, y + 7, { width: 60, align: 'right' });
    doc.text('RECIBIDO', L + 370, y + 7, { width: 60, align: 'right' });
    doc.text('DIF.', L + 440, y + 7, { width: R - L - 450, align: 'right' });
    y += 22;

    let diferencias = 0;
    for (const it of d.items) {
      if (y > 690) { doc.addPage({ size: 'A4', margin: 0 }); y = 60; }
      const pedido = it.pedido == null ? null : Number(it.pedido);
      const dif = pedido == null ? 0 : Number(it.recibido) - pedido;
      if (dif !== 0) diferencias++;
      doc.fillColor(TINTA).font('Helvetica').fontSize(9.5)
        .text(`${it.nombre}${it.sku ? `  (${it.sku})` : ''}`, L + 10, y + 6, { width: 285, ellipsis: true });
      doc.text(pedido == null ? '—' : String(pedido), L + 300, y + 6, { width: 60, align: 'right' });
      doc.font('Helvetica-Bold').text(String(it.recibido), L + 370, y + 6, { width: 60, align: 'right' });
      doc.fillColor(dif === 0 ? HUMO : ROJO).font(dif === 0 ? 'Helvetica' : 'Helvetica-Bold')
        .text(dif === 0 ? '—' : (dif > 0 ? `+${dif}` : String(dif)), L + 440, y + 6, { width: R - L - 450, align: 'right' });
      y += 22;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINEA).stroke();
    }

    y += 16;
    doc.fillColor(diferencias ? ROJO : HUMO).font('Helvetica-Bold').fontSize(9)
      .text(diferencias
        ? `${diferencias} renglón/es con diferencia contra lo pedido. Reclamar al proveedor antes de conciliar la factura.`
        : 'Recepción completa: lo recibido coincide con lo pedido.', L, y, { width: R - L });
    y += 30;

    if (d.observaciones) {
      doc.fillColor(HUMO).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES', L, y, { characterSpacing: 1.2 });
      doc.fillColor(TINTA).font('Helvetica').fontSize(9).text(d.observaciones, L, y + 12, { width: R - L });
      y += 40;
    }

    doc.fillColor(HUMO).font('Helvetica').fontSize(8.5)
      .text(`Recibido y contado por: ${d.recibidoPor ?? '—'}`, L, y, { width: 300 });
    doc.text('Firma del transportista: ______________________', L + 260, y, { width: R - L - 260, align: 'right' });

    pie(doc, 760, 'Las cantidades de este acta son las que ingresaron al stock. La factura se concilia contra este documento.');
    doc.end();
  });
}
