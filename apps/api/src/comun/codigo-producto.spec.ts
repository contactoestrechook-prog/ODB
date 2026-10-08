// El código primero (8/10/2026): armado de pedidos y carga de facturas.
// La función está en el panel (apps/admin/app/lib/codigo-producto.ts).
import { codigoPlu, conCodigo } from '../../../admin/app/lib/codigo-producto';

describe('el código del producto adelante', () => {
  it('Jamón Natural Rifka: sku L10578, código viejo 10578', () => {
    expect(conCodigo('Jamon Natural Rifka', { sku: 'L10578', codigo_legacy: '10578' })).toBe('10578 · Jamon Natural Rifka');
  });
  it('sin código viejo: sale del sku (L10578 o 6668 tal cual)', () => {
    expect(codigoPlu({ sku: 'L10578' })).toBe('10578');
    expect(codigoPlu({ sku: '6668' })).toBe('6668');
  });
  it('el PLU cargado manda, sin ceros adelante', () => {
    expect(codigoPlu({ plu: '03931', codigo_legacy: '777', sku: 'L777' })).toBe('3931');
  });
  it('sku que no es un código: el nombre solo, y no se repite si ya empieza con el código', () => {
    expect(conCodigo('Gin Hendricks', { sku: 'GIN-HEN' })).toBe('Gin Hendricks');
    expect(conCodigo('10578 · Jamon', { sku: 'L10578' })).toBe('10578 · Jamon');
    expect(conCodigo('Producto', null)).toBe('Producto');
  });
});
