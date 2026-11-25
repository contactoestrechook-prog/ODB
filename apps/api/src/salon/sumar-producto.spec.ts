// SUMAR UN PRODUCTO A UN PEDIDO QUE YA ENTRÓ (25/11/2026). Leandro: «necesito que si un cliente
// agrega algo exista la posibilidad de sumar el producto». La base hace el renglón, la reserva y
// el total (sumar_producto_pedido); acá se prueba lo de alrededor: que pida producto y cantidad,
// que le avise a quien lo está armando y que el historial lo cuente.
import { BadRequestException } from '@nestjs/common';
import { SalonService, textoDeCantidad } from './salon.service';
import { lineaDeProductoSumado } from '../pedidos/pedidos.service';

const PEDIDO = '63a91968-24c3-4463-9ec5-836ad5c1065b';
const BIDON = '5a289283-f44f-45cd-83f3-b56060e22695';
const LEANDRO = { sub: 'a1452314-4644-4eee-aa4c-806f77922197', rol: 'dueno' };
const ALEXIS = '65b928b5-0000-4000-8000-000000000001';

function armar(respuesta: any, error: any = null) {
  const rpc = jest.fn(async () => ({ data: respuesta, error }));
  const s = new SalonService({ rpc } as any, {} as any, {} as any, {} as any);
  const escribir = jest.spyOn(s, 'escribir').mockResolvedValue({ ok: true, lado: 'caja', avisado: 'Alexis luna', mensajes: [] } as any);
  return { s, rpc, escribir };
}

const sumado = (extra: Record<string, unknown> = {}) => ({
  nombre: 'Bidon Villa del Sur 6,25 LT', cantidad: 4, precio: 4100, totalAntes: 43200, total: 59600,
  asignadoA: ALEXIS, estado: 'en_preparacion', ...extra,
});

describe('Sumar un producto a un pedido', () => {
  it('le pasa a la base el pedido, el producto, la cantidad y quién lo sumó', async () => {
    const { s, rpc } = armar(sumado());
    const r = await s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 4 }, LEANDRO);
    expect(rpc).toHaveBeenCalledWith('sumar_producto_pedido', { p_pedido: PEDIDO, p_producto: BIDON, p_cantidad: 4, p_usuario: LEANDRO.sub });
    expect(r).toMatchObject({ ok: true, total: 59600, nombre: 'Bidon Villa del Sur 6,25 LT' });
  });

  it('si alguien lo está armando, le llega lo nuevo por la charla del pedido', async () => {
    const { s, escribir } = armar(sumado());
    const r = await s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 4 }, LEANDRO);
    expect(escribir).toHaveBeenCalledWith(PEDIDO, 'Se sumó al pedido: 4 × Bidon Villa del Sur 6,25 LT. Armalo con lo nuevo.', LEANDRO);
    expect(r.avisado).toBe('Alexis luna');
  });

  it('sin nadie armándolo (o ya listo) no le escribe a nadie', async () => {
    for (const extra of [{ asignadoA: null }, { estado: 'listo' }, { estado: 'recibido', asignadoA: null }]) {
      const { s, escribir } = armar(sumado(extra));
      const r = await s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 4 }, LEANDRO);
      expect(escribir).not.toHaveBeenCalled();
      expect(r.avisado).toBeNull();
    }
  });

  it('si el aviso falla, lo sumado queda igual', async () => {
    const { s, escribir } = armar(sumado());
    escribir.mockRejectedValueOnce(new Error('sin WhatsApp'));
    const r = await s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 4 }, LEANDRO);
    expect(r).toMatchObject({ ok: true, total: 59600, avisado: null });
  });

  it('sin producto o sin cantidad no llega a la base', async () => {
    const { s, rpc } = armar(sumado());
    await expect(s.sumarProducto(PEDIDO, { cantidad: 4 }, LEANDRO)).rejects.toThrow('Elegí el producto');
    await expect(s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 0 }, LEANDRO)).rejects.toThrow('Poné la cantidad');
    await expect(s.sumarProducto(PEDIDO, { productoId: BIDON }, LEANDRO)).rejects.toThrow(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lo que la base no deja (pagado, sin stock) se ve tal cual', async () => {
    const { s } = armar(null, { message: 'El pedido ya está pagado: lo nuevo va en otro pedido' });
    await expect(s.sumarProducto(PEDIDO, { productoId: BIDON, cantidad: 4 }, LEANDRO)).rejects.toThrow('El pedido ya está pagado: lo nuevo va en otro pedido');
  });

  it('el historial lo cuenta con el total de antes y el de ahora', () => {
    expect(lineaDeProductoSumado({ puso: { nombre: 'Bidon Villa del Sur 6,25 LT', cantidad: 4 }, total_antes: 43200, total: 59600 }))
      .toBe('Sumó 4 × Bidon Villa del Sur 6,25 LT ($43.200 → $59.600)');
    expect(lineaDeProductoSumado({ puso: { nombre: 'Queso cremoso', cantidad: 1.5 } })).toBe('Sumó 1,5 × Queso cremoso');
  });

  it('las cantidades se dicen sin ceros de más', () => {
    expect(textoDeCantidad(4)).toBe('4');
    expect(textoDeCantidad(1.5)).toBe('1,5');
  });
});
