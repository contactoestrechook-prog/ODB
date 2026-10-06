// LOS MODELOS EN UN SOLO LUGAR (6/10/2026, «bajemos el gasto de ODB»): todo lo
// que era Opus pasa a Opus 5.5 y el esfuerzo se manda siempre explícito.
import { esfuerzo, jsonDe, MODELO_BOT, MODELO_PRINCIPAL, RAZONAMIENTO, textoUtil } from './modelos';

describe('los modelos de Claude', () => {
  it('por defecto, Opus 5.5 para todo (sin variables cargadas)', () => {
    expect(MODELO_PRINCIPAL).toBe('claude-opus-5-5');
    expect(MODELO_BOT).toBe('claude-opus-5-5');
  });

  it('el razonamiento va siempre encendido y adaptativo', () => {
    expect(RAZONAMIENTO).toEqual({ type: 'adaptive' });
  });
});

describe('el esfuerzo', () => {
  const antes = { ...process.env };
  afterEach(() => {
    for (const k of ['ODB_ESFUERZO', 'ODB_BOT_ESFUERZO', 'MESA_ESFUERZO']) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });

  it('medium por defecto (el de Opus 5.5)', () => {
    delete process.env.ODB_ESFUERZO;
    delete process.env.ODB_BOT_ESFUERZO;
    expect(esfuerzo('ODB_BOT_ESFUERZO')).toBe('medium');
    expect(esfuerzo()).toBe('medium');
  });

  it('la variable de la función manda sobre la general, y la general sobre el valor por defecto', () => {
    process.env.ODB_ESFUERZO = 'low';
    expect(esfuerzo('ODB_BOT_ESFUERZO')).toBe('low');
    expect(esfuerzo('ASISTENTE_ESFUERZO', 'high')).toBe('low');
    process.env.ODB_BOT_ESFUERZO = 'HIGH';
    expect(esfuerzo('ODB_BOT_ESFUERZO')).toBe('high');
  });

  it('un valor que no existe no llega a la API: vale el siguiente', () => {
    process.env.MESA_ESFUERZO = 'altísimo';
    delete process.env.ODB_ESFUERZO;
    expect(esfuerzo('MESA_ESFUERZO')).toBe('medium');
    expect(esfuerzo('MESA_ESFUERZO', 'low')).toBe('low');
  });
});

describe('leer la respuesta', () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"items":[1]}' }] };

  it('lee por tipo de bloque, no el primero (que es el razonamiento)', () => {
    expect(textoUtil(ok, 'X')).toBe('{"items":[1]}');
    expect(jsonDe(ok, 'X')).toEqual({ items: [1] });
  });

  it('un rechazo de seguridad da un error que lo dice', () => {
    const r = { stop_reason: 'refusal', content: [], stop_details: { category: 'bio' } };
    expect(() => jsonDe(r, 'La lectura')).toThrow(/La lectura: la IA no quiso contestar este pedido \(bio\)/);
  });

  it('un corte por el tope da un error que lo dice, no un JSON.parse roto', () => {
    const r = { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '', signature: 'x' }] };
    expect(() => jsonDe(r, 'La lectura')).toThrow(/se cortó antes de terminar/);
  });

  it('sin texto o con un JSON que no se lee: error claro', () => {
    expect(() => textoUtil({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }, 'X')).toThrow(/no devolvió nada/);
    expect(() => jsonDe({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":' }] }, 'X')).toThrow(/no se pudo leer/);
  });
});
