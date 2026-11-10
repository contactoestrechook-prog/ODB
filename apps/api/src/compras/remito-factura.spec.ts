// La factura de un remito ya cargado (10/11/2026). La regla vive en el panel.
import { remitoDeLaFactura } from '../../../admin/app/lib/remito-factura';

const remito = (id: string, items: [string, number, number?][]) => ({ id, numero: `R-${id}`, fecha: '2026-11-08', items: items.map(([sku, cantidad, costo = 1000]) => ({ sku, nombre: `Prod ${sku}`, cantidad, costo })) });

describe('la factura de un remito ya cargado', () => {
  it('el mismo pedido: lo encuentra y dice que las cantidades coinciden', () => {
    const c = remitoDeLaFactura([{ sku: 'A', cantidad: 12 }, { sku: 'B', cantidad: 6 }, { sku: 'C', cantidad: 24 }], [remito('1', [['A', 12], ['B', 6], ['C', 24]])]);
    expect(c).toMatchObject({ remito: { id: '1' }, coinciden: 3, mismasCantidades: true, soloFactura: [], soloRemito: [] });
  });
  it('con diferencias: lo encuentra igual y las nombra', () => {
    const c = remitoDeLaFactura([{ sku: 'A', cantidad: 12 }, { sku: 'B', cantidad: 5 }, { sku: 'D', cantidad: 1 }], [remito('1', [['A', 12], ['B', 6], ['C', 24]])]);
    expect(c).toMatchObject({ coinciden: 2, mismasCantidades: false, soloFactura: ['D'], soloRemito: ['Prod C'] });
  });
  it('otro pedido del mismo proveedor: no lo confunde', () => {
    expect(remitoDeLaFactura([{ sku: 'X', cantidad: 1 }, { sku: 'Y', cantidad: 1 }, { sku: 'A', cantidad: 1 }], [remito('1', [['A', 12], ['B', 6], ['C', 24]])])).toBeNull();
  });
  it('con dos remitos, el que más se parece', () => {
    const c = remitoDeLaFactura([{ sku: 'A', cantidad: 1 }, { sku: 'B', cantidad: 1 }], [remito('1', [['A', 1], ['Z', 1], ['W', 1]]), remito('2', [['A', 1], ['B', 1]])]);
    expect(c?.remito.id).toBe('2');
  });
  it('un remito que entró sin precio lo resuelve «entró sin precio», no este cruce', () => {
    expect(remitoDeLaFactura([{ sku: 'A', cantidad: 4 }], [remito('1', [['A', 4, 0]])])).toBeNull();
  });
  it('sin productos vinculados en la factura, no hay cruce', () => {
    expect(remitoDeLaFactura([{ sku: null, cantidad: 4 }], [remito('1', [['A', 4]])])).toBeNull();
  });
});
