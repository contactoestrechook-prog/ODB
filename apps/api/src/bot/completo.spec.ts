import { diceQueEstaCompleto, puedeCotizar } from './completo';

const PREGUNTA = '• 2 × Fernet Branca 750 cc\n• 6 × Coca Cola Zero 1,75 L\n\n¿Está completo el pedido o querés sumar algo?';

describe('el pedido se confirma completo antes de los precios', () => {
  it('un pedido nuevo NO se cotiza de una', () => {
    expect(puedeCotizar('Quiero 2 fernet branca de 750 y 6 coca zero', [])).toBe(false);
    expect(puedeCotizar('Puede ser 4 Malboro gold', ['Buenas tardes, ¿qué necesitás?'])).toBe(false);
  });
  it('el sí a "¿está completo?" habilita los precios', () => {
    for (const t of ['si', 'Sí', 'sí, eso es todo', 'dale', 'nada más', 'es todo', 'no, nada más', 'listo', 'así está bien']) expect(puedeCotizar(t, [PREGUNTA])).toBe(true);
  });
  it('si suma algo, se vuelve a preguntar', () => {
    expect(puedeCotizar('sumale 2 hielos', [PREGUNTA])).toBe(false);
    expect(diceQueEstaCompleto('agregale una picada')).toBe(false);
  });
  it('si el primer mensaje ya dice que es todo, o pregunta un precio, se cotiza', () => {
    expect(puedeCotizar('2 fernet y 3 cocas, eso es todo', [])).toBe(true);
    expect(puedeCotizar('cuánto me salen 3 fernet?', [])).toBe(true);
  });
  it('con precios ya mostrados, un cambio se cotiza directo', () => {
    expect(puedeCotizar('y sumale 1 smirnoff', ['• Fernet — 2 × $20.500 c/u = $41.000\n*Total: $41.000*\n¿Lo retirás o te lo enviamos?'])).toBe(true);
    expect(puedeCotizar('envío a Los Talas 15', ['...\n¿Lo confirmo?'])).toBe(true);
  });
  it('otras formas de preguntar si está completo', () => {
    expect(puedeCotizar('sí', ['• 2 × Fernet\n• 1 × Smirnoff\n\n¿Eso sería todo?'])).toBe(true);
    expect(puedeCotizar('si', ['¿Algo más?'])).toBe(true);
  });
  it('confirmó completo y después eligió variantes: se cotiza, no se vuelve a preguntar', () => {
    const bot = ['Me faltan dos definiciones: ¿qué Lays? ¿Maní con o sin cáscara?', PREGUNTA];
    expect(puedeCotizar('las clásicas de 134 y el pelado', bot, ['Necesito: 2 fernet...', 'sí, es todo'])).toBe(true);
    expect(puedeCotizar('las clásicas de 134 y el pelado', bot, ['Necesito: 2 fernet...'])).toBe(false);
  });
});
