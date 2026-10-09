// El dato que faltaba confirma, de punta a punta en la herramienta
// preparar_pedido (9/10/2026): la charla de Leandro de las 17:02 y lo que NO
// tiene que crear pedido. Misma base falsa por operación que pago-confirma.spec.ts.
import { BotService } from './bot.service';

type Consulta = { op: string; terminal: string; filtros: any[][] };
function dbPorOperacion(config: Record<string, any> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const filtros: any[][] = [];
      const res = (terminal: string) => {
        const c = config[tabla];
        const q: Consulta = { op, terminal, filtros };
        const r = typeof c === 'function' ? c(q) : typeof c?.[op] === 'function' ? c[op](q) : c?.[op];
        return r ?? { data: null, error: null };
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res('then')).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res(String(k));
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op: String(k), fila }); return b; };
          return (...args: any[]) => { filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '104570256634038';
const renglones = [
  { nombre: 'Coca Cola Zero x1.75L', renglon: '6 × $4.700 c/u = $28.200' },
  { nombre: 'Chandon Extra Brut', renglon: '2 × $22.700 c/u = $45.400' },
  { nombre: 'Patitas de Pollo Granja del Sol x 400 gr', renglon: '1 × $10.800 c/u = $10.800' },
  { nombre: 'Azucar Ledesma Comun x 1 kg', renglon: '1 × $2.300 c/u = $2.300' },
  { nombre: 'KO agua x 1L', renglon: '4 × $2.000 c/u = $8.000' },
  { nombre: 'Absolut', renglon: '1 × $33.500 c/u = $33.500' },
];
const VISTO = [
  'Sumo 2 aguas y saco 2 Coca Cola Zero.',
  ...renglones.map((r) => `• ${r.nombre} — ${r.renglon}`),
  '',
  '*Total: $128.200*, o $120.310 en efectivo o transferencia. Es para retirar en la sucursal Saint Thomas. ¿A nombre de quién lo preparo?',
].join('\n');
const RESUMEN = `${renglones.map((r) => `• ${r.nombre} — ${r.renglon}`).join('\n')}\nTotal: $128.200\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?`;
const COT = { id: 'cot-dato', total: 128200, tipo: 'pickup', nombre: 'Leandro', direccion: null, notas: '', resumen: RESUMEN, creada_en: new Date().toISOString(), confirmada_en: null, pedido_id: null, items: [] };
const tu = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });

function armar(o: { confirmadoHacePoco?: boolean; pagosAbiertos?: any[] } = {}) {
  const db = dbPorOperacion({
    bot_cotizaciones: { select: (q: Consulta) => (q.filtros.some((f) => f[0] === 'gte') ? { data: o.confirmadoHacePoco ? { id: 'otra' } : null } : { data: COT }) },
    bot_pagos_en_confirmacion: { select: { data: o.pagosAbiertos ?? [] } },
  });
  db.rpc.mockImplementation(async (nombre: string) => (nombre === 'confirmar_cotizacion_bot' ? { data: 'pedido-1', error: null } : { data: null, error: null }));
  const pedidos = { obtener: jest.fn(async () => ({ qr_retiro: 'PICKUP-0C1E9A12B3D4', total: 128200, estado: 'recibido' })) };
  const s = new BotService(db, pedidos as any, {} as any, {} as any, {} as any);
  jest.spyOn(s, 'prepararPedido').mockResolvedValue({ cotizacionId: 'cot-dato', resumen: RESUMEN, total: 128200, renglones } as any);
  return { s, db };
}
const ctx = (textoCliente: string, extra: any = {}) => ({
  ultimoBot: VISTO, ultimosBot: [VISTO], ultimosCliente: ['¿Le podés sumar dos botellas de agua más y sacar dos de Coca?', textoCliente],
  textoCliente, fallos: new Map<string, number>(), fija: {} as any, salidas: [], ...extra,
});
const preparar = tu('p', 'preparar_pedido', { tipo: 'pickup', nombre: 'Leandro', direccion: '', items: [], notas: '', entrega_fecha: '', entrega_franja: '' });
const llamadasDato = (db: any) => db.rpc.mock.calls.filter((c: any[]) => c[0] === 'confirmar_cotizacion_bot' && c[1]?.p_modo === 'dato');

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

describe('preparar_pedido con el dato que faltaba', () => {
  it('17:02 «A nombre de leandro»: el pedido queda confirmado en el acto, sin otro «¿Lo confirmo?»', async () => {
    const { s, db } = armar();
    const c = ctx('A nombre de leandro');
    await (s as any).ejecutarHerramienta(preparar, TEL, 'pedidos', c);
    expect(llamadasDato(db)).toHaveLength(1);
    expect(llamadasDato(db)[0][1]).toMatchObject({ p_id: 'cot-dato', p_confirmacion: 'A nombre de leandro', p_modo: 'dato' });
    expect(c.fallos.get('__pedido_creado__')).toBe(1);
    expect(c.fija.operacion).toBe(true);
    expect(c.fija.texto).toMatch(/^Pedido PICKUP-0C1E9A12B3D4 confirmado a nombre de Leandro\. Total: \$128\.200\./);
    expect(c.fija.texto).not.toMatch(/¿Lo confirmo\?/);
  });

  it('con algo más en el mensaje («Leandro y 2 hielos»): no se crea, va el resumen con «¿Lo confirmo?»', async () => {
    const { s, db } = armar();
    const c = ctx('Leandro y 2 hielos');
    await (s as any).ejecutarHerramienta(preparar, TEL, 'pedidos', c);
    expect(llamadasDato(db)).toHaveLength(0);
    expect(c.fallos.get('__pedido_creado__')).toBeUndefined();
    expect(c.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });

  it('con un archivo en el turno, un comprobante abierto o un pedido confirmado hace poco: no se crea', async () => {
    for (const [o, extra] of [[{}, { archivo: { base64: 'x', mime: 'application/pdf' } }], [{ pagosAbiertos: [{ id: 'p1', monto: 128200, creado_en: new Date().toISOString() }] }, {}], [{ confirmadoHacePoco: true }, {}]] as const) {
      const { s, db } = armar(o as any);
      const c = ctx('Leandro', extra);
      await (s as any).ejecutarHerramienta(preparar, TEL, 'pedidos', c);
      expect(llamadasDato(db)).toHaveLength(0);
    }
  });

  it('si la base lo rechaza, no rompe: queda el resumen con «¿Lo confirmo?»', async () => {
    const { s, db } = armar();
    db.rpc.mockImplementation(async () => ({ data: null, error: { message: 'El dato no confirma el pedido' } }));
    const c = ctx('Leandro');
    await (s as any).ejecutarHerramienta(preparar, TEL, 'pedidos', c);
    expect(c.fallos.get('__pedido_creado__')).toBeUndefined();
    expect(c.fija.texto).toMatch(/¿Lo confirmo\?$/);
  });
});
