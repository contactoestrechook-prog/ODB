import { ordenDeCompraPDF, remitoRecepcionPDF, repartirRenglones, cantidad, importe, type DatosOrdenCompra } from './documentos';

// Cuántas hojas tiene un PDF de pdfkit (cada hoja es un objeto "/Type /Page").
const hojas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const esPDF = (pdf: Buffer) => pdf.subarray(0, 5).toString() === '%PDF-';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({
  nombre: i % 4 === 1 ? 'Whisky Johnnie Walker Blue Label en estuche de regalo con dos copas de cristal 750 cc' : `Fernet Branca 750 cc (${i + 1})`,
  sku: String(7790000000000 + i),
  codigoProveedor: i % 3 ? `PRV-${i}` : null,
  cantidad: i === 5 ? 2.5 : i * 7 + 1,
  costo_unitario: 1234567 + i,
}));

const orden = (n: number, sinPrecios = false): DatosOrdenCompra => ({
  folio: 'OC-2026-00042',
  emitidoEn: '2026-10-02T15:00:00Z',
  numeroInterno: 1234,
  fecha: '2026-10-01T12:00:00Z',
  proveedor: { razon_social: 'Distribuidora de Bebidas del Sur Sociedad Anónima', cuit: '30712345679', email: 'pedidos@sur.com.ar', telefono: '11 4444-5555' },
  sucursal: 'Saint Thomas · Castex 3601, Canning',
  condicionPago: '30 días',
  fechaEntrega: '2026-10-09T12:00:00Z',
  observaciones: 'Entregar por el portón lateral.',
  items: items(n),
  total: 999_999_999,
  emitidaPor: 'Leandro',
  aprobadaPor: null,
  sinPrecios,
});

describe('reparto de renglones entre hojas (Placa roja en papel)', () => {
  const o = { desde: 230, arriba: 46, tope: 801, sep: 4, cierre: 120, topeCierre: 760 };

  it('ninguna caja queda cortada y el total no queda solo en una hoja', () => {
    // alturas "al azar" pero fijas (semilla), de 0 a 80 renglones y cierres de distinto alto
    let semilla = 7;
    const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n <= 80; n++) {
      const altos = Array.from({ length: n }, () => 30 + Math.round(azar() * 20));
      const cierre = 40 + Math.round(azar() * 400);
      const p = repartirRenglones(altos, { ...o, cierre });
      p.renglones.forEach((r, i) => {
        expect(r.y).toBeGreaterThanOrEqual(r.pagina === 0 ? o.desde : o.arriba);
        expect(r.y + altos[i]).toBeLessThanOrEqual(o.tope);
        if (i > 0) {
          const antes = p.renglones[i - 1];
          expect(r.pagina).toBeGreaterThanOrEqual(antes.pagina);
          if (r.pagina === antes.pagina) expect(r.y).toBeGreaterThanOrEqual(antes.y + altos[i - 1] + o.sep);
        }
      });
      expect(p.cierre.y + cierre).toBeLessThanOrEqual(o.topeCierre);
      if (n) {
        const ultimo = p.renglones[n - 1];
        expect(p.cierre.pagina).toBe(ultimo.pagina);
        expect(p.cierre.y).toBeGreaterThanOrEqual(ultimo.y + altos[n - 1]);
      }
    }
  });

  it('sin renglones el cierre va en la primera hoja', () => {
    expect(repartirRenglones([], o)).toEqual({ renglones: [], cierre: { pagina: 0, y: o.desde } });
  });

  it('el renglón que no entra pasa entero a la hoja siguiente', () => {
    const p = repartirRenglones([40, 40], { ...o, desde: 740, cierre: 40 });
    expect(p.renglones[0]).toEqual({ pagina: 0, y: 740 });
    expect(p.renglones[1]).toEqual({ pagina: 1, y: o.arriba });
  });
});

describe('formatos de la Placa roja', () => {
  it('importes y cantidades como en la tarjeta', () => {
    expect(importe(41000)).toBe('$41.000');
    expect(importe(1234567.4)).toBe('$1.234.567');
    expect(cantidad(1200)).toBe('1.200');
    expect(cantidad(2.5)).toBe('2,5');
    expect(cantidad(0.30000000000000004)).toBe('0,3');
  });
});

describe('documentos con el diseño Placa roja', () => {
  it('orden de compra: una hoja con pocos renglones, varias con 30, en Inter', async () => {
    const corta = await ordenDeCompraPDF(orden(3));
    expect(esPDF(corta)).toBe(true);
    expect(hojas(corta)).toBe(1);
    expect(corta.toString('latin1')).toMatch(/Inter-ExtraBold/);
    const larga = await ordenDeCompraPDF(orden(30));
    expect(hojas(larga)).toBeGreaterThanOrEqual(2);
  });

  it('nota de pedido (sin precios)', async () => {
    const pdf = await ordenDeCompraPDF(orden(30, true));
    expect(esPDF(pdf)).toBe(true);
    expect(hojas(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('acta de recepción, con y sin diferencias', async () => {
    const datos = (n: number, conDiferencias: boolean) => ({
      folio: 'REC-2026-00017',
      numeroRemito: null,
      fecha: '2026-10-02T11:00:00Z',
      proveedor: { razon_social: 'Distribuidora del Sur SA', cuit: '30712345679' },
      sucursal: 'Saint Thomas',
      ordenCompra: null,
      items: items(n).map((it, i) => ({ nombre: it.nombre, sku: it.sku, pedido: i === 2 ? null : it.cantidad, recibido: conDiferencias && i % 5 === 1 ? it.cantidad - 1 : it.cantidad })),
      recibidoPor: 'Juan',
      observaciones: null,
    });
    const completa = await remitoRecepcionPDF(datos(3, false));
    expect(hojas(completa)).toBe(1);
    const conFaltantes = await remitoRecepcionPDF(datos(30, true));
    expect(esPDF(conFaltantes)).toBe(true);
    expect(hojas(conFaltantes)).toBeGreaterThanOrEqual(2);
  });

  it('si faltan las letras Inter, el papel sale igual en Helvetica', async () => {
    let pdf: Buffer | null = null;
    // módulo nuevo (las letras se cargan una vez por proceso) con wawoff2 que falla
    await jest.isolateModulesAsync(async () => {
      jest.doMock('wawoff2', () => ({ decompress: () => Promise.reject(new Error('sin letras')) }));
      const aislado = jest.requireActual<typeof import('./documentos')>('./documentos');
      pdf = await aislado.ordenDeCompraPDF(orden(3));
    });
    expect(esPDF(pdf!)).toBe(true);
    expect(pdf!.toString('latin1')).toMatch(/Helvetica-Bold/);
    expect(pdf!.toString('latin1')).not.toMatch(/Inter-ExtraBold/);
  });
});
