import { controlarConQr, decodificarQrArca, mismoNumero, numeroDelQr } from './qr-arca';
import { aUnaLetra, codigoCercano } from './codigo-proveedor';

// QR reales de facturas cargadas en octubre y noviembre de 2026
const SERENISIMA_1046 =
  'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMS0wMyIsImN1aXQiOjMwNzA3MjEwMzg1LCJwdG9WdGEiOjYzNzYsInRpcG9DbXAiOjEsIm5yb0NtcCI6MTA0NiwiaW1wb3J0ZSI6MzA2NDE2NS4zMywibW9uZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjozMDcxNjk2OTcxOCwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjg2NDQwNzQ3MzUwNjcwfQ==';
const RUEDA_136173 =
  'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMC0yMCIsImN1aXQiOjMwNzExNTk4NjMwLCJwdG9WdGEiOjcsInRpcG9DbXAiOjEsIm5yb0NtcCI6MTM2MTczLCJpbXBvcnRlIjo5MDM3MTQuMDUsIm1vbmVkYSI6IlBFUyIsImN0eiI6MS4wLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjozMDcxNjk2OTcxOCwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjg2NDI4NjE1NTc5NzM2fQ==';
// sin el relleno final «=»: así lo imprimen algunos sistemas
const SERENISIMA_722 =
  'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMC0wNiIsImN1aXQiOjMwNzA3MjEwMzg1LCJwdG9WdGEiOjYzNzYsInRpcG9DbXAiOjEsIm5yb0NtcCI6NzIyLCJpbXBvcnRlIjoxMTMzNzU3LjkyLCJtb25lZGEiOiJQRVMiLCJjdHoiOjEsInRpcG9Eb2NSZWMiOjgwLCJucm9Eb2NSZWMiOjMwNzE2OTY5NzE4LCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6ODY0MDYzMzQ2NDQzNjV9';

const qrDe = (o: Record<string, unknown>) => 'https://www.arca.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(o)).toString('base64');
const ODB = '30716969718';

describe('QR de ARCA: decodificar', () => {
  it('la factura de La Serenísima de Anabella', () => {
    const qr = decodificarQrArca(SERENISIMA_1046)!;
    expect(qr).toMatchObject({ cuit: '30707210385', puntoDeVenta: 6376, numero: 1046, tipoCmp: 1, fecha: '2026-11-03', importe: 3064165.33, moneda: 'PES', cuitReceptor: ODB, cae: '86440747350670' });
    expect(numeroDelQr(qr)).toBe('06376-00001046');
  });

  it('sin relleno de base64 y con el dominio nuevo de ARCA', () => {
    expect(decodificarQrArca(SERENISIMA_722)?.numero).toBe(722);
    expect(decodificarQrArca(qrDe({ cuit: 30711598630, ptoVta: 7, tipoCmp: 3, nroCmp: 5, importe: 100, moneda: 'PES', ctz: 1 }))?.tipoCmp).toBe(3);
  });

  it('otros QR del papel no son de ARCA (Rueda Que Rueda trae el de la tienda de Mondelez)', () => {
    expect(decodificarQrArca('https://www.mitiendamondelez.com.ar/app')).toBeNull();
    expect(decodificarQrArca('https://www.afip.gob.ar/fe/qr/?p=basura')).toBeNull();
  });
});

