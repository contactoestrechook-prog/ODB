import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { registrarPedidosLentos, textoPedidoLento } from './pedidos-lentos';

describe('pedidos lentos', () => {
  it('arma el renglón con ruta sin consulta, estado, segundos y quién', () => {
    expect(textoPedidoLento({ method: 'GET', originalUrl: '/compras/lecturas?id=123&x=1', usuario: { sub: 'u1', rol: 'administrativo' } }, 200, 4321))
      .toBe('GET /compras/lecturas → 200 · 4.3 s · administrativo u1');
    expect(textoPedidoLento({ method: 'POST', url: '/bot/waha' }, 500, 3000)).toBe('POST /bot/waha → 500 · 3.0 s · sin sesión');
  });

  it('anota solo lo que pasa del umbral, una vez, y marca si la persona se fue antes', async () => {
    const avisos: string[] = [];
    const espia = jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => { avisos.push(String(m)); });
    const mw = registrarPedidosLentos(20);
    const pedido = (fin: 'finish' | 'close', esperaMs: number) =>
      new Promise<void>((ok) => {
        const res: any = new EventEmitter();
        res.statusCode = 200;
        res.writableEnded = fin === 'finish';
        mw({ method: 'GET', originalUrl: `/r-${fin}-${esperaMs}` }, res, () => undefined);
        setTimeout(() => { res.emit(fin); if (fin === 'finish') res.emit('close'); ok(); }, esperaMs);
      });
    await pedido('finish', 1);
    await pedido('finish', 40);
    await pedido('close', 40);
    espia.mockRestore();
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toMatch(/^GET \/r-finish-40 → 200 · /);
    expect(avisos[1]).toMatch(/^GET \/r-close-40 → 499 · .* · la persona se fue antes$/);
  });
});
