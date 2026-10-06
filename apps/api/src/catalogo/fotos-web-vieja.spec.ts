import { loteWebVieja, urlFotoWebVieja } from './fotos-web-vieja';

describe('fotos del sitio viejo www.odbpremiummarket.com.ar', () => {
  it('acepta solo imágenes del servidor del sitio viejo', () => {
    expect(urlFotoWebVieja('https://cdn.plantheoshops.com.ar/imagenes/3/1461.jpg')).toBe('https://cdn.plantheoshops.com.ar/imagenes/3/1461.jpg');
    expect(urlFotoWebVieja('https://cdn.plantheoshops.com.ar/imagenes/3/600a0b5e146cc_1611271006-0837.jpeg')).not.toBeNull();
    expect(urlFotoWebVieja('https://cdn.plantheoshops.com.ar/dependencias/branding/logo.png')).toBeNull();
    expect(urlFotoWebVieja('https://cdn.plantheoshops.com.ar/imagenes/3/sin-imagen.jpg')).toBeNull();
    expect(urlFotoWebVieja('https://evil.example.com/imagenes/3/1461.jpg')).toBeNull();
    expect(urlFotoWebVieja('http://169.254.169.254/imagenes/x.jpg')).toBeNull();
    expect(urlFotoWebVieja('')).toBeNull();
  });
  it('limpia el lote: sin SKU, sin foto válida o repetido no entra', () => {
    const r = loteWebVieja([
      { sku: 'L1461', url: 'https://cdn.plantheoshops.com.ar/imagenes/3/1461.jpg', nombre: 'Andes IPA 473cc' },
      { sku: 'L1461', url: 'https://cdn.plantheoshops.com.ar/imagenes/3/otra.jpg' },
      { sku: '', url: 'https://cdn.plantheoshops.com.ar/imagenes/3/1409.jpg' },
      { sku: 'L9', url: 'https://otro.com/imagenes/3/1.jpg' },
    ]);
    expect(r.validos).toEqual([{ sku: 'L1461', url: 'https://cdn.plantheoshops.com.ar/imagenes/3/1461.jpg', nombre: 'Andes IPA 473cc' }]);
    expect(r.descartados).toBe(3);
  });
  it('no acepta más de lo que entra en un pedido', () => {
    const muchos = Array.from({ length: 130 }, (_, i) => ({ sku: `L${i}`, url: `https://cdn.plantheoshops.com.ar/imagenes/3/${i}.jpg` }));
    expect(loteWebVieja(muchos, 100).validos).toHaveLength(100);
  });
});
