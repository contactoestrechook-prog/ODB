// TODAS LAS FUNCIONES QUE ERAN OPUS, EN OPUS 5.5 (6/10/2026, «bajemos el gasto de
// ODB»). Con el SDK simulado (acá no se llama a la API): cada llamada va con el
// modelo de comun/modelos.ts, razonamiento encendido (regla del 9/9; en 5.5 ya no
// se puede apagar), esfuerzo explícito, un tope con lugar para pensar y nada de
// tool_choice forzado; y un rechazo o un corte dan un error que se entiende en
// vez de un JSON.parse roto. Las respuestas simuladas tienen la forma de 5.5: un
// bloque de razonamiento vacío antes del texto.
const mockCola: any[] = [];
const mockPedidos: any[] = [];
const mockResponder = (p: any) => {
  mockPedidos.push(JSON.parse(JSON.stringify(p)));
  const r = mockCola.shift();
  if (r instanceof Error) throw r;
  return r;
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

import { DifusionesService } from '../difusiones/difusiones.service';
import { InformesService } from '../informes/informes.service';
import { EventosService } from '../eventos/eventos.service';
import { PromosService } from '../promos/promos.service';
import { ComparadorService } from '../comparador/comparador.service';
import { ReportesService } from '../reportes/reportes.service';
import { AsistenteService } from '../asistente/asistente.service';
import { ListasService } from '../listas/listas.service';
import { MesaComprasService } from '../compras/mesa-compras.service';
import Anthropic from '@anthropic-ai/sdk';

const uso = { input_tokens: 1, output_tokens: 1 };
const pensar = { type: 'thinking', thinking: '', signature: 'x' };
const conTexto = (t: string, stop = 'end_turn') => ({ stop_reason: stop, content: [pensar, { type: 'text', text: t }], usage: uso });
const rechazo = { stop_reason: 'refusal', content: [], stop_details: { category: 'bio' }, usage: uso };
const cortada = { stop_reason: 'max_tokens', content: [pensar], usage: uso };

function opus55(p: any, minimo: number) {
  expect(p.model).toBe('claude-opus-5-5');
  expect(p.thinking).toEqual({ type: 'adaptive' });
  expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(p.output_config?.effort);
  expect(p.max_tokens).toBeGreaterThanOrEqual(minimo);
  expect(p.tool_choice === undefined || p.tool_choice?.type === 'none').toBe(true);
}

beforeEach(() => {
  mockCola.length = 0;
  mockPedidos.length = 0;
  process.env.ANTHROPIC_API_KEY = 'prueba';
});

describe('difusiones', () => {
  it('Opus 5.5 con razonamiento y lugar para pensar (iba sin razonamiento y con 600)', async () => {
    mockCola.push(conTexto('Novedades de la semana. Responda BAJA para no recibir más mensajes.'));
    const r = await new DifusionesService({} as any).redactar('ofertas');
    expect(r.mensaje).toMatch(/BAJA/);
    opus55(mockPedidos[0], 4000);
    expect(mockPedidos[0].output_config.effort).toBe('medium');
  });

  it('un rechazo o una respuesta vacía dan un error claro, no un mensaje vacío', async () => {
    mockCola.push(rechazo);
    await expect(new DifusionesService({} as any).redactar('x')).rejects.toThrow(/no quiso contestar/);
    mockCola.push(cortada);
    await expect(new DifusionesService({} as any).redactar('x')).rejects.toThrow(/se cortó/);
  });
});

describe('el parte de las 7 (informes)', () => {
  it('Opus 5.5 con razonamiento (iba sin él y con 1000 de tope); se lee el texto, no el razonamiento', async () => {
    mockCola.push(conTexto('Ayer se vendió el promedio.'));
    const s: any = new InformesService({} as any, {} as any);
    expect(await s.relatar('2026-10-05', { ventas: 1 })).toBe('Ayer se vendió el promedio.');
    opus55(mockPedidos[0], 6000);
  });

  it('cortado por el tope: no sale un parte a medias', async () => {
    mockCola.push(cortada);
    const s: any = new InformesService({} as any, {} as any);
    expect(await s.relatar('2026-10-05', {})).toMatch(/^\(Relato no disponible/);
  });
});

describe('eventos', () => {
  const servicio = () => {
    const s: any = new EventosService({} as any, {} as any);
    s.catalogoBebidas = async () => [{ id: 'p1', sku: 'E1', nombre: 'Espumante', precio: 10000, stock: 50 }];
    return s;
  };

  it('Opus 5.5 con salida estructurada {items}: el JSON ya no se recorta del texto', async () => {
    mockCola.push(conTexto(JSON.stringify({ items: [{ sku: 'E1', cantidad: 24, motivo: 'brindis' }] })));
    const r = await servicio().sugerir({ tipo: 'casamiento', invitados: 30 });
    expect(r.items).toEqual([{ producto_id: 'p1', descripcion: 'Espumante', cantidad: 24, precio_unitario: 10000 }]);
    opus55(mockPedidos[0], 6000);
    expect(mockPedidos[0].output_config.format.type).toBe('json_schema');
    expect(mockPedidos[0].output_config.format.schema.required).toEqual(['items']);
  });

  it('un corte por el tope da un error claro', async () => {
    mockCola.push(cortada);
    await expect(servicio().sugerir({ tipo: 'casamiento', invitados: 30 })).rejects.toThrow(/La sugerencia de bebidas: la respuesta de la IA se cortó/);
  });
});

describe('promos', () => {
  it('Opus 5.5 con razonamiento y esfuerzo; el JSON se lee con control de rechazo', async () => {
    const s: any = new PromosService({} as any, {} as any);
    mockCola.push(conTexto('{"ideas":[]}'));
    expect(await s.claude('armá promos', { type: 'object' })).toEqual({ ideas: [] });
    opus55(mockPedidos[0], 16000);
    mockCola.push(rechazo);
    await expect(s.claude('armá promos', { type: 'object' })).rejects.toThrow(/no quiso contestar/);
  });
});

describe('comparador: la aclaración del proveedor', () => {
  it('Opus 5.5 con razonamiento (iba sin él y con 1024: el JSON se cortaba)', async () => {
    mockCola.push(conTexto(JSON.stringify({ factorCosto: 0.75, equivaleADescuentoPct: 25, alcance: 'lista', productoMencionado: null, explicacion: '6+2' })));
    const r = await new ComparadorService({} as any).interpretarAclaracion({ texto: 'compro 6 y me regala 2' });
    expect(r.factorCosto).toBe(0.75);
    opus55(mockPedidos[0], 4000);
  });

  it('un corte da un error claro', async () => {
    mockCola.push(cortada);
    await expect(new ComparadorService({} as any).interpretarAclaracion({ texto: 'x' })).rejects.toThrow(/se cortó/);
  });
});

describe('«Esto está mal» (reportes)', () => {
  it('Opus 5.5, esfuerzo medium (era high) y lugar para el JSON; un rechazo va al valor por defecto', async () => {
    const s: any = new ReportesService({} as any);
    mockCola.push(conTexto('{"tipo":"dato","resumen":"r","pasos":[],"respuesta_usuario":"Tocá aclaraciones."}'));
    expect((await s.clasificar('el precio está mal', 'Precios', {}, 'dueno')).tipo).toBe('dato');
    opus55(mockPedidos[0], 8000);
    expect(mockPedidos[0].output_config.effort).toBe('medium');
    mockCola.push(rechazo);
    expect((await s.clasificar('x', 'y', {}, null)).tipo).toBe('sistema');
  });
});

describe('el asistente de la tienda', () => {
  it('Opus 5.5 con razonamiento a esfuerzo low (contesta rápido), caché sobre la charla y la historia solo crece', async () => {
    const s: any = new AsistenteService({} as any);
    s.buscar = jest.fn(async () => [{ sku: 'Q1', nombre: 'Queso brie', precio: 9000, imagenUrl: 'x' }]);
    mockCola.push(
      { stop_reason: 'tool_use', content: [pensar, { type: 'tool_use', id: 't1', name: 'buscar', input: { q: 'brie' } }], usage: uso },
      { stop_reason: 'tool_use', content: [pensar, { type: 'tool_use', id: 't2', name: 'responder', input: { mensaje: 'Te muestro brie.', grupos: [{ titulo: 'Quesos', skus: ['Q1'] }], sugerencias: [] } }], usage: uso },
    );
    // ODB_ESFUERZO no lo toca: la tienda contesta en 50 s (revisión del 6/10/2026)
    const antes = process.env.ODB_ESFUERZO;
    process.env.ODB_ESFUERZO = 'high';
    let r: any;
    try { r = await s.charlar([{ rol: 'usuario', texto: 'quiero brie' }]); } finally { if (antes === undefined) delete process.env.ODB_ESFUERZO; else process.env.ODB_ESFUERZO = antes; }
    expect(r.mensaje).toBe('Te muestro brie.');
    expect(mockPedidos).toHaveLength(2);
    for (const p of mockPedidos) {
      opus55(p, 8000);
      expect(p.output_config.effort).toBe('low');
      expect(p.cache_control).toEqual({ type: 'ephemeral' });
      expect(p.tools).toEqual(mockPedidos[0].tools);
    }
    expect(mockPedidos[1].messages.slice(0, mockPedidos[0].messages.length)).toEqual(mockPedidos[0].messages);
    expect(mockPedidos[1].messages[1].content[0]).toEqual(pensar);
  });
});

describe('listas: lectura de PDF y Excel', () => {
  const archivo: any = { buffer: Buffer.from('%PDF-1.4'), originalname: 'lista.pdf' };

  it('Opus 5.5 con razonamiento y esfuerzo medium (con low se cruzan las filas)', async () => {
    const s: any = new ListasService({} as any);
    mockCola.push(conTexto(JSON.stringify({ items: [{ codigo: 'A1', descripcion: 'Vino', precio: 1000 }] })));
    expect(await s.extraerConIA(archivo, 'pdf')).toEqual([{ codigo: 'A1', descripcion: 'Vino', precio: 1000 }]);
    // 128000 (revisión del 6/10/2026): el razonamiento sale del mismo tope y con
    // 64000 una lista de ~2.000 renglones que antes entraba se cortaba
    opus55(mockPedidos[0], 128000);
    expect(mockPedidos[0].output_config.effort).toBe('medium');
    mockCola.push(conTexto(JSON.stringify({ items: [] })));
    await s.extraerPedidoConIA(archivo, 'pdf');
    opus55(mockPedidos[1], 128000);
  });

  it('cortada por el tope: un error que lo dice, no una lista vacía que parece «no había nada»', async () => {
    const s: any = new ListasService({} as any);
    mockCola.push({ stop_reason: 'max_tokens', content: [pensar, { type: 'text', text: '{"items":[{"codigo":"A1"' }], usage: uso });
    await expect(s.extraerConIA(archivo, 'pdf')).rejects.toThrow(/La lectura de la lista: la respuesta de la IA se cortó/);
    mockCola.push(rechazo);
    await expect(s.extraerPedidoConIA(archivo, 'pdf')).rejects.toThrow(/La lectura del pedido: la IA no quiso contestar/);
  });
});

describe('mesa de compras', () => {
  it('el cierre por tiempo lleva las MISMAS herramientas con tool_choice none y razonamiento (iba sin ninguna de las dos cosas), a esfuerzo low', async () => {
    const s: any = new MesaComprasService({} as any);
    const historial = [
      { role: 'user', content: [{ type: 'text', text: 'costeame esto' }] },
      { role: 'assistant', content: [pensar, { type: 'tool_use', id: 'c1', name: 'calcular_costo', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"costo":100}' }] },
    ];
    // revisión del 6/10/2026: corre cuando el esfuerzo del bucle ya se quedó sin
    // tiempo y tiene 55 s: va en low, aunque ODB_ESFUERZO pida más
    const antes = process.env.ODB_ESFUERZO;
    process.env.ODB_ESFUERZO = 'high';
    mockCola.push(conTexto('El costo es $100.'));
    try {
      expect(await s.cerrarConLoQueHay(new Anthropic(), historial)).toBe('El costo es $100.');
    } finally {
      if (antes === undefined) delete process.env.ODB_ESFUERZO; else process.env.ODB_ESFUERZO = antes;
    }
    const p = mockPedidos[0];
    opus55(p, 8000);
    expect(p.tool_choice).toEqual({ type: 'none' });
    expect(p.tools.length).toBeGreaterThan(0);
    expect(p.output_config.effort).toBe('low');
    // la charla de antes va tal cual, con su razonamiento, y la nota se agrega al final
    expect(p.messages.slice(0, 3)).toEqual(historial);
  });

  it('el bucle: Opus 5.5, esfuerzo medium por defecto, caché sobre la charla y las mismas herramientas en cada vuelta', async () => {
    const s: any = new MesaComprasService({} as any);
    s.ejecutar = jest.fn(async () => ({ costo: 100 }));
    mockCola.push(
      { stop_reason: 'tool_use', content: [pensar, { type: 'tool_use', id: 'c1', name: 'calcular_costo', input: {} }], usage: uso },
      conTexto('El costo es de $100 por unidad.'),
    );
    const r: any = await s.charlar([{ rol: 'usuario', texto: 'lista $120, 10% de descuento' }]);
    expect(r.respuesta).toMatch(/100/);
    expect(mockPedidos).toHaveLength(2);
    for (const p of mockPedidos) {
      opus55(p, 16000);
      expect(p.output_config.effort).toBe('medium');
      expect(p.cache_control).toEqual({ type: 'ephemeral' });
      expect(p.tool_choice).toBeUndefined();
      expect(p.tools).toEqual(mockPedidos[0].tools);
    }
    expect(mockPedidos[1].messages[1].content[0]).toEqual(pensar);
  });
});
