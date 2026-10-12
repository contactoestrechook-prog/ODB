// Quién lo pasa a buscar (Leandro, 12/10/2026): «siempre que piden picadas o pedidos a
// retirar por el local necesitamos el nombre de quien retira».
import { BotService } from './bot.service';
import { cierraConElDato } from './cierre-con-dato';
import { leerResumenDePedido } from '../comun/cartel-pedido';

process.env.ANTHROPIC_API_KEY ??= 'test';

function armar() {
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
    renglones: [{ sku: 'picada', nombre: 'Combo Picada Box', cantidad: 3, precioUnitario: 44500, subtotal: 133500, renglon: '3 × $44.500 c/u = $133.500', alcanzaElStock: true, presentacion: 'catalogada' }],
    total: 133500,
    hayFaltantes: false,
    sucursalId: 'suc-1',
  }));
  return { s, inserts };
}

describe('retiro: el nombre de quien lo pasa a buscar', () => {
  it('sin nombre no se arma el resumen: se pregunta solo eso', async () => {
    const { s, inserts } = armar();
    await expect(s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: '', items: [{ sku: 'picada', cantidad: 3 }] }))
      .rejects.toThrow(/¿A nombre de quién lo retiran\?/);
    expect(inserts).toHaveLength(0);
  });

  it('el relleno del modelo no cuenta como nombre', async () => {
    const { s } = armar();
    await expect(s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'N/A', items: [{ sku: 'picada', cantidad: 3 }] }))
      .rejects.toThrow(/falta el nombre de quien lo pasa a buscar/);
  });

  it('con nombre, el resumen dice quién retira y la cotización lo guarda', async () => {
    const { s, inserts } = armar();
    const out = await s.prepararPedido('111', 'pedidos', { tipo: 'pickup', nombre: 'Juan Pérez', items: [{ sku: 'picada', cantidad: 3 }] });
    expect(out.resumen).toMatch(/^Retiro en la sucursal Saint Thomas\. Retira Juan Pérez\.$/m);
    expect(inserts[0].nombre).toBe('Juan Pérez');
  });

  it('la placa lee «Retira» como lee «Recibe»', () => {
    const r = leerResumenDePedido('• Combo Picada Box — 3 × $44.500 c/u = $133.500\nTotal: $133.500\nRetiro en la sucursal Saint Thomas. Retira Juan Pérez.\n¿Lo confirmo?')!;
    expect(r.entrega).toEqual({ titulo: 'Retiro en la sucursal Saint Thomas', detalle: 'Castex 3601, Canning · retira Juan Pérez' });
    // el resumen de antes, sin nombre, se sigue leyendo igual
    expect(leerResumenDePedido('• Coca Cola 1.75l — 4 × $4.700 c/u = $18.800\nTotal: $18.800\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?')!.entrega?.detalle).toBe('Castex 3601, Canning');
  });

  it('vio la lista con el total, el bot pidió solo el nombre y lo dio: confirma', () => {
    const lista = '• Combo Picada Box — 3 × $44.500 c/u = $133.500\nTotal: $133.500';
    const r = cierraConElDato({
      textoCliente: 'Juan Pérez',
      ultimoBot: '¿A nombre de quién lo retiran?',
      ultimosBot: [lista],
      cotizacion: { total: 133500, tipo: 'pickup', nombre: 'Juan Pérez', direccion: null, renglones: [{ nombre: 'Combo Picada Box', renglon: '3 × $44.500 c/u = $133.500' }] } as any,
    });
    expect(r).toEqual({ ok: true, motivo: expect.any(String) });
  });
});
