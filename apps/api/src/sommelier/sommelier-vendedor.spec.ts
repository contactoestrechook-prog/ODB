// El somelier del panel (13/11/2026): arma la cava entera por local y al
// modelo le llegan solo los vinos que mira el vendedor, con stock en su local.
const crear = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ messages: { create: crear } })) }));

import { SommelierService } from './sommelier.service';

process.env.ANTHROPIC_API_KEY ??= 'test';

const prod = (id: string, nombre: string, categoria: string, stock: [string, number][], x: any = {}) => ({
  id, sku: id.toUpperCase(), nombre, descripcion: `${nombre}, rico.`, unidades_vendidas: 3,
  marca: { nombre: 'Bodega' }, categoria: { nombre: categoria },
  stock: stock.map(([sucursal_id, cantidad]) => ({ sucursal_id, cantidad })), ...x,
});

const PRODUCTOS = [
  prod('l1', 'Malbec Uno', 'Vinos Tintos Malbec', [['st', 12], ['si', 0]]),
  prod('l2', 'Torrontes Dos', 'Vinos Blancos Torrontes', [['si', 5]]),
  prod('l3', 'Sin Stock', 'Vinos Tintos Malbec', [['st', 0]]),
  prod('l4', 'Sin Precio', 'Vinos Rosados', [['st', 3]]),
];
const PRECIOS: Record<string, any> = {
  l1: { producto_id: 'l1', precio_final: 15000, precio_lista: 15000 },
  l2: { producto_id: 'l2', precio_final: 9000, precio_lista: 10000, descuento_nombre: 'Blancos 10%' },
  l3: { producto_id: 'l3', precio_final: 8000, precio_lista: 8000 },
};

function dbFalsa() {
  const db: any = {
    rpc: jest.fn((_n: string, args: any) => Promise.resolve({ data: args.p_ids.map((i: string) => PRECIOS[i]).filter(Boolean), error: null })),
    from(tabla: string) {
      const filas = tabla === 'productos' ? PRODUCTOS : tabla === 'sucursales'
        ? [{ id: 'si', nombre: 'Suc Santa Ines' }, { id: 'st', nombre: 'Suc Sant Thomas' }]
        : [{ producto_id: 'l1', maridaje: 'Asado y carnes a la parrilla.' }];
      const b: any = {
        select: () => b, eq: () => b, or: () => b, order: () => b,
        range: (d: number, h: number) => Promise.resolve({ data: filas.slice(d, h + 1), error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: filas, error: null }).then(ok, err),
      };
      return b;
    },
  };
  return db;
}

describe('SommelierService del panel', () => {
  beforeEach(() => crear.mockReset());

  it('la cava: solo lo que tiene stock y precio, con su local, su tipo y su promo', async () => {
    const s = new SommelierService(dbFalsa());
    const cava = await s.cavaPanel();
    expect(cava.sucursales.map((x) => x.nombre)).toEqual(['Santa Inés', 'Sant Thomas']);
    expect(cava.vinos.map((v) => v.sku)).toEqual(['L1', 'L2']);
    const [malbec, torrontes] = cava.vinos;
    expect(malbec).toMatchObject({ tipo: 'tinto', cepa: 'Malbec', stock: { st: 12 }, precioEfectivo: 13500, maridaje: 'Asado y carnes a la parrilla.', promo: null });
    expect(torrontes).toMatchObject({ tipo: 'blanco', cepa: 'Torrontés', stock: { si: 5 }, promo: { nombre: 'Blancos 10%', antes: 10000 } });
  });

  it('al modelo le llegan los candidatos con stock en el local y vuelve la placa', async () => {
    crear.mockResolvedValue({ content: [{ type: 'text', text: 'Para el asado:\nMalbec Uno — $15.000: va justo con la parrilla.\n¿Lo quiere más suave?' }] });
    const s = new SommelierService(dbFalsa());
    const r = await s.vendedor({ mensajes: [{ rol: 'usuario', texto: 'Elegime 3' }], sucursal: 'st', candidatos: ['L2', 'L1'], busca: 'Para un asado' });
    const pedido = crear.mock.calls[0][0];
    const cava = pedido.system[0].text as string;
    expect(cava).toContain('L1 · Malbec Uno (Vinos Tintos Malbec) · $15000');
    expect(cava).not.toContain('Torrontes Dos'); // no hay en Sant Thomas
    expect(pedido.system[1].text).toContain('Para un asado');
    expect(pedido.system[1].text).toContain('en Sant Thomas');
    expect(pedido.thinking).toEqual({ type: 'adaptive' });
    expect(r.vistos).toBe(1);
    expect(r.recomendaciones).toEqual([expect.objectContaining({ sku: 'L1', precio: 15000, precioEfectivo: 13500, porque: 'Va justo con la parrilla.' })]);
    expect(r.cierre).toBe('¿Lo quiere más suave?');
  });

  it('si no queda ningún vino en el local, contesta sin llamar al modelo', async () => {
    const s = new SommelierService(dbFalsa());
    const r = await s.vendedor({ mensajes: [{ rol: 'usuario', texto: 'algo' }], sucursal: 'si', candidatos: ['L1'] });
    expect(crear).not.toHaveBeenCalled();
    expect(r.respuesta).toContain('en Santa Inés');
    expect(r.vistos).toBe(0);
  });

  it('el último mensaje tiene que ser del vendedor', async () => {
    const s = new SommelierService(dbFalsa());
    await expect(s.vendedor({ mensajes: [{ rol: 'somelier', texto: 'hola' }] })).rejects.toThrow('vendedor');
  });
});
