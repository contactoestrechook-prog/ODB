import { adjuntoDeFactura, remitenteAceptado } from './casilla-compras.service';

describe('casilla de compras', () => {
  it('los PDF entran siempre, aunque el mail los mande como octet-stream', () => {
    expect(adjuntoDeFactura({ contentType: 'application/pdf', filename: 'FC-0007-00136173.pdf', size: 180_000 })).toEqual({ mimetype: 'application/pdf' });
    expect(adjuntoDeFactura({ contentType: 'application/octet-stream', filename: 'factura.PDF', size: 90_000 })).toEqual({ mimetype: 'application/pdf' });
  });
  it('la foto de la factura entra; el logo de la firma no', () => {
    expect(adjuntoDeFactura({ contentType: 'image/jpeg', filename: 'IMG_2231.jpg', size: 1_400_000 })).toEqual({ mimetype: 'image/jpeg' });
    expect(adjuntoDeFactura({ contentType: 'image/png', filename: 'logo.png', size: 12_000 })).toBeNull();
    expect(adjuntoDeFactura({ contentType: 'image/jpeg', filename: 'firma.jpg', size: 200_000, contentDisposition: 'inline' })).toBeNull();
  });
  it('planillas, textos y archivos gigantes no', () => {
    expect(adjuntoDeFactura({ contentType: 'application/vnd.ms-excel', filename: 'lista.xls', size: 50_000 })).toBeNull();
    expect(adjuntoDeFactura({ contentType: 'application/pdf', filename: 'catalogo.pdf', size: 40 * 1024 * 1024 })).toBeNull();
  });
  it('remitentes: sin lista entra todo; con lista, mails o dominios', () => {
    expect(remitenteAceptado('facturas@rueda.com.ar', '')).toBe(true);
    expect(remitenteAceptado('Facturas@LaSerenisima.com.ar', '@laserenisima.com.ar, ventas@clan.com.ar')).toBe(true);
    expect(remitenteAceptado('ventas@clan.com.ar', '@laserenisima.com.ar, ventas@clan.com.ar')).toBe(true);
    expect(remitenteAceptado('premios@estafa.com', '@laserenisima.com.ar')).toBe(false);
  });
});
