// Los candados de bot.service.ts, de punta a punta en charla() (9/10/2026). El
// 9/10 las funciones existían pero no estaban conectadas: estas pruebas pasan por
// el bot entero para que eso no vuelva a pasar.
import { appendFileSync } from 'fs';
import { BotService } from './bot.service';

process.env.ANTHROPIC_API_KEY ??= 'test';

type Ctx = { filtros: any[]; columnas?: string; fila?: any };
type Escritura = { tabla: string; op: string; fila: any; filtros: any[] };

function cumple(fila: any, filtros: any[]): boolean {
  return filtros.every(([k, col, val]) => {
    if (k === 'eq') return col in fila && String(fila[col]) === String(val);
    if (k === 'neq') return String(fila[col]) !== String(val);
    if (k === 'is') return (fila[col] ?? null) === val;
    if (k === 'gte') return col in fila && String(fila[col]) >= String(val);
    if (k === 'lte') return col in fila && String(fila[col]) <= String(val);
    return true;
  });
}

function baseFalsa(config: Record<string, Record<string, any>> = {}) {
  const escrituras: Escritura[] = [];
  const db: any = {
    escrituras,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    from(tabla: string) {
      let op = 'select';
      const ctx: Ctx = { filtros: [] };
      const res = () => {
        const out = config[tabla]?.[op] ?? { data: null, error: null };
        return op === 'select' && Array.isArray(out.data) ? { ...out, data: out.data.filter((f: any) => cumple(f, ctx.filtros)) } : out;
      };
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (k === 'select') return (columnas?: string) => { if (op === 'select') ctx.columnas = columnas; return b; };
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) {
            return (fila: any) => { op = String(k); ctx.fila = fila; escrituras.push({ tabla, op, fila, filtros: ctx.filtros }); return b; };
          }
          return (...args: any[]) => { ctx.filtros.push([String(k), ...args]); return b; };
        },
      });
      return b;
    },
  };
  return db;
}

const TEL = '5491155501234';
const CFG = { derivar_pagos_a: '5491125213601', avisar_proveedores_a: null, bot_activo: true };
const conv = (mensajes: any[]) => ({ data: { mensajes, bot_activo: true, actualizado_en: new Date(Date.now() - 60_000).toISOString(), importes_verificados: [] }, error: null });
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 11000, cache_creation_input_tokens: 300 };
// las formas de Opus 5.5
const pensar = (firma: string) => ({ type: 'thinking', thinking: '', signature: firma });
const herramienta = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const conHerramientas = (...content: any[]) => ({ stop_reason: 'tool_use', content, usage });
const final = (firma: string, t: string) => ({ stop_reason: 'end_turn', content: [pensar(firma), { type: 'text', text: t }], usage });
const insertsDe = (db: any, tabla: string) => db.escrituras.filter((e: Escritura) => e.tabla === tabla && e.op === 'insert');

function servicio(db: any, ...principal: any[]) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.identificarCliente = jest.fn(async () => ({ existe: false }));
  s.enviarPorWhatsapp = jest.fn(async () => ({ enviado: true, id: 'W-1' }));
  s.respondeRegistrar = jest.fn(async () => null);
  s.buscarProductos = jest.fn(async () => ({ items: [{ sku: 'F1', nombre: 'Fernet Branca 750 cc', precio: 20500, disponible: true }] }));
  s.estadoAtencion = jest.fn(async () => ({ abierto: true, cierra: '21:00' }));
  // cada llamada se guarda como la vio la API (copia: la charla sigue creciendo)
  const llamadas: any[] = [];
  const create = jest.fn(async (p: any) => {
    llamadas.push(JSON.parse(JSON.stringify(p)));
    if (process.env.ODB_VOLCAR_TURNO && p.model !== 'claude-haiku-4-5') appendFileSync(process.env.ODB_VOLCAR_TURNO, JSON.stringify(p) + '\n');
    if (p.model === 'claude-haiku-4-5') return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sin_responder":[]}' }], usage };
    const siguiente = principal.shift();
    return typeof siguiente === 'function' ? siguiente(p) : siguiente ?? final('fin', 'Listo.');
  });
  s.claude = { messages: { create } };
  return { s, llamadas, create };
}


const COT = {
  renglones: [
    { sku: 'C1', nombre: 'Coca Cola Zero 1,75 L', cantidad: 8, renglon: '8 × $4.700 c/u = $37.600', subtotal: 37600 },
    { sku: 'CH', nombre: 'Chandon Extra Brut 750 cc', cantidad: 2, renglon: '2 × $22.700 c/u = $45.400', subtotal: 45400, subtotalEfectivo: 40860 },
    { sku: 'AB', nombre: 'Absolut vodka clásico 750 cc', cantidad: 1, renglon: '1 × $33.500 c/u = $33.500', subtotal: 33500, subtotalEfectivo: 30150 },
  ],
  total: 116500,
  totalEfectivo: 104510,
};
const ANTES = 'Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. ¿Lo retirás en la sucursal Saint Thomas o te lo enviamos?';
const HIST = [
  { role: 'user', content: '8 coca zero, 2 chandon y la sal. Está completo' },
  { role: 'assistant', content: '• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600\n• Chandon Extra Brut 750 cc — 2 × $22.700 c/u = $45.400\nTotal: $83.000\n¿Lo retirás o te lo enviamos?' },
  { role: 'user', content: 'Te hago un cambio me podrás sacar la sal y agregar un absolut por favor?' },
  { role: 'assistant', content: ANTES },
];

describe('candados conectados al bot', () => {
  it('14:51 «me pasás la cuenta final?»: aunque el modelo conteste la línea del cambio con el total, sale la lista completa y sin la oración repetida', async () => {
    const db = baseFalsa({ bot_conversaciones: { select: conv(HIST) }, lineas_whatsapp: { select: { data: CFG, error: null } } });
    const { s } = servicio(db,
      conHerramientas(pensar('a'), herramienta('t1', 'cotizar_pedido', { items: [{ sku: 'C1', cantidad: 8 }, { sku: 'CH', cantidad: 2 }, { sku: 'AB', cantidad: 1 }] })),
      final('b', 'Saco la sal y sumo 1 × Absolut vodka clásico: $33.500, o $30.150 en efectivo o transferencia. Total: $116.500, o $104.510 en efectivo o transferencia. ¿A nombre de quién lo preparo?'),
      // el control de repeticiones que ya existía le pide reescribir: vuelve el total suelto, sin la lista
      final('c', 'Total: $116.500, o $104.510 en efectivo o transferencia. ¿A nombre de quién lo preparo?'),
    );
    s.cotizarPedido = jest.fn(async () => COT);
    const r = await s.charla({ linea: 'pedidos', telefono: TEL, mensaje: 'Me pasas la cuenta final ? Retiro en sucursal' });
    expect(r.respuesta).toContain('• Coca Cola Zero 1,75 L — 8 × $4.700 c/u = $37.600');
    expect(r.respuesta).toContain('• Absolut vodka clásico 750 cc — 1 × $33.500 c/u = $33.500');
    expect(r.respuesta).toMatch(/Total: \$116\.500/);
    expect(r.respuesta).toMatch(/¿A nombre de quién lo preparo\?/);
    expect(r.respuesta).not.toContain('Saco la sal y sumo');
  });
});
