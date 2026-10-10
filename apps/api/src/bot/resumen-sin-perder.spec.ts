// El resumen no pierde productos que el cliente vio con precio (Leandro, 10/10/2026: 26 productos
// a la vista, el resumen salió con 19 y otro total, y el nombre no cerró el pedido).
import { BotService } from './bot.service';
import { cierraConElDato } from './cierre-con-dato';

process.env.ANTHROPIC_API_KEY ??= 'test';

function armar(renglones: any[]) {
  const inserts: any[] = [];
  const b: any = { insert: (f: any) => { inserts.push(f); return b; }, select: () => b, single: async () => ({ data: { id: 'cot-1' }, error: null }) };
  const s: any = new BotService({ from: () => b, rpc: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.cotizarPedido = jest.fn(async () => ({ renglones, total: renglones.filter((r) => r.alcanzaElStock !== false).reduce((t, r) => t + r.subtotal, 0), hayFaltantes: renglones.some((r) => r.alcanzaElStock === false), sucursalId: 'suc-1' }));
  return { s, inserts };
}
const r = (nombre: string, cant: number, precio: number, extra: any = {}) => ({ sku: nombre, nombre, cantidad: cant, precioUnitario: precio, subtotal: cant * precio, renglon: `${cant} × $${precio} c/u = $${cant * precio}`, alcanzaElStock: true, presentacion: 'catalogada', ...extra });

describe('el resumen no pierde lo que el cliente vio con precio', () => {
  it('lo «a verificar» (Criollitas pack x 3) entra; afuera solo lo que no tiene stock', async () => {
    const { s } = armar([r('Yerba Mañanita 1 kg', 1, 7200), r('Galletitas Criollitas pack x 3', 1, 2600, { presentacion: 'requiere_verificacion' }), r('Café La Planta de Cabrales 250 g', 1, 9000, { alcanzaElStock: false })]);
    const out = await s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'Leandro', items: [{ sku: 'a', cantidad: 1 }], notas: 'Paga en efectivo' }, undefined, undefined, undefined, ['El café La Planta de Cabrales no lo tengo disponible ahora.']);
    expect(out.renglones.map((x: any) => x.nombre)).toEqual(['Yerba Mañanita 1 kg', 'Galletitas Criollitas pack x 3']);
    expect(out.total).toBe(9800);
    // ya se le había dicho lo del café: no se repite; y la forma de pago no se le repite al cliente
    expect(out.resumen).not.toMatch(/Cabrales/);
    expect(out.resumen).not.toMatch(/Paga en efectivo/);
  });
  it('lo que queda afuera y no se le dijo, se dice una vez en el resumen', async () => {
    const { s } = armar([r('Yerba Mañanita 1 kg', 1, 7200), r('Té verde Twinings x 10', 2, 7200, { alcanzaElStock: false })]);
    const out = await s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'Leandro', items: [{ sku: 'a', cantidad: 1 }] }, undefined, undefined, undefined, ['Te paso la lista.']);
    expect(out.resumen).toMatch(/Sin: Té verde Twinings x 10 \(no hay ahora\)\./);
  });
  it('el nombre cierra aunque la lista que vio tuviera además un renglón sin stock', () => {
    const vista = '• Yerba Mañanita 1 kg — 1 × $7200 c/u = $7200\n• Té verde Twinings x 10 — 2 × $7200 c/u = $14400 (no lo tengo disponible ahora)\n\nTotal: $7.200\n¿A nombre de quién lo preparo?';
    const ok = cierraConElDato({ textoCliente: 'Leandro Alonso', ultimoBot: vista, ultimosBot: [vista], cotizacion: { total: 7200, renglones: [{ nombre: 'Yerba Mañanita 1 kg', renglon: '1 × $7200 c/u = $7200' }], tipo: 'pickup', nombre: 'Leandro Alonso' } });
    expect(ok.ok).toBe(true);
  });
});
