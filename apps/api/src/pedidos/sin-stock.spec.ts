import { faltasEnSistema, lineaDeFalta, reservadoDelRenglon } from './sin-stock';
import { notasDelPedido } from './charla-a-pedido';

// Lo que el sistema da sin stock (20/11/2026): el pedido de Andrea (DOM-87B017B4EA14)
// llegó al armado con Queso Adler Salame (pidió 4, había 1) y Pan Lactal con semillas (0).

const items = [
  { productoId: 'adler', nombre: 'Queso Adler Salame x 100g', cantidad: 4 },
  { productoId: 'pan', nombre: 'Pan Lactal c/ Semillas x 330g', cantidad: 1 },
  { productoId: 'coca', nombre: 'Coca Cola Zero x1.75L', cantidad: 24 },
  { productoId: 'jamon', nombre: 'Jamon Cocido Bocatti Natural', cantidad: 0.25 },
];
const stock: Record<string, number> = { adler: 1, coca: 565, jamon: 0.2 };

describe('lo que el sistema da sin stock', () => {
  it('el caso de Andrea: el Adler, el pan y el jamón que no alcanza', () => {
    const f = faltasEnSistema(items, (id) => stock[id] ?? 0);
    expect(f.map(lineaDeFalta)).toEqual([
      'Queso Adler Salame x 100g (pide 4, hay 1)',
      'Pan Lactal c/ Semillas x 330g (pide 1, hay 0)',
      'Jamon Cocido Bocatti Natural (pide 0,25, hay 0,2)',
    ]);
  });

  it('si el pedido reservó, lo suyo ya está descontado del stock: no falta', () => {
    // reservó los 4 Adler: el stock quedó en 0, pero son de este pedido
    expect(faltasEnSistema([{ productoId: 'adler', nombre: 'Adler', cantidad: 4, reservado: 4 }], () => 0)).toEqual([]);
    // reservó lo que había (1 de 4): faltan 3
    expect(faltasEnSistema([{ productoId: 'adler', nombre: 'Adler', cantidad: 4, reservado: 1 }], () => 0).map((f) => f.hay)).toEqual([1]);
  });

  it('cuánto reservó un renglón: lo que dice, y en los de antes todo o nada según el pedido', () => {
    expect(reservadoDelRenglon(true, 4, null)).toBe(4);
    expect(reservadoDelRenglon(false, 4, null)).toBe(0);
    expect(reservadoDelRenglon(true, 4, 1)).toBe(1);
    expect(reservadoDelRenglon(true, 4, '0')).toBe(0);
  });

  it('las notas del pedido dicen qué no alcanza, con nombre', () => {
    const n = notasDelPedido({ sinStock: ['Queso Adler Salame x 100g (pide 4, hay 1)'], sinReserva: true });
    expect(n).toBe('Sin stock en el sistema al cargarlo: Queso Adler Salame x 100g (pide 4, hay 1). Si no están, «No hay» y ofrecé un parecido · Sin reserva de stock: no alcanzaba al cargarlo');
  });
});
