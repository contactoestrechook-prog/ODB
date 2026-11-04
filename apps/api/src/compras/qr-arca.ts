// QR DE ARCA (Leandro, 3/11/2026: «que entiendan la factura a la perfección»).
//
// Toda factura electrónica impresa trae el QR de la RG 4892/2020. Adentro está
// lo que el emisor le informó a ARCA: CUIT, punto de venta, número, tipo, fecha,
// total y CAE. Es la única parte del papel que no depende de leer bien una foto:
// si el QR se lee, esos datos son exactos.
//
// Medido el 3/11 con las 30 últimas lecturas reales: el QR salió en 28 (las dos
// que faltan son una factura «X», que no lo tiene), en una décima de segundo, y
// en todas el total coincidía con el leído. Por eso el QR manda sobre la lectura
// en la cabecera y sirve de control del pie.
//
// Este archivo no toca imágenes: decodifica el texto del QR y lo cruza con la
// lectura. La búsqueda del QR en la foto está en qr-arca.lector.ts.

export type QrArca = {
  cuit: string;
  puntoDeVenta: number;
  numero: number;
  tipoCmp: number;
  fecha: string | null; // AAAA-MM-DD
  importe: number;
  moneda: string;
  cotizacion: number;
  cuitReceptor: string | null;
  cae: string | null;
};

// Códigos de comprobante de ARCA que pueden llegar en una compra
const TIPOS: Record<number, { nombre: string; letra: string; clase: 'factura' | 'nota_debito' | 'nota_credito' }> = {
  1: { nombre: 'Factura A', letra: 'A', clase: 'factura' },
  2: { nombre: 'Nota de débito A', letra: 'A', clase: 'nota_debito' },
  3: { nombre: 'Nota de crédito A', letra: 'A', clase: 'nota_credito' },
  6: { nombre: 'Factura B', letra: 'B', clase: 'factura' },
  7: { nombre: 'Nota de débito B', letra: 'B', clase: 'nota_debito' },
  8: { nombre: 'Nota de crédito B', letra: 'B', clase: 'nota_credito' },
  11: { nombre: 'Factura C', letra: 'C', clase: 'factura' },
  12: { nombre: 'Nota de débito C', letra: 'C', clase: 'nota_debito' },
  13: { nombre: 'Nota de crédito C', letra: 'C', clase: 'nota_credito' },
  51: { nombre: 'Factura M', letra: 'M', clase: 'factura' },
  52: { nombre: 'Nota de débito M', letra: 'M', clase: 'nota_debito' },
  53: { nombre: 'Nota de crédito M', letra: 'M', clase: 'nota_credito' },
  201: { nombre: 'Factura de crédito electrónica A', letra: 'A', clase: 'factura' },
  202: { nombre: 'Nota de débito electrónica A', letra: 'A', clase: 'nota_debito' },
  203: { nombre: 'Nota de crédito electrónica A', letra: 'A', clase: 'nota_credito' },
  206: { nombre: 'Factura de crédito electrónica B', letra: 'B', clase: 'factura' },
  207: { nombre: 'Nota de débito electrónica B', letra: 'B', clase: 'nota_debito' },
  208: { nombre: 'Nota de crédito electrónica B', letra: 'B', clase: 'nota_credito' },
  211: { nombre: 'Factura de crédito electrónica C', letra: 'C', clase: 'factura' },
  212: { nombre: 'Nota de débito electrónica C', letra: 'C', clase: 'nota_debito' },
  213: { nombre: 'Nota de crédito electrónica C', letra: 'C', clase: 'nota_credito' },
};

export const esQrDeArca = (texto: string) => /(afip|arca)\.gob\.ar\/fe\/qr\/?\?p=/i.test(texto ?? '');

// El QR es una URL con un JSON en base64: https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEs…
// Cualquier otro QR del papel (el de la tienda del proveedor, el de Mercado
// Pago) devuelve null.
export function decodificarQrArca(texto: string): QrArca | null {
  if (!esQrDeArca(texto)) return null;
  try {
    const p = new URL(texto.trim()).searchParams.get('p');
    if (!p) return null;
    // a veces viene en base64url o sin el relleno final
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const cuit = String(j.cuit ?? '').replace(/\D/g, '');
    const importe = Number(j.importe);
    if (cuit.length !== 11 || !Number.isFinite(importe)) return null;
    return {
      cuit,
      puntoDeVenta: Number(j.ptoVta) || 0,
      numero: Number(j.nroCmp) || 0,
      tipoCmp: Number(j.tipoCmp) || 0,
      fecha: /^\d{4}-\d{2}-\d{2}/.test(String(j.fecha ?? '')) ? String(j.fecha).slice(0, 10) : null,
      importe,
      moneda: String(j.moneda ?? 'PES').toUpperCase(),
      cotizacion: Number(j.ctz) > 0 ? Number(j.ctz) : 1,
      cuitReceptor: j.nroDocRec != null && String(j.nroDocRec).replace(/\D/g, '').length === 11 ? String(j.nroDocRec).replace(/\D/g, '') : null,
      cae: j.codAut != null ? String(j.codAut) : null,
    };
  } catch {
    return null;
  }
}

export const tipoDelQr = (qr: QrArca) => TIPOS[qr.tipoCmp] ?? null;

// «00007-00136173»: el formato de ARCA (5 + 8)
export const numeroDelQr = (qr: QrArca) => `${String(qr.puntoDeVenta).padStart(5, '0')}-${String(qr.numero).padStart(8, '0')}`;

