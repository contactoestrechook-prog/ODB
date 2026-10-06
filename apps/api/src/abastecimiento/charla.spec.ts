// La charla con el agente de compras (1/10/2026): lo que la revisión encontró
// antes de publicar la nota de pedido para tildar. Anthropic simulado: acá no
// se gasta un peso ni se habla con nadie.
const mockRespuestas: any[] = [];
const mockLlamadas: any[] = [];
const mockPedidos: any[] = [];
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      stream: (args: any) => {
        mockLlamadas.push(JSON.parse(JSON.stringify(args.messages)));
        mockPedidos.push(JSON.parse(JSON.stringify({ ...args, messages: undefined })));
        const r = mockRespuestas.shift();
        return { finalMessage: async () => { if (r instanceof Error) throw r; return r; } };
      },
    },
  })),
}));

import { AbastecimientoService } from './abastecimiento.service';

const uso = { input_tokens: 10, output_tokens: 10 };
const texto = (t: string) => ({ type: 'text', text: t });
const herramienta = (id: string, input: any) => ({ type: 'tool_use', id, name: 'proponer_compra', input });

function servicio() {
  const s = new AbastecimientoService({} as any, {} as any);
  jest.spyOn(s, 'resumen').mockResolvedValue({} as any);
  jest.spyOn(s, 'proponerCompra').mockImplementation(async (input: any) => ({
    propuesta: { clave: 'pv1:st', proveedor: 'Luvik', items: input.items } as any,
    resultado: { mostrada: true },
  }));
  return s;
}

beforeEach(() => {
  mockRespuestas.length = 0;
  mockLlamadas.length = 0;
  mockPedidos.length = 0;
  process.env.ANTHROPIC_API_KEY = 'prueba';
});

describe('abastecimiento en Opus 5.5 (6/10/2026)', () => {
  it('lo escrito entre herramientas viene vacío (en el razonamiento): vale la explicación del último mensaje', async () => {
    mockRespuestas.push(
      { stop_reason: 'tool_use', usage: uso, content: [{ type: 'thinking', thinking: '', signature: 'a' }, herramienta('a', { items: [{ sku: 'L1', cantidad: 1 }] })] },
      { stop_reason: 'end_turn', usage: uso, content: [{ type: 'thinking', thinking: '', signature: 'b' }, texto('Lo urgente es Luvik: el plazo es provisorio.')] },
    );
    const r: any = await servicio().charlar([{ rol: 'usuario', texto: '¿qué le pido a Luvik?' }]);
    expect(r.respuesta).toBe('Lo urgente es Luvik: el plazo es provisorio.');
    // el razonamiento de la primera vuelta vuelve tal cual en la segunda
    expect(mockLlamadas[1][1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'a' });
  });

  it('va a Opus 5.5 con razonamiento, esfuerzo medium, caché sobre la charla y el prompt pide la explicación al final', async () => {
    mockRespuestas.push({ stop_reason: 'end_turn', usage: uso, content: [texto('ok')] });
    await servicio().charlar([{ rol: 'usuario', texto: 'hola' }]);
    const p = mockPedidos[0];
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.output_config).toEqual({ effort: 'medium' });
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.tool_choice).toBeUndefined();
    expect(p.system[0].text).toMatch(/Lo que el comprador lee es tu ÚLTIMO mensaje/);
  });
});

describe('abastecimiento: la charla', () => {
  it('una sola nota por proveedor y sucursal: la segunda reemplaza a la primera', async () => {
    mockRespuestas.push(
      { stop_reason: 'tool_use', usage: uso, content: [texto('Lo urgente es Luvik.'), herramienta('a', { items: [{ sku: 'L1', cantidad: 1 }] })] },
      { stop_reason: 'tool_use', usage: uso, content: [herramienta('b', { items: [{ sku: 'L1', cantidad: 2 }, { sku: 'L2', cantidad: 3 }] })] },
      { stop_reason: 'end_turn', usage: uso, content: [] },
    );
    const r: any = await servicio().charlar([{ rol: 'usuario', texto: '¿qué le pido a Luvik?' }]);
    expect(r.propuestas).toHaveLength(1);
    expect(r.propuestas[0].items).toHaveLength(2);
    // lo que escribió antes de llamar a la herramienta no se pierde
    expect(r.respuesta).toBe('Lo urgente es Luvik.');
  });

  it('si termina sin decir nada, no dice "Listo." a secas', async () => {
    mockRespuestas.push(
      { stop_reason: 'tool_use', usage: uso, content: [herramienta('a', { items: [{ sku: 'L1', cantidad: 1 }] })] },
      { stop_reason: 'end_turn', usage: uso, content: [] },
    );
    const r: any = await servicio().charlar([{ rol: 'usuario', texto: 'armame Luvik' }]);
    expect(r.respuesta).toMatch(/propuesta abajo para tildar/);
  });

  it('un corte a mitad de la charla devuelve lo que ya se armó en vez de un error', async () => {
    mockRespuestas.push(
      { stop_reason: 'tool_use', usage: uso, content: [herramienta('a', { items: [{ sku: 'L1', cantidad: 1 }] })] },
      new Error('overloaded'),
    );
    const r: any = await servicio().charlar([{ rol: 'usuario', texto: 'armame Luvik' }]);
    expect(r.propuestas).toHaveLength(1);
    expect(r.respuesta).toMatch(/Se me cortó/);
  });

  it('sin nada armado, el corte es un error que se entiende', async () => {
    mockRespuestas.push(new Error('overloaded'));
    await expect(servicio().charlar([{ rol: 'usuario', texto: 'hola' }])).rejects.toThrow(/no pudo contestar/);
  });

  it('el historial siempre arranca con el comprador (la pregunta 11 daba error)', async () => {
    mockRespuestas.push({ stop_reason: 'end_turn', usage: uso, content: [texto('ok')] });
    const mensajes = Array.from({ length: 21 }, (_, i) => ({ rol: (i % 2 === 0 ? 'usuario' : 'asistente') as any, texto: `m${i}` }));
    await servicio().charlar(mensajes);
    expect(mockLlamadas[0][0].role).toBe('user');
    expect(mockLlamadas[0]).toHaveLength(19);
  });
});
