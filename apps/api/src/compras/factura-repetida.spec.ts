// LA MISMA FACTURA NO ENTRA DOS VECES (9/11/2026). La Serenísima 06376-00001075
// se registró el 5/11 y otra vez el 9/11 desde la foto: 466 unidades sumaron
// dos veces al stock. Se frena antes de tocar la base.
import { ComprasService } from './compras.service';

function dbFalsa(yaExiste: boolean) {
  const rpcs: string[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q, insert: () => q, update: () => q, upsert: () => q,
        eq: () => q, neq: () => q, in: () => q, is: () => q, gt: () => q, gte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: tabla === 'productos' ? { id: 'p-1' } : null, error: null }),
        single: () => Promise.resolve({ data: { id: 'f-nueva' }, error: null }),
        then: (ok: any, mal: any) => Promise.resolve({
          data: tabla === 'facturas_proveedor' && yaExiste ? [{ id: 'f-vieja', creado_en: '2026-11-05T19:14:06Z' }] : [],
          error: null,
        }).then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string) => {
      rpcs.push(nombre);
      return Promise.resolve({ data: nombre === 'recibir_compra_directa' ? { oc_id: 'oc-1', remito_id: 'rem-1' } : 1, error: null });
    }),
  };
  return { db, rpcs };
}
const entrada = {
  proveedorId: 'serenisima', sucursalId: 's-1', usuarioId: 'u-ana',
  items: [{ sku: 'Q1', cantidad: 466, costo: 2100 }],
  factura: { numero: '06376-00001075', total: 1022386.6 },
};

describe('la misma factura dos veces', () => {
  it('si ya está registrada, frena y no toca el stock', async () => {
    const { db, rpcs } = dbFalsa(true);
    await expect(new ComprasService(db).entradaDirecta(entrada as any)).rejects.toThrow(/06376-00001075 de este proveedor ya se registró el 5\/11/);
    expect(rpcs).toEqual([]);
  });
  it('si es nueva, entra como siempre', async () => {
    const { db, rpcs } = dbFalsa(false);
    await new ComprasService(db).entradaDirecta(entrada as any);
    expect(rpcs).toContain('recibir_compra_directa');
  });
});
