import { atiendeUnaPersona, decisionSesion, esperasParaAvisar, motivoDeSilencio, pideRespuesta } from './pausa';

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

// Textos REALES de charlas pausadas de ODB (auditoría del 19/9/2026)
describe('¿el mensaje pide una respuesta?', () => {
  it('pedidos, precios y preguntas: sí', () => {
    for (const t of [
      '1 smirnoff mango\n1 smirnoff normal\n3 vinos santa julia tinto\n3 powerade azul de la grande',
      'cuanto me saldria eso??',
      'Tienen ???',
      'para hacer un pedido?',
      'hasta q hora estan abiertos?',
      'me mandaron mal el pedido, falta una botella',
      '🎙️ Hola Jacky, ¿cómo andas? Ya te averiguo',
      '📷 Foto del cliente',
    ]) expect(pideRespuesta(t)).toBe(true);
  });
  it('cortesías y cierres: no', () => {
    for (const t of [
      'Gracias !!', 'Graciasss', 'Okk', 'ok gracias', 'dale', 'Listo', 'perfecto', '👍🏻👍🏻', 'recibido', 'Buenas noches', 'Si si claro',
    ]) expect(pideRespuesta(t)).toBe(false);
  });
  it('un mensaje largo se avisa aunque no tenga pregunta', () => {
    expect(pideRespuesta('Te dejo anotado que el viernes paso por la sucursal a buscar lo que quedó pendiente de la semana pasada')).toBe(true);
    expect(pideRespuesta('')).toBe(false);
  });
});

describe('qué esperas avisar', () => {
  const ahora = new Date('2026-09-22T17:05:00Z').getTime();
  const h = (horas: number) => new Date(ahora - horas * 3600_000).toISOString();
  it('las nunca avisadas van primero aunque haya 12 viejas ya avisadas', () => {
    const viejas = Array.from({ length: 12 }, (_, i) => ({ telefono: `v${i}`, esperando_desde: h(50 + i), esperando_aviso_en: h(1), esperando_avisos: 1 }));
    const nueva = { telefono: '101249693302890', esperando_desde: h(20), esperando_aviso_en: null, esperando_avisos: 0 };
    const r = esperasParaAvisar([...viejas, nueva], ahora);
    expect(r.map((x) => x.telefono)).toEqual(['101249693302890']);
  });
  it('re-aviso a las 6 h, tercero a las 24 h, y después silencio', () => {
    expect(esperasParaAvisar([{ telefono: 'a', esperando_desde: h(8), esperando_aviso_en: h(7), esperando_avisos: 1 }], ahora)).toHaveLength(1);
    expect(esperasParaAvisar([{ telefono: 'b', esperando_desde: h(10), esperando_aviso_en: h(7), esperando_avisos: 2 }], ahora)).toHaveLength(0);
    expect(esperasParaAvisar([{ telefono: 'c', esperando_desde: h(40), esperando_aviso_en: h(25), esperando_avisos: 2 }], ahora)).toHaveLength(1);
    expect(esperasParaAvisar([{ telefono: 'd', esperando_desde: h(80), esperando_aviso_en: h(30), esperando_avisos: 3 }], ahora)).toHaveLength(0);
  });
  it('menos de 20 minutos no se avisa', () => {
    expect(esperasParaAvisar([{ telefono: 'e', esperando_desde: h(0.2), esperando_aviso_en: null }], ahora)).toHaveLength(0);
  });
});

describe('vigilante de la sesión de WhatsApp', () => {
  it('una lectura mala es un parpadeo; dos seguidas reinician y alertan una vez', () => {
    expect(decisionSesion('FAILED', 0)).toEqual({ fallos: 1, reiniciar: false, alertar: false });
    expect(decisionSesion('FAILED', 1)).toEqual({ fallos: 2, reiniciar: true, alertar: true });
    expect(decisionSesion('FAILED', 2)).toEqual({ fallos: 3, reiniciar: false, alertar: true });
    expect(decisionSesion('WORKING', 5)).toEqual({ fallos: 0, reiniciar: false, alertar: false });
  });
  it('desvinculada (QR) no se reinicia: hay que escanear', () => {
    expect(decisionSesion('SCAN_QR_CODE', 1)).toEqual({ fallos: 2, reiniciar: false, alertar: true });
  });
  it('sin respuesta de WAHA cuenta como caída', () => {
    expect(decisionSesion(null, 1).reiniciar).toBe(true);
  });
});
