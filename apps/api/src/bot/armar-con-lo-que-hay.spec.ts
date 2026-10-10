// El resumen se arma con lo que hay (Leandro, 10/10/2026): el cliente dio el nombre y el bot lo
// pasó a una persona porque en la lista había productos sin stock suficiente.
import { BotService } from './bot.service';

process.env.ANTHROPIC_API_KEY ??= 'test';

function armar(renglones: any[]) {
  const inserts: any[] = [];
  const b: any = {
    insert: (fila: any) => { inserts.push(fila); return b; },
    select: () => b,
    single: async () => ({ data: { id: 'cot-1' }, error: null }),
  };
  const db: any = { from: () => b, rpc: jest.fn() };
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.cotizarPedido = jest.fn(async () => ({
    renglones,
    total: renglones.reduce((t, r) => t + (r.subtotal ?? 0), 0),
    hayFaltantes: renglones.some((r) => r.alcanzaElStock === false || r.error),
    sucursalId: 'suc-1',
  }));
  return { s, inserts };
}
const r = (nombre: string, cant: number, precio: number, extra: any = {}) => ({ sku: nombre, nombre, cantidad: cant, precioUnitario: precio, subtotal: cant * precio, renglon: `${cant} × $${precio} c/u = $${cant * precio}`, alcanzaElStock: true, presentacion: 'catalogada', ...extra });

describe('preparar_pedido arma el resumen con lo que hay', () => {
  it('los que no alcanzan quedan afuera, el total es el de lo que queda y no se deriva', async () => {
    const { s, inserts } = armar([r('Yerba La Mañanita 1 kg', 1, 7200), r('Té verde Twinings x 10', 10, 1500, { alcanzaElStock: false }), r('Manteca La Serenísima 200 g', 2, 5000)]);
    const out = await s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'Leandro', items: [{ sku: 'a', cantidad: 1 }] });
    expect(out.total).toBe(17200);
    expect(out.renglones.map((x: any) => x.nombre)).toEqual(['Yerba La Mañanita 1 kg', 'Manteca La Serenísima 200 g']);
    expect(out.resumen).not.toMatch(/Twinings/);
    expect(out.resumen).toMatch(/Total: \$17\.200/);
    expect(out.sinIncluir).toEqual(['Té verde Twinings x 10']);
    expect(inserts[0].total).toBe(17200);
  });
  it('si no queda nada para armar, como antes: no se puede confirmar', async () => {
    const { s } = armar([r('Té verde Twinings x 10', 10, 1500, { alcanzaElStock: false })]);
    await expect(s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'Leandro', items: [{ sku: 'a', cantidad: 1 }] })).rejects.toThrow(/No se puede confirmar/);
  });
});
