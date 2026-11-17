import { ListasService } from './listas.service';

let mockDatos: any;
let mockRequest: any;
// todos los pedidos a la IA, en orden; mockDatos puede ser una función (n.º de pedido → respuesta)
let mockPedidos: any[] = [];
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {
  messages = { stream: (request: any) => {
    mockRequest = request;
    mockPedidos.push(request);
    const n = mockPedidos.length;
    return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(typeof mockDatos === 'function' ? mockDatos(n) : mockDatos) }], usage: {} }) };
  } };
} }));

/** Una base que contesta por tabla; lo que no se nombra vuelve vacío. */
function baseCon(tablas: Record<string, any[]>) {
  const consulta = (filas: any[]) => {
    const b: any = new Proxy({}, { get: (_t, k) => {
      if (k === 'then') return (ok: any, err: any) => Promise.resolve({ data: filas, error: null }).then(ok, err);
      if (k === 'single' || k === 'maybeSingle') return async () => ({ data: null, error: null });
      return () => b;
    } });
    return b;
  };
  return {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    rpc: () => consulta([]),
    from: (tabla: string) => consulta(tablas[tabla] ?? []),
  };
}

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

  // 17/11/2026, Leandro: «sí, ignorarlo siempre». Lo escrito, tachado o pintado a
  // mano sobre el papel no cambia la carga, salvo que la persona lo pida.
  it('lo agregado a mano no cambia la carga, aunque el lector lo marque', async () => {
    const pintado = { items: [
      { codigo: null, descripcion: 'Mortadela con pistacho', unidadesPorBulto: 0, cantidad: 1, precio: 100, importe: 100, devueltoAMano: true, recibidoAMano: 0, impuestoInternoUnitario: 0 },
      { codigo: null, descripcion: 'Pronto Manzana x 8', unidadesPorBulto: 8, cantidad: 36, precio: 10, importe: 360, devueltoAMano: false, recibidoAMano: 28, impuestoInternoUnitario: 0 },
    ] };
    mockDatos = JSON.parse(JSON.stringify(pintado));
    const s = new ListasService(baseSimulada() as any);
    (s as any).sugerirMatchConIA = async () => new Map();
    const archivo = { buffer: Buffer.from('mock'), mimetype: 'application/pdf', originalname: 'mock.pdf' } as any;
    const primera = await s.analizarComprobanteFoto(archivo);
    expect((primera.items as any[]).map((i) => [i.devueltoAMano, i.recibidoAMano])).toEqual([[false, null], [false, null]]);
    // las instrucciones del lector lo dicen, y ya no mandan a marcar lo pintado como devolución
    const instrucciones = String(mockRequest.system?.[0]?.text ?? '');
    expect(instrucciones).toContain('LO AGREGADO A MANO NO CAMBIA LA CARGA');
    expect(instrucciones).not.toContain('es una devolución → devueltoAMano = true, sin preguntar');
    // una aclaración que no habla de eso no lo habilita
    mockDatos = JSON.parse(JSON.stringify(pintado));
    const otraCosa = await s.analizarComprobanteFoto(archivo, 'el precio es por bulto');
    expect((otraCosa.items as any[]).map((i) => [i.devueltoAMano, i.recibidoAMano])).toEqual([[false, null], [false, null]]);
    // la persona lo pide al volver a leer: ahí sí vale lo que marcó el lector
    mockDatos = JSON.parse(JSON.stringify(pintado));
    const pedido = await s.analizarComprobanteFoto(archivo, 'lo pintado se devolvió y del Pronto ingresaron 3 bultos');
    expect((pedido.items as any[]).map((i) => [i.devueltoAMano, i.recibidoAMano])).toEqual([[true, null], [false, 28]]);
  });

  // 17/11/2026: las reglas del proveedor solo llegaban al lector si se leía el QR
  // de ARCA (17 de 31 lecturas). Sin QR, el proveedor se sabe después de leer: si
  // tiene reglas, el comprobante se lee otra vez con ellas.
  describe('las reglas llegan al lector aunque no se lea el QR', () => {
    const FARINA = { id: 'p-farina', razon_social: 'La Farina', cuit: '30565574759' };
    const REGLA = 'En los renglones de figacitas y figazas «x N unidades», la Cantidad del papel son paquetes que entran al stock tal cual.';
    const leido = (dudas: string[]) => ({
      proveedor: { nombre: 'LA FARINA', cuit: '30565574759' },
      items: [{ codigo: null, descripcion: 'Figacita de manteca x 9 unidades', unidadesPorBulto: 9, cantidad: 24, precio: 3490, importe: 83760, devueltoAMano: false, recibidoAMano: 0, impuestoInternoUnitario: 0 }],
      dudas: dudas.map((pregunta) => ({ referencia: null, pregunta })),
    });
    const archivo = { buffer: Buffer.from('mock'), mimetype: 'application/pdf', originalname: 'mock.pdf' } as any;
    const textoDelPedido = (r: any) => String((r.messages[0].content as any[]).find((c) => c.type === 'text')?.text ?? '');
    const lector = (tablas: Record<string, any[]>) => {
      const s = new ListasService(baseCon(tablas) as any);
      (s as any).sugerirMatchConIA = async () => new Map();
      return s;
    };
    beforeEach(() => { mockPedidos = []; delete process.env.ODB_RELEER_CON_REGLAS; });

    it('proveedor reconocido por el CUIT leído y con reglas: se lee dos veces y queda la segunda', async () => {
      mockDatos = (n: number) => leido(n === 1 ? ['¿La cantidad 24 son paquetes o hay que multiplicar por 9?'] : []);
      const r: any = await lector({ proveedores: [FARINA], proveedor_reglas_lectura: [{ regla: REGLA }] }).analizarComprobanteFoto(archivo);
      expect(mockPedidos).toHaveLength(2);
      // la primera va sin reglas; la segunda las lleva, con el emisor ya identificado
      expect(textoDelPedido(mockPedidos[0])).not.toContain('figacitas y figazas');
      expect(textoDelPedido(mockPedidos[1])).toContain(REGLA);
      expect(textoDelPedido(mockPedidos[1])).toContain('El emisor de este comprobante ya se identificó: La Farina');
      expect(textoDelPedido(mockPedidos[1])).toContain('NO dejes dudas sobre lo que ya contestan');
      expect(r.releidaConReglas).toBe(true);
      expect(r.reglasAplicadas).toBe(1);
      expect(r.proveedor.match.id).toBe('p-farina');
      // la duda que la regla ya contesta no vuelve
      expect((r.dudas as any[]).map((d) => d.pregunta).join(' ')).not.toContain('multiplicar por 9');
      expect(r.items).toHaveLength(1);
    });

    it('si la segunda lectura falla o vuelve vacía, queda la primera', async () => {
      mockDatos = (n: number) => { if (n >= 2) throw new Error('se cortó'); return leido(['duda de la primera']); };
      const r: any = await lector({ proveedores: [FARINA], proveedor_reglas_lectura: [{ regla: REGLA }] }).analizarComprobanteFoto(archivo);
      expect(r.releidaConReglas).toBe(false);
      expect(r.reglasAplicadas).toBe(0);
      expect(r.items).toHaveLength(1);
      expect((r.dudas as any[]).map((d) => d.pregunta)).toContain('duda de la primera');
      mockPedidos = [];
      mockDatos = (n: number) => (n === 1 ? leido(['duda de la primera']) : { ...leido([]), items: [] });
      const vacia: any = await lector({ proveedores: [FARINA], proveedor_reglas_lectura: [{ regla: REGLA }] }).analizarComprobanteFoto(archivo);
      expect(mockPedidos).toHaveLength(2);
      expect(vacia.releidaConReglas).toBe(false);
      expect(vacia.items).toHaveLength(1);
    });

    it('sin reglas, sin proveedor o con el interruptor apagado se lee una sola vez', async () => {
      mockDatos = leido([]);
      const sinReglas: any = await lector({ proveedores: [FARINA] }).analizarComprobanteFoto(archivo);
      expect(mockPedidos).toHaveLength(1);
      expect(sinReglas.releidaConReglas).toBe(false);
      mockPedidos = [];
      await lector({ proveedor_reglas_lectura: [{ regla: REGLA }] }).analizarComprobanteFoto(archivo);
      expect(mockPedidos).toHaveLength(1);
      mockPedidos = [];
      process.env.ODB_RELEER_CON_REGLAS = '0';
      const apagado: any = await lector({ proveedores: [FARINA], proveedor_reglas_lectura: [{ regla: REGLA }] }).analizarComprobanteFoto(archivo);
      expect(mockPedidos).toHaveLength(1);
      expect(apagado.releidaConReglas).toBe(false);
    });
  });
});

