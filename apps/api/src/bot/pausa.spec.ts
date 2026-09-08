import { atiendeUnaPersona, motivoDeSilencio } from './pausa';

describe('¿el bot tiene que callar?', () => {
  it('línea apagada: silencio siempre (salvo el banco de pruebas)', () => {
    expect(motivoDeSilencio({ bot_activo: false }, null)).toMatch(/toda la línea/);
    expect(motivoDeSilencio({ bot_activo: false }, null, true)).toBeNull();
  });
  it('charla pausada por una persona (bandeja, panel o teléfono): silencio', () => {
    expect(motivoDeSilencio({ bot_activo: true }, { bot_activo: false, atendida_por: 'u1', derivada_motivo: 'Pausado desde la bandeja' })).toMatch(/persona/);
    expect(motivoDeSilencio({ bot_activo: true }, { bot_activo: false, atendida_por: null, derivada_motivo: 'Atendida desde el teléfono' })).toMatch(/persona/);
  });
  it('derivada por el bot y sin tomar: NO es silencio (modo acotado)', () => {
    expect(atiendeUnaPersona({ bot_activo: false, atendida_por: null, derivada_motivo: 'El cliente mandó un archivo: hay que abrirlo' })).toBe(false);
    expect(motivoDeSilencio({ bot_activo: true }, { bot_activo: false, atendida_por: null, derivada_motivo: 'Cliente reclama faltante' })).toBeNull();
  });
  it('charla activa: contesta', () => {
    expect(motivoDeSilencio({ bot_activo: true }, { bot_activo: true })).toBeNull();
  });
});