describe('QR de ARCA: cruzar con la lectura', () => {
  const lectura = (o: any = {}) => ({
    proveedor: { nombre: 'Rueda Que Rueda SRL', cuit: '30711598630' },
    comprobante: { tipo: 'factura_a', numero: '0007-00136173', fecha: '2026-10-20' },
    impuestos: { neto: 700553.52, iva: 147116.24, percepcionIva: 21016.61, percepcionIibb: 35027.68, total: 903714.05 },
    dudas: [],
    ...o,
  });

  it('si todo coincide no cambia nada ni agrega dudas (el número con 4 o 5 cifras es el mismo)', () => {
    const datos = lectura();
    const c = controlarConQr(datos, decodificarQrArca(RUEDA_136173)!, [ODB]);
    expect(c.dudas).toEqual([]);
    expect(c.qrArca.correcciones).toEqual([]);
    expect(c.qrArca.totalCoincide).toBe(true);
    expect(datos.comprobante.numero).toBe('0007-00136173');
  });

  it('corrige CUIT, número y fecha mal leídos con lo de ARCA', () => {
    const datos = lectura({ proveedor: { cuit: '30711598680' }, comprobante: { tipo: 'factura_a', numero: '0007-00135173', fecha: '2026-10-26' } });
    const c = controlarConQr(datos, decodificarQrArca(RUEDA_136173)!, [ODB]);
    expect(datos.proveedor.cuit).toBe('30711598630');
    expect(datos.comprobante.numero).toBe('00007-00136173');
    expect(datos.comprobante.fecha).toBe('2026-10-20');
    expect(c.qrArca.correcciones).toHaveLength(3);
  });

  it('un total mal leído queda el de ARCA y se avisa que revisen el pie', () => {
    const datos = lectura({ impuestos: { total: 908714.05 } });
    const c = controlarConQr(datos, decodificarQrArca(RUEDA_136173)!, [ODB]);
    expect(datos.impuestos.total).toBe(903714.05);
    expect(c.qrArca.totalCoincide).toBe(false);
    expect(c.dudas[0].pregunta).toMatch(/no es el que la factura le informó a ARCA/);
  });

  it('una nota de crédito se avisa aunque la lectura diga factura', () => {
    const qr = decodificarQrArca(qrDe({ fecha: '2026-11-01', cuit: 30711598630, ptoVta: 7, tipoCmp: 3, nroCmp: 900, importe: 5000, moneda: 'PES', ctz: 1, nroDocRec: 30716969718 }))!;
    const datos = lectura({ impuestos: { total: 5000 } });
    const c = controlarConQr(datos, qr, [ODB]);
    expect(c.qrArca.notaDeCredito).toBe(true);
    expect(datos.comprobante.tipo).toBe('nota_credito_a');
    expect(c.dudas.map((d) => d.pregunta).join()).toMatch(/NOTA DE CRÉDITO A/);
  });

  it('una factura hecha a otro CUIT se avisa', () => {
    const qr = decodificarQrArca(qrDe({ fecha: '2026-11-01', cuit: 30711598630, ptoVta: 7, tipoCmp: 1, nroCmp: 1, importe: 100, moneda: 'PES', ctz: 1, nroDocRec: 20111111112 }))!;
    const c = controlarConQr(lectura({ impuestos: { total: 100 } }), qr, [ODB, '30999999993']);
    expect(c.dudas[0].pregunta).toMatch(/otro CUIT \(20111111112\)/);
  });

  it('en dólares se compara en pesos con la cotización', () => {
    const qr = decodificarQrArca(qrDe({ fecha: '2026-11-01', cuit: 30711598630, ptoVta: 7, tipoCmp: 1, nroCmp: 2, importe: 1000, moneda: 'DOL', ctz: 1450.5, nroDocRec: 30716969718 }))!;
    const c = controlarConQr(lectura({ impuestos: { total: 1450500 } }), qr, [ODB]);
    expect(c.qrArca.totalCoincide).toBe(true);
    expect(c.qrArca.total).toBe(1450500);
  });

  it('mismoNumero no confunde comprobantes distintos', () => {
    const qr = decodificarQrArca(SERENISIMA_1046)!;
    expect(mismoNumero('6376-1046', qr)).toBe(true);
    expect(mismoNumero('06376-00001064', qr)).toBe(false);
    expect(mismoNumero(null, qr)).toBe(false);
  });
});

describe('códigos del proveedor a un dígito', () => {
  it('el caso de Distri Sur: 3094UU leído, 9094UU conocido', () => {
    expect(codigoCercano('3094UU', ['9094uu', '1140', '7700'])).toBe('9094uu');
  });
  it('una cifra de más o de menos', () => {
    expect(aUnaLetra('110115', '11015')).toBe(true);
    expect(aUnaLetra('110115', '1101155')).toBe(true);
    expect(aUnaLetra('110115', '110151')).toBe(false); // dos cambios
  });
  it('con dos candidatos no se elige ninguno (1067 y 1068 son Oreo y Pepitos)', () => {
    expect(codigoCercano('1069', ['1067', '1068'])).toBeNull();
  });
  it('códigos cortos no se corrigen', () => {
    expect(codigoCercano('321', ['322'])).toBeNull();
  });
});
