// TRASPASOS (10/11/2026): quién puede qué y qué se le dice a la persona.
import { TraspasosService } from './traspasos.service';

const ST = 'st', SI = 'si';
function dbFalsa(o: { rpcError?: string; traspaso?: any } = {}) {
  const rpcs: any[] = [];
  const alertas: any[] = [];
  const t = o.traspaso ?? { id: 't1', numero: 7, estado: 'pedido', origen: { id: ST, nombre: 'Suc Sant Thomas' }, destino: { id: SI, nombre: 'Suc Santa Ines' }, items: [] };
  const db: any = {
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, is: () => q, gte: () => q, gt: () => q, order: () => q, limit: () => q, range: () => q, filter: () => q,
        update: () => q,
        insert: (v: any) => { if (tabla === 'alertas_internas') alertas.push(...(Array.isArray(v) ? v : [v])); return q; },
        maybeSingle: () => Promise.resolve({ data: tabla === 'transferencias' ? t : null, error: null }),
        then: (ok: any, mal: any) => Promise.resolve({ data: tabla === 'productos' ? [{ id: 'p1', sku: 'L1' }] : [], error: null }).then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      rpcs.push({ nombre, args });
      return Promise.resolve(o.rpcError ? { data: null, error: { message: o.rpcError } } : { data: 't1', error: null });
    }),
  };
  return { db, rpcs, alertas };
}
const cajeroSI = { sub: 'u1', rol: 'cajero', sucursalId: SI };

describe('traspasos: quién puede', () => {
  it('un cajero pide para SU local, no para el otro', async () => {
    const { db, rpcs } = dbFalsa();
    const s = new TraspasosService(db);
    await expect(s.pedir(cajeroSI, { origenId: SI, destinoId: ST, items: [{ sku: 'L1', cantidad: 2 }] })).rejects.toThrow(/Solo podés pedir mercadería en tu local/);
    expect(rpcs).toEqual([]);
    await s.pedir(cajeroSI, { origenId: ST, destinoId: SI, items: [{ sku: 'L1', cantidad: 2 }] });
    expect(rpcs[0]).toMatchObject({ nombre: 'traspaso_pedir', args: { p_origen: ST, p_destino: SI, p_items: [{ producto_id: 'p1', cantidad: 2, nota: null }], p_usuario: 'u1' } });
  });
  it('el dueño opera cualquier local', async () => {
    const { db, rpcs } = dbFalsa();
    await new TraspasosService(db).pedir({ sub: 'd', rol: 'dueno', sucursalId: ST }, { origenId: ST, destinoId: SI, items: [{ sku: 'L1', cantidad: 1 }] });
    expect(rpcs).toHaveLength(1);
  });
  it('al pedir le avisa al local que tiene que mandar', async () => {
    const { db, alertas } = dbFalsa();
    await new TraspasosService(db).pedir(cajeroSI, { origenId: ST, destinoId: SI, items: [{ sku: 'L1', cantidad: 2 }] });
    expect(alertas[0]).toMatchObject({ tipo: 'traspaso', titulo: 'Suc Santa Ines te pide mercadería (#7)', referencia: { traspasoId: 't1', link: '/traspasos' } });
  });
  it('un envío en camino lo anula solo gerencia', async () => {
    const { db } = dbFalsa({ traspaso: { id: 't1', numero: 7, estado: 'en_transito', origen: { id: ST }, destino: { id: SI }, items: [] } });
    await expect(new TraspasosService(db).anular(cajeroSI, 't1', 'error')).rejects.toThrow(/lo anula gerencia/);
  });
});

describe('traspasos: lo que se le dice a la persona', () => {
  it('sin stock suficiente, explica en criollo', async () => {
    const { db } = dbFalsa({ rpcError: 'Stock insuficiente: la operación dejaría -3 unidades' });
    await expect(new TraspasosService(db).enviar({ sub: 'u', rol: 'dueno' }, null, { origenId: ST, destinoId: SI, items: [{ sku: 'L1', cantidad: 5 }] }))
      .rejects.toThrow(/No alcanza el stock del local que manda: la operación dejaría -3 unidades/);
  });
  it('sin cantidades, no manda nada', async () => {
    const { db } = dbFalsa();
    await expect(new TraspasosService(db).pedir(cajeroSI, { origenId: ST, destinoId: SI, items: [{ sku: 'L1', cantidad: 0 }] })).rejects.toThrow(/No hay productos con cantidad/);
  });
});
