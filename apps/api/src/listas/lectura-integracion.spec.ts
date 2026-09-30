import { ListasService } from './listas.service';

let mockDatos: any;
let mockRequest: any;
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {
  messages = { stream: (request: any) => {
    mockRequest = request;
    return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(mockDatos) }], usage: {} }) };
  } };
} }));

function baseSimulada() {
  return { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => {
    const b: any = {};
    for (const k of ['select', 'eq', 'in', 'ilike', 'limit']) b[k] = () => b;
    b.single = b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
    return b;
  } };
}

describe('lectura inicial y reapertura', () => {
  const anterior = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'mock'; });
  afterAll(() => { if (anterior === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = anterior; });
  it.each([{}, { cantidad: null, precio: null, importe: null }, { cantidad: 0, precio: 0, importe: 0 }])('no fabrica valores para %p', async (valores) => {
    mockDatos = { items: [{ codigo: null, descripcion: 'Agua pack x 6', unidadesPorBulto: 6, ...valores }] };
    const s = new ListasService(baseSimulada() as any);
    (s as any).sugerirMatchConIA = async () => new Map();
    const result = await s.analizarComprobanteFoto({ buffer: Buffer.from('mock'), mimetype: 'application/pdf', originalname: 'mock.pdf' } as any);
    const row = result.items[0] as any;
    expect(row.cantidad).toBe(valores.cantidad ?? null);
    expect(row.precio).toBe(valores.precio ?? null);
    expect(row.importe).toBe(valores.importe ?? null);
    expect(row.interpretado.decision).toBe('incompleto');
    const reabierto = await (s as any).actualizarLectura(JSON.parse(JSON.stringify(result)));
    expect(reabierto.items[0].interpretado).toEqual(row.interpretado);
    // El proveedor limita a 16 las propiedades con tipos unión.
    let unions = 0;
    const visit = (v: any) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v.type)) unions++; Object.values(v).forEach(visit); };
    visit(mockRequest.output_config.format.schema);
    expect(unions).toBeLessThanOrEqual(16);
    expect(mockRequest.output_config.format.schema.properties.items.items.required).not.toContain('cantidad');
  });
});
