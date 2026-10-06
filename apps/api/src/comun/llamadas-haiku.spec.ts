// LAS LLAMADAS A HAIKU 4.5 TAMBIÉN PIENSAN (regla fija de Leandro, 9/9/2026:
// ninguna llamada a Claude sin razonamiento; revisión del 6/10/2026). Iban sin
// él: la lectura del pedido por WhatsApp, la lista del comparador, los catálogos
// en texto, el agente de catálogo (tareas y enriquecedor), la nota de cata y el
// control de calidad de las fotos. Haiku 4.5 no tiene el adaptativo: van con el
// presupuesto mínimo (1024) y el tope por encima, con lugar para la respuesta.
// Con el SDK simulado: acá no se llama a la API.
const mockCola: any[] = [];
const mockPedidos: any[] = [];
const mockResponder = (p: any) => {
  mockPedidos.push(JSON.parse(JSON.stringify(p)));
  return mockCola.shift();
};
jest.mock('@anthropic-ai/sdk', () => {
  const Clase: any = jest.fn().mockImplementation(() => ({
    messages: {
      create: async (p: any) => mockResponder(p),
      stream: (p: any) => ({ finalMessage: async () => mockResponder(p) }),
    },
  }));
  Clase.APIError = class extends Error {};
  return { __esModule: true, default: Clase };
});

import { ListasService } from '../listas/listas.service';
import { ComparadorService } from '../comparador/comparador.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { AgenteService } from '../agente/agente.service';
import { CatalogoService } from '../catalogo/catalogo.service';
import { CalidadFotosService } from '../catalogo/calidad-fotos.service';
import { RAZONAMIENTO_HAIKU } from './modelos';

const uso = { input_tokens: 1, output_tokens: 1 };
const pensar = { type: 'thinking', thinking: '', signature: 'x' };
const conTexto = (t: string) => ({ stop_reason: 'end_turn', content: [pensar, { type: 'text', text: t }], usage: uso });

// una base que contesta lo mismo a cualquier consulta de una tabla
function baseFalsa(filas: Record<string, any> = {}) {
  const db: any = {
    from(tabla: string) {
      const res = () => ({ data: filas[tabla] ?? null, error: null });
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, err: any) => Promise.resolve(res()).then(ok, err);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          return () => b;
        },
      });
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({ download: async () => ({ data: { arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer }, error: null }) }),
    },
  };
  return db;
}

/** Haiku 4.5 con razonamiento: el presupuesto mínimo y el tope por encima, con lugar para contestar. */
function haikuConRazonamiento(p: any, respuesta = 400) {
  expect(p.model).toMatch(/^claude-haiku-4-5/);
  expect(p.thinking).toEqual(RAZONAMIENTO_HAIKU);
  expect(p.max_tokens).toBeGreaterThanOrEqual(RAZONAMIENTO_HAIKU.budget_tokens + respuesta);
}

beforeEach(() => {
  mockCola.length = 0;
  mockPedidos.length = 0;
  process.env.ANTHROPIC_API_KEY = 'prueba';
});

describe('Haiku 4.5 con razonamiento (regla del 9/9)', () => {
  it('el pedido por WhatsApp: se lee el texto, no el razonamiento', async () => {
    mockCola.push(conTexto('{"items":[{"name":"fernet","quantity":2}],"nombre":null,"notas":null}'));
    const s: any = new PedidosService({} as any, {} as any);
    expect((await s.parsearWhatsApp('2 fernet')).items).toEqual([{ name: 'fernet', quantity: 2 }]);
    haikuConRazonamiento(mockPedidos[0], 2048);
  });

  it('la lista del comparador', async () => {
    mockCola.push(conTexto('{"items":[{"codigo":null,"descripcion":"Malbec","presentacion":null,"costo":"1000"}]}'));
    const s: any = new ComparadorService({} as any);
    expect(await s.extraer('Malbec $1000')).toEqual([{ codigo: null, descripcion: 'Malbec', presentacion: null, costo: 1000 }]);
    haikuConRazonamiento(mockPedidos[0], 8000);
  });

  it('los catálogos en texto (listas)', async () => {
    mockCola.push(conTexto('{"items":[{"codigo":"A1","descripcion":"Vino","precio":1000}]}'));
    const s: any = new ListasService({} as any);
    expect(await s.extraerTextoConIA('=== PÁGINA 1 ===\nA1 Vino 1000')).toEqual([{ codigo: 'A1', descripcion: 'Vino', precio: 1000 }]);
    haikuConRazonamiento(mockPedidos[0], 8000);
  });

  it('el agente de catálogo: la tarea (con el razonamiento de vuelta en el ida y vuelta) y el enriquecedor', async () => {
    mockCola.push(conTexto('Listo, no había nada que cambiar.'));
    const tarea = new AgenteService(baseFalsa({ agente_tareas: { id: 1, estado: 'pendiente', descripcion: 'Revisá el SKU 1' } }) as any);
    expect((await tarea.ejecutar(1)).resultado).toBe('Listo, no había nada que cambiar.');
    haikuConRazonamiento(mockPedidos[0], 1024);

    mockCola.push(conTexto('[]'));
    const enr = new AgenteService(baseFalsa({ productos: [{ id: 'p1', sku: 'S1', nombre: 'Vino tinto 750', categoria_id: null }] }) as any);
    await enr.enriquecer({ limite: 1 });
    haikuConRazonamiento(mockPedidos[1], 2048);
  });

  it('la nota de cata', async () => {
    mockCola.push(conTexto('{"nota":"Frutado.","maridaje":"Carnes."}'));
    const s = new CatalogoService(baseFalsa({ productos: { id: 'p1', nombre: 'Malbec', es_alcohol: true } }) as any);
    expect(await s.notaCata('S1')).toEqual({ nota: 'Frutado.', maridaje: 'Carnes.' });
    haikuConRazonamiento(mockPedidos[0], 400);
  });

  it('el control de calidad de las fotos', async () => {
    mockCola.push(conTexto('{"sirve": true, "motivo": "fondo liso"}'));
    const s: any = new CalidadFotosService(baseFalsa() as any, {} as any);
    expect(await s.mirar('S1')).toEqual({ sirve: true, motivo: 'fondo liso' });
    haikuConRazonamiento(mockPedidos[0], 150);
  });
});
