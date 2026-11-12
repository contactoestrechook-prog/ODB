// LA MISMA FACTURA NO ENTRA DOS VECES (9/11/2026). La Serenísima 06376-00001075
// se registró el 5/11 y otra vez el 9/11 desde la foto: 466 unidades sumaron
// dos veces al stock. Se frena antes de tocar la base.
import { ComprasService } from './compras.service';
import { claveNumero, mismoNumero } from './numero-comprobante';

function dbFalsa(yaExiste: boolean, numeroGuardado = '06376-00001075') {
  const rpcs: string[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q, insert: () => q, update: () => q, upsert: () => q,
        eq: () => q, neq: () => q, in: () => q, is: () => q, gt: () => q, gte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: tabla === 'productos' ? { id: 'p-1' } : null, error: null }),
        single: () => Promise.resolve({ data: { id: 'f-nueva' }, error: null }),
        then: (ok: any, mal: any) => Promise.resolve({
          data: tabla === 'facturas_proveedor' && yaExiste ? [{ id: 'f-otra', creado_en: '2026-11-01T12:00:00Z', numero: '06376-00000999' }, { id: 'f-vieja', creado_en: '2026-11-05T19:14:06Z', numero: numeroGuardado }] : [],
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
  it('el mismo número escrito distinto también frena: sin ceros, todo junto o con la letra', async () => {
    for (const guardado of ['6376-1075', '0637600001075', 'A 06376-00001075', 'FC A 6376 - 00001075']) {
      const { db, rpcs } = dbFalsa(true, guardado);
      await expect(new ComprasService(db).entradaDirecta(entrada as any)).rejects.toThrow(/ya se registró el 5\/11/);
      expect(rpcs).toEqual([]);
    }
  });
  it('otra factura del mismo proveedor no frena', async () => {
    const { db, rpcs } = dbFalsa(true, '06376-00001076');
    await new ComprasService(db).entradaDirecta(entrada as any);
    expect(rpcs).toContain('recibir_compra_directa');
  });
  it('si es nueva, entra como siempre', async () => {
    const { db, rpcs } = dbFalsa(false);
    await new ComprasService(db).entradaDirecta(entrada as any);
    expect(rpcs).toContain('recibir_compra_directa');
  });
});

describe('mismoNumero: punto de venta y número, como números', () => {
  it('la misma factura en sus formas', () => {
    expect(claveNumero('06376-00001075')).toBe('6376-1075');
    expect(mismoNumero('06376-00001075', '6376-1075')).toBe(true);
    expect(mismoNumero('0005-00012353', '000500012353')).toBe(true);
    expect(mismoNumero('A 0005-00012353', '0005 - 00012353')).toBe(true);
  });
  it('facturas distintas', () => {
    expect(mismoNumero('0005-00012353', '0005-00012354')).toBe(false);
    expect(mismoNumero('0005-00012353', '0006-00012353')).toBe(false);
  });
  it('un número suelto sin punto de venta solo coincide si está escrito igual', () => {
    expect(mismoNumero('1075', '1075')).toBe(true);
    expect(mismoNumero('1075', '06376-00001075')).toBe(false);
    expect(mismoNumero('', '')).toBe(false);
  });
});
