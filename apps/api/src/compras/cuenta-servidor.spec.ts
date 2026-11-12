// La cuenta de la factura, también en el servidor (11/11/2026). La pantalla
// manda las partes con las que hizo la cuenta y el servidor la rehace con el
// mismo código antes de registrar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { controlarCuenta, limpiarCuenta } from './cuenta-servidor';
import { ComprasService } from './compras.service';

const parte = (renglon: number, tipo: string, valor: number, unidades = 1) => ({ renglon, descripcion: `renglón ${renglon}`, tipo, valor, unidades });

describe('la cuenta de la API es la misma que la del panel', () => {
  it('cuenta-factura.ts es copia exacta de apps/admin/app/lib/cuenta-factura.ts', () => {
    // el servidor compila la API sola, sin la carpeta del panel: por eso hay dos
    // copias. Si se toca una, se copia a la otra.
    expect(readFileSync(join(__dirname, 'cuenta-factura.ts'), 'utf8'))
      .toBe(readFileSync(join(__dirname, '../../../admin/app/lib/cuenta-factura.ts'), 'utf8'));
  });
});

describe('controlarCuenta: el servidor rehace la cuenta', () => {
  it('cierra: lo que entra más lo que no entra da el total', () => {
    const c = controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 800, 8), parte(2, 'no_entra', 200, 2)] }, 1000, [{ cantidad: 8 }]);
    expect(c?.frena).toBeNull();
    expect(c?.cuenta.estado).toBe('cierra');
    expect(c?.cruce).toEqual({ unidadesCuenta: 8, unidadesAlStock: 8, coincide: true });
  });
  it('no cierra y nadie aceptó la diferencia: frena, y dice por cuánto y dónde mirar', () => {
    const c = controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 600, 6), parte(2, 'entra', 200, 2)] }, 1000, [{ cantidad: 8 }]);
    expect(c?.cuenta.estado).toBe('no_cierra');
    expect(c?.frena).toMatch(/no cierra\. La factura cobra \$200 más de lo que suman los renglones.*No se registró nada/);
  });
  it('no cierra pero una persona aceptó ESA diferencia con un motivo: pasa', () => {
    const c = controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 800, 8)], aceptada: { monto: 200, motivo: 'flete que no está en los renglones' } }, 1000, [{ cantidad: 8 }]);
    expect(c?.cuenta.estado).toBe('aceptada');
    expect(c?.frena).toBeNull();
  });
  it('aceptada sin motivo, o por otro monto, no vale', () => {
    expect(controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 800)], aceptada: { monto: 200, motivo: '  ' } }, 1000, [])?.frena).toMatch(/no cierra/);
    expect(controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 800)], aceptada: { monto: 50, motivo: 'redondeo' } }, 1000, [])?.frena).toMatch(/no cierra/);
  });
  it('la cuenta se hizo con un total y se registra otro: frena', () => {
    const c = controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 1000, 10)] }, 1500, [{ cantidad: 10 }]);
    expect(c?.frena).toMatch(/se hizo con un total de \$1\.000 y se está registrando \$1\.500/);
  });
  it('el redondeo tolerado es el de la cuenta: medio por ciento, nunca menos de $5', () => {
    expect(controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 996)] }, 1000, [])?.frena).toBeNull();
    expect(controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 990)] }, 1000, [])?.frena).toMatch(/no cierra/);
  });
  it('el cruce de unidades se anota y todavía no frena', () => {
    const c = controlarCuenta({ total: 1000, partes: [parte(1, 'entra', 1000, 10)] }, 1000, [{ cantidad: 7 }, { cantidad: 5, valorizaOc: true }]);
    expect(c?.frena).toBeNull();
    expect(c?.cruce).toEqual({ unidadesCuenta: 10, unidadesAlStock: 7, coincide: false });
  });
  it('una pantalla vieja no manda la cuenta: no se frena nada, como antes', () => {
    expect(controlarCuenta(undefined, 1000, [])).toBeNull();
    expect(controlarCuenta({ total: 1000 }, 1000, [])).toBeNull();
  });
  it('lo que llega se limpia: un valor que no es número o un tipo inventado invalidan la cuenta entera', () => {
    expect(limpiarCuenta({ partes: [{ renglon: 1, tipo: 'entra', valor: 'mucho' }] })).toBeNull();
    expect(limpiarCuenta({ partes: [{ renglon: 1, tipo: 'regalo', valor: 10 }] })).toBeNull();
    expect(limpiarCuenta({ partes: [parte(1, 'entra', 10)], aceptada: { monto: 5, motivo: '' } })?.aceptada).toBeNull();
  });
});

describe('entradaDirecta: la cuenta que no cierra no toca el stock', () => {
  function dbFalsa() {
    const rpcs: string[] = [];
    const auditoria: any[] = [];
    const db: any = {
      from: jest.fn((tabla: string) => {
        const q: any = {
          select: () => q, update: () => q, upsert: () => q,
          insert: (fila: any) => { if (tabla === 'auditoria') auditoria.push(fila); return q; },
          eq: () => q, neq: () => q, in: () => q, is: () => q, gt: () => q, gte: () => q, order: () => q, limit: () => q,
          maybeSingle: () => Promise.resolve({ data: tabla === 'productos' ? { id: 'p-1' } : null, error: null }),
          single: () => Promise.resolve({ data: { id: 'f-nueva' }, error: null }),
          then: (ok: any, mal: any) => Promise.resolve({ data: [], error: null }).then(ok, mal),
        };
        return q;
      }),
      rpc: jest.fn((nombre: string) => {
        rpcs.push(nombre);
        return Promise.resolve({ data: nombre === 'recibir_compra_directa' ? { oc_id: 'oc-1', remito_id: 'rem-1' } : 1, error: null });
      }),
    };
    return { db, rpcs, auditoria };
  }
  const entrada = (cuenta: unknown) => ({
    proveedorId: 'prov-1', sucursalId: 's-1', usuarioId: 'u-ana',
    items: [{ sku: 'A1', cantidad: 8, costo: 100 }],
    factura: { numero: '0005-00012353', total: 1000 },
    cuenta,
  });

  it('no cierra: error, y no se llamó a nada que mueva stock', async () => {
    const { db, rpcs } = dbFalsa();
    await expect(new ComprasService(db).entradaDirecta(entrada({ total: 1000, partes: [parte(1, 'entra', 800, 8)] }) as any)).rejects.toThrow(/La cuenta de la factura no cierra/);
    expect(rpcs).toEqual([]);
  });
  it('cierra: entra, y la cuenta queda escrita junto a la factura', async () => {
    const { db, rpcs, auditoria } = dbFalsa();
    await new ComprasService(db).entradaDirecta(entrada({ total: 1000, partes: [parte(1, 'entra', 800, 8), parte(2, 'no_entra', 200, 2)] }) as any);
    expect(rpcs).toContain('recibir_compra_directa');
    const escrita = auditoria.find((a) => a.accion === 'cuenta_factura');
    expect(escrita).toMatchObject({ entidad: 'factura_proveedor', entidad_id: 'f-nueva', datos_despues: { estado: 'cierra', total: 1000, cruce: { coincide: true } } });
  });
  it('sin la cuenta (pantalla vieja): entra como siempre', async () => {
    const { db, rpcs, auditoria } = dbFalsa();
    await new ComprasService(db).entradaDirecta(entrada(undefined) as any);
    expect(rpcs).toContain('recibir_compra_directa');
    expect(auditoria.filter((a) => a.accion === 'cuenta_factura')).toEqual([]);
  });
});
