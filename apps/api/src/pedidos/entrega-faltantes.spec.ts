import { ConflictException } from '@nestjs/common';
import { PedidosService, lineaDeCambioDeProductos, mensajeDeFaltantes } from './pedidos.service';

// Al entregar, si falta algo, la pantalla pregunta si se saca o se reemplaza
// (Leandro, 21/10/2026). Antes: cuatro "Stock insuficiente: la operación
// dejaría -6.000 unidades" seguidos sin decir de qué producto.

const QUILMES = { producto_id: 'prod-q', sku: 'CER-0001', nombre: 'Cerveza Quilmes lata 473', pide: 6, hay: 0 };

function armar(rpcs: Record<string, any>, pedido: any = { id: 'p-1', estado: 'listo', items: [], cliente: null }) {
  const llamadas: { name: string; args: any }[] = [];
  const q: any = {
    select: () => q, eq: () => q,
    single: () => Promise.resolve({ data: pedido, error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 'prod-reemplazo' }, error: null }),
  };
  const db: any = {
    from: () => q,
    rpc: (name: string, args: any) => {
      llamadas.push({ name, args });
      const r = typeof rpcs[name] === 'function' ? rpcs[name](args) : rpcs[name] ?? { data: null, error: null };
      return Promise.resolve(r);
    },
  };
  return { svc: new PedidosService(db, { aCliente: jest.fn() } as any), llamadas };
}

describe('entregar con faltantes', () => {
  it('si falta algo NO intenta entregar: devuelve qué falta, con nombre y cantidades', async () => {
    const { svc, llamadas } = armar({ faltantes_pedido: { data: [QUILMES], error: null } });
    const err = await svc.avanzar('p-1', 'entregado').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const cuerpo = err.getResponse();
    expect(cuerpo.codigo).toBe('FALTA_STOCK');
    expect(cuerpo.faltantes).toEqual([{ productoId: 'prod-q', sku: 'CER-0001', nombre: 'Cerveza Quilmes lata 473', pide: 6, hay: 0 }]);
    expect(cuerpo.message).toBe('No alcanza el stock de Cerveza Quilmes lata 473: el pedido lleva 6 y hay 0. ¿Lo sacamos o lo reemplazamos?');
    expect(llamadas.find((l) => l.name === 'entregar_pedido')).toBeUndefined();
  });

  it('sin faltantes entrega como siempre', async () => {
    const { svc, llamadas } = armar({ faltantes_pedido: { data: [], error: null }, entregar_pedido: { data: { venta: { venta_id: 'v-1' } }, error: null } });
    await expect(svc.avanzar('p-1', 'entregado')).resolves.toMatchObject({ estado: 'entregado' });
    expect(llamadas.map((l) => l.name)).toEqual(['faltantes_pedido', 'entregar_pedido']);
  });

  it('si alguien vendió lo último entre la consulta y la entrega, igual vuelve la lista de faltantes', async () => {
    let vez = 0;
    const { svc } = armar({
      faltantes_pedido: () => ({ data: vez++ === 0 ? [] : [QUILMES], error: null }),
      entregar_pedido: { data: null, error: { message: 'Stock insuficiente: la operación dejaría -6.000 unidades' } },
    });
    const err = await svc.avanzar('p-1', 'entregado').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().faltantes).toHaveLength(1);
  });

  it('sacar o reemplazar va a la función de la base con el producto, el reemplazo por sku y quién lo hizo', async () => {
    const { svc, llamadas } = armar({ resolver_faltante_pedido: { data: { total: 46840, totalAntes: 42760, pagado: true }, error: null }, faltantes_pedido: { data: [], error: null } });
    const r = await svc.resolverFaltante('p-1', 'prod-q', 'CER-0002', undefined, 'u-1');
    expect(llamadas[0]).toEqual({ name: 'resolver_faltante_pedido', args: { p_pedido: 'p-1', p_producto: 'prod-q', p_reemplazo: 'prod-reemplazo', p_cantidad: null, p_usuario: 'u-1' } });
    expect(r).toMatchObject({ total: 46840, faltantes: [] });
  });

  it('una cantidad de reemplazo en cero o negativa no llega a la base', async () => {
    const { svc, llamadas } = armar({});
    await expect(svc.resolverFaltante('p-1', 'prod-q', 'CER-0002', 0)).rejects.toThrow(/mayor que 0/);
    expect(llamadas).toEqual([]);
  });
});

describe('los textos', () => {
  it('varios faltantes van en un solo mensaje', () => {
    expect(mensajeDeFaltantes([
      { productoId: 'a', sku: null, nombre: 'Quilmes', pide: 6, hay: 2 },
      { productoId: 'b', sku: null, nombre: 'Jamón crudo', pide: 0.3, hay: 0.125 },
    ])).toBe('No alcanza el stock de 2 productos (Quilmes: el pedido lleva 6 y hay 2; Jamón crudo: el pedido lleva 0,3 y hay 0,125). ¿Los sacamos o los reemplazamos?');
  });

  it('la línea del historial dice qué se sacó, qué se puso y cómo cambió el total', () => {
    expect(lineaDeCambioDeProductos({ saco: { nombre: 'Quilmes lata', cantidad: 6 }, puso: { nombre: 'Quilmes x473cc', cantidad: 6 }, total_antes: 42760, total: 46840 }))
      .toBe('Faltaba stock: sacó 6 × Quilmes lata y puso 6 × Quilmes x473cc ($42.760 → $46.840)');
    expect(lineaDeCambioDeProductos({ saco: { nombre: 'Quilmes lata', cantidad: 4 }, puso: null, total_antes: 42760, total: 37520 }))
      .toBe('Faltaba stock: sacó 4 × Quilmes lata ($42.760 → $37.520)');
  });
});
