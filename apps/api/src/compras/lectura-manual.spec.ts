import { nombreAMano, pieAMano, resultadoAMano, tipoAMano } from './lectura-manual';

// Una lectura real de la IA (forma recortada de Distri-Sur, 19/11/2026)
const leida = {
  comprobante: { tipo: 'factura_a', numero: '00007-00060714', fecha: '2026-11-18', condicionVenta: 'Cta Cte', facturaAsociada: '' },
  proveedor: { match: { id: 'p-1', cuit: '30711111110', metodo: 'cuit', razon_social: 'DISTRI-SUR' }, detectado: { cuit: '30711111110', nombre: 'Distri-Sur S.A.' } },
  impuestos: { neto: 100000, iva: 21000, percepcionIibb: 3000, total: 124000 },
  items: [{ descripcion: 'FERRERO T8', cantidad: 6 }, { descripcion: 'FERRERO T12', cantidad: 4 }],
  dudas: [{ pregunta: '¿Cuántos bultos?' }],
  archivoUrl: 'facturas/2026-11/abc.jpg',
  qrArca: { cuit: '30711111110' },
  notasManuscritas: 'faltó 1',
};

describe('la factura cargada a mano (19/11/2026)', () => {
  it('de cero: nace lista, sin renglones ni dudas, con el proveedor elegido', () => {
    const r = resultadoAMano({
      proveedor: { id: 'p-9', razon_social: 'Tres Blasones', cuit: null },
      comprobante: { tipo: 'factura_b', numero: ' 0016-00001249 ', fecha: '2026-11-18' },
    });
    expect(r.items).toEqual([]);
    expect(r.dudas).toEqual([]);
    expect(r.comprobante).toEqual({ tipo: 'factura_b', numero: '0016-00001249', fecha: '2026-11-18', condicionVenta: null, facturaAsociada: '' });
    expect(r.proveedor.match).toMatchObject({ id: 'p-9', razon_social: 'Tres Blasones', nombre: 'Tres Blasones', metodo: 'a_mano' });
    expect(r.impuestos).toEqual({});
    expect(r.archivoUrl).toBeNull();
    expect(r.aMano.desde).toBeNull();
    expect(r.aMano.renglonesDeLaIa).toBeNull();
  });

  it('de cero sin nada: factura A sin número', () => {
    const r = resultadoAMano({});
    expect(r.comprobante.tipo).toBe('factura_a');
    expect(r.comprobante.numero).toBeNull();
    expect(r.proveedor.match).toBeNull();
  });

  it('desde una factura leída: se queda con todo menos los renglones', () => {
    const r = resultadoAMano({ desde: { id: 'l-1', resultado: leida } });
    expect(r.items).toEqual([]);
    expect(r.dudas).toEqual([]);
    expect(r.comprobante).toEqual(leida.comprobante);
    expect(r.proveedor).toEqual(leida.proveedor);
    expect(r.impuestos).toEqual(leida.impuestos);
    expect(r.archivoUrl).toBe('facturas/2026-11/abc.jpg');
    expect(r.qrArca).toEqual(leida.qrArca);
    expect(r.notasManuscritas).toBe('faltó 1');
    expect(r.aMano).toMatchObject({ desde: 'l-1', renglonesDeLaIa: 2 });
  });

  it('desde una factura leída: lo que la persona ya corrigió en la pantalla manda', () => {
    const r = resultadoAMano({
      desde: { id: 'l-1', resultado: leida },
      proveedor: { id: 'p-2', razon_social: 'Otro' },
      impuestos: { neto: '99000', iva: 20790, percepcionIibb: '', total: 119790, inventado: 5 },
      comprobante: { numero: '00007-00060715' },
    });
    expect(r.proveedor.match).toMatchObject({ id: 'p-2', metodo: 'a_mano' });
    // el detectado del papel queda a la vista
    expect(r.proveedor.detectado).toEqual(leida.proveedor.detectado);
    expect(r.impuestos).toEqual({ neto: 99000, iva: 20790, percepcionIibb: null, total: 119790 });
    expect(r.comprobante.numero).toBe('00007-00060715');
    // lo que no se mandó sigue como se leyó
    expect(r.comprobante.tipo).toBe('factura_a');
    expect(r.comprobante.fecha).toBe('2026-11-18');
  });

  it('el original nuevo reemplaza al de la lectura', () => {
    expect(resultadoAMano({ desde: { id: 'l-1', resultado: leida }, archivoUrl: 'facturas/x.pdf' }).archivoUrl).toBe('facturas/x.pdf');
  });

  it('una lectura en error (sin resultado) igual sirve de punto de partida', () => {
    const r = resultadoAMano({ desde: { id: 'l-2', resultado: null } });
    expect(r.items).toEqual([]);
    expect(r.aMano.renglonesDeLaIa).toBe(0);
    expect(r.comprobante.tipo).toBe('factura_a');
  });

  it('tipo: solo los que conoce el sistema', () => {
    expect(tipoAMano('remito')).toBe('remito');
    expect(tipoAMano('FACTURA_C')).toBe('factura_c');
    expect(tipoAMano('nota_credito_a')).toBe('nota_credito_a');
    expect(tipoAMano('cualquiera')).toBe('factura_a');
    expect(tipoAMano(undefined, 'remito')).toBe('remito');
  });

  it('pie: números, redondeados, y nada que no sea del pie', () => {
    expect(pieAMano({ neto: '1234.567', total: 'abc', iva: null, x: 1 })).toEqual({ neto: 1234.57, iva: null });
    expect(pieAMano(null)).toEqual({});
    expect(pieAMano([1, 2])).toEqual({});
  });

  it('fecha: solo AAAA-MM-DD', () => {
    expect(resultadoAMano({ comprobante: { fecha: '18/11/2026' } }).comprobante.fecha).toBeNull();
  });

  it('nombre en la bandeja', () => {
    expect(nombreAMano('CamScanner 19-11.pdf')).toBe('A mano · CamScanner 19-11.pdf');
    expect(nombreAMano('A mano · foto.jpg')).toBe('A mano · foto.jpg');
    expect(nombreAMano(null)).toBe('Factura cargada a mano');
  });
});