// El mismo comprobante aunque el papel imprima «0007-00136173» y ARCA diga 00007
export function mismoNumero(leido: string | null | undefined, qr: QrArca): boolean {
  const partes = String(leido ?? '').match(/(\d+)\D+(\d+)/);
  return !!partes && Number(partes[1]) === qr.puntoDeVenta && Number(partes[2]) === qr.numero;
}

// Lo que dice ARCA, en pesos
export const totalEnPesos = (qr: QrArca) => (qr.moneda === 'PES' ? qr.importe : Math.round(qr.importe * qr.cotizacion * 100) / 100);

const pesos = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ControlQr = {
  qrArca: {
    cuit: string;
    numero: string;
    tipo: string | null;
    notaDeCredito: boolean;
    fecha: string | null;
    total: number;
    moneda: string;
    cae: string | null;
    totalCoincide: boolean;
    // lo que el QR corrigió de la lectura, para mostrarlo
    correcciones: string[];
  };
  dudas: { pregunta: string; referencia: string }[];
};

// Cruza la lectura con el QR. La cabecera (CUIT, número, fecha) se toma del QR
// cuando no coincide: es lo que se le informó a ARCA. El TOTAL también, pero
// avisando: si la lectura sacó otro total, algún número del pie está mal leído
// y la validación del pie lo va a marcar. Muta `datos`.
export function controlarConQr(datos: any, qr: QrArca, cuitsPropios: string[] = []): ControlQr {
  const correcciones: string[] = [];
  const dudas: ControlQr['dudas'] = [];
  datos.proveedor = datos.proveedor ?? {};
  datos.comprobante = datos.comprobante ?? {};
  datos.impuestos = datos.impuestos ?? {};

  const cuitLeido = String(datos.proveedor.cuit ?? '').replace(/\D/g, '');
  if (cuitLeido !== qr.cuit) {
    if (cuitLeido) correcciones.push(`CUIT ${cuitLeido} → ${qr.cuit}`);
    datos.proveedor.cuit = qr.cuit;
  }

  if (!mismoNumero(datos.comprobante.numero, qr)) {
    const n = numeroDelQr(qr);
    if (datos.comprobante.numero) correcciones.push(`número ${datos.comprobante.numero} → ${n}`);
    datos.comprobante.numero = n;
  }

  if (qr.fecha && datos.comprobante.fecha !== qr.fecha) {
    if (datos.comprobante.fecha) correcciones.push(`fecha ${datos.comprobante.fecha} → ${qr.fecha}`);
    datos.comprobante.fecha = qr.fecha;
  }

  const tipo = tipoDelQr(qr);
  // la nota de crédito también se corrige a su tipo (4/11/2026): así se registra
  // como NC y libera sola la factura que la esperaba
  const tipoLectura = tipo && (tipo.clase === 'factura' || tipo.clase === 'nota_credito') && /^[ABC]$/.test(tipo.letra) ? `${tipo.clase}_${tipo.letra.toLowerCase()}` : null;
  if (tipoLectura && datos.comprobante.tipo !== tipoLectura) {
    if (datos.comprobante.tipo) correcciones.push(`tipo ${datos.comprobante.tipo} → ${tipoLectura}`);
    datos.comprobante.tipo = tipoLectura;
  }
  if (tipo?.clase === 'nota_credito') {
    dudas.push({ pregunta: `Según ARCA esto es una ${tipo.nombre.toUpperCase()}, no una factura: se registra como nota de crédito, sin mover stock. Confirmá a qué factura corresponde.`, referencia: 'QR de ARCA' });
  }

  const total = totalEnPesos(qr);
  const leido = Number(datos.impuestos.total);
  const totalCoincide = Number.isFinite(leido) && Math.abs(leido - total) <= Math.max(1, total * (qr.moneda === 'PES' ? 0 : 0.01));
  if (!totalCoincide) {
    if (Number.isFinite(leido) && leido > 0) {
      dudas.push({
        pregunta: `El total leído (${pesos(leido)}) no es el que la factura le informó a ARCA (${pesos(total)}). Quedó el de ARCA: revisá los números del pie, alguno está mal leído.`,
        referencia: 'QR de ARCA',
      });
      correcciones.push(`total ${pesos(leido)} → ${pesos(total)}`);
    }
    datos.impuestos.total = total;
  }
  if (qr.moneda !== 'PES') {
    dudas.push({ pregunta: `La factura está en ${qr.moneda} (cotización ${qr.cotizacion}): el total en pesos es ${pesos(total)}.`, referencia: 'QR de ARCA' });
  }

  const propios = cuitsPropios.map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 11);
  if (qr.cuitReceptor && propios.length && !propios.includes(qr.cuitReceptor)) {
    dudas.push({ pregunta: `La factura está hecha a otro CUIT (${qr.cuitReceptor}), no a ODB. Confirmá que es nuestra antes de registrarla.`, referencia: 'QR de ARCA' });
  }

  return {
    qrArca: {
      cuit: qr.cuit,
      numero: numeroDelQr(qr),
      tipo: tipo?.nombre ?? null,
      notaDeCredito: tipo?.clase === 'nota_credito',
      fecha: qr.fecha,
      total,
      moneda: qr.moneda,
      cae: qr.cae,
      totalCoincide,
      correcciones,
    },
    dudas,
  };
}
