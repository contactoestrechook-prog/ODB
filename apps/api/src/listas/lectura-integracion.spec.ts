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

// El tamaño del esquema del lector con el que lee bien (f4e5fe0, 5/11/2026). No se agranda.
const CAMPOS_DEL_RENGLON = 15;
const PROPIEDADES_DEL_ESQUEMA = 51;

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

  // 5/11/2026: con 11 propiedades opcionales en el renglón el lector dejó de
  // leer TODAS las facturas (el mismo PDF que el 4/11 a las 17:39 salió en 55
  // segundos, al día siguiente falló en 3). Con 10 andaba; el tope queda en las
  // 9 que funcionaron durante meses. Una propiedad nueva entra como obligatoria.
  it('el renglón no suma propiedades opcionales', async () => {
    mockDatos = { items: [{ codigo: null, descripcion: 'Agua pack x 6', unidadesPorBulto: 6, cantidad: 1, precio: 100, importe: 100, devueltoAMano: false, recibidoAMano: 0 }] };
    const s = new ListasService(baseSimulada() as any);
    (s as any).sugerirMatchConIA = async () => new Map();
    const result = await s.analizarComprobanteFoto({ buffer: Buffer.from('mock'), mimetype: 'application/pdf', originalname: 'mock.pdf' } as any);
    const renglon = mockRequest.output_config.format.schema.properties.items.items;
    const opcionales = Object.keys(renglon.properties).filter((k) => !renglon.required.includes(k));
    expect(opcionales.length).toBeLessThanOrEqual(9);
    expect(renglon.required).toEqual(expect.arrayContaining(['devueltoAMano', 'recibidoAMano']));
    // EL ESQUEMA NO CRECE (5/11/2026): cuatro campos más en el pie —obligatorios,
    // sin uniones— hicieron que la IA rechazara el pedido y el lector dejó de leer
    // todas las facturas durante 3 minutos. Las pruebas no lo ven (la IA está
    // simulada): este candado sí. Un dato nuevo viaja como texto en un campo que
    // ya existe y se separa en código (compras/percepciones-impresas.ts), o se
    // prueba ANTES en el servidor con una lectura real.
    const esquema = mockRequest.output_config.format.schema;
    expect(Object.keys(esquema.properties.impuestos.properties)).toHaveLength(9);
    expect(esquema.properties.impuestos.required).toHaveLength(9);
    expect(Object.keys(renglon.properties).length).toBeLessThanOrEqual(CAMPOS_DEL_RENGLON);
    let propiedades = 0;
    const contar = (v: any) => { if (!v || typeof v !== 'object') return; if (v.properties) propiedades += Object.keys(v.properties).length; Object.values(v).forEach(contar); };
    contar(esquema);
    expect(propiedades).toBeLessThanOrEqual(PROPIEDADES_DEL_ESQUEMA);
    // El valor neutro no se lee como una devolución ni como una entrega parcial.
    const row = result.items[0] as any;
    expect(row.devueltoAMano).toBe(false);
    expect(row.recibidoAMano).toBeNull();
  });
});
