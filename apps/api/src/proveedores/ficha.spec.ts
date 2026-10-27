import { aliasValido, cbuValido, cuitLegible, cuitNormalizado, emailValido, faltantes, telefonoValido } from './ficha';
import { dominioDe, iconosDelHtml } from './proveedores-ficha.service';

describe('CUIT', () => {
  it('acepta un CUIT real con o sin guiones y lo guarda en dígitos', () => {
    expect(cuitNormalizado('30-71696971-8')).toBe('30716969718');
    expect(cuitNormalizado('30705166923')).toBe('30705166923');
    expect(cuitNormalizado(' 20-24375888-3 ')).toBe('20243758883');
  });
  it('rechaza el dígito verificador mal, el largo mal y prefijos inexistentes', () => {
    expect(cuitNormalizado('30-71696971-0')).toBeNull();
    expect(cuitNormalizado('3071696971')).toBeNull();
    expect(cuitNormalizado('99716969718')).toBeNull();
    expect(cuitNormalizado('')).toBeNull();
  });
  it('se muestra con guiones', () => {
    expect(cuitLegible('30716969718')).toBe('30-71696971-8');
    expect(cuitLegible(null)).toBe('');
  });
});

describe('CBU y alias', () => {
  it('valida los dos verificadores', () => {
    expect(cbuValido('2850590940090418135201')).toBe('2850590940090418135201');
    expect(cbuValido('0170099 2200000677973 70')).toBe('0170099220000067797370');
    expect(cbuValido('2850590940090418135202')).toBeNull();
    expect(cbuValido('123')).toBeNull();
  });
  it('alias en mayúsculas, sin espacios', () => {
    expect(aliasValido('odb.premium.mp')).toBe('ODB.PREMIUM.MP');
    expect(aliasValido('con espacio')).toBeNull();
    expect(aliasValido('abc')).toBeNull();
  });
});

describe('contacto', () => {
  it('mail y teléfono', () => {
    expect(emailValido(' Ventas@Distri.com.ar ')).toBe('ventas@distri.com.ar');
    expect(emailValido('ventas@')).toBeNull();
    expect(telefonoValido('11 2345-6789')).toBe('11 2345-6789');
    expect(telefonoValido('4567')).toBeNull();
  });
});

describe('faltantes', () => {
  it('lista lo que falta en orden de importancia', () => {
    expect(faltantes({})).toEqual(['CUIT', 'WhatsApp', 'Dirección', 'Condición de IVA', 'Condición de pago', 'Plazo de entrega', 'Mail']);
    expect(faltantes({ cuit: '30716969718', telefono: '5491122812200', direccion: 'Castex 3601', condicion_iva: 'responsable_inscripto',
      condicion_pago: '30 días', lead_time_confirmado: true, email: 'a@b.com' })).toEqual([]);
  });
});

describe('logo desde la web', () => {
  it('saca el dominio de lo que escriban', () => {
    expect(dominioDe('https://www.arcor.com/ar/')).toBe('www.arcor.com');
    expect(dominioDe('laserenisima.com.ar')).toBe('laserenisima.com.ar');
    expect(dominioDe('no tiene')).toBeNull();
    expect(dominioDe('')).toBeNull();
  });
  it('toma los íconos de la portada, el más grande primero', () => {
    const html = `<head><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="https://cdn.x.com/ati.png">
      <link rel="icon" type="image/png" sizes="192x192" href="img/logo-192.png"><link rel="stylesheet" href="a.css"></head>`;
    expect(iconosDelHtml(html, 'https://www.x.com/home/')).toEqual([
      'https://www.x.com/home/img/logo-192.png', 'https://cdn.x.com/ati.png', 'https://www.x.com/favicon-32.png',
    ]);
  });
});
