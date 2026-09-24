import { esContestadorAutomatico, esFraseDeBot } from './contestador';

describe('contestadores automáticos del otro lado', () => {
  it('reconoce los mensajes del bot de menú de la captura (24/9/2026)', () => {
    for (const t of [
      '*Tocá la opción* del tema que necesites ayuda:',
      'Perdón, pero por ahora sólo puedo responderte *si tocás un botón* del menú. 😉',
      'Parece que no logro comprenderte. Nos pasa hasta a los mejores. 😅',
      'Este es un mensaje automático. Gracias por escribirnos.',
      'Opción inválida. Respondé con el número de la opción.',
    ]) expect(esFraseDeBot(t)).toBe(true);
  });
  it('no confunde a un cliente', () => {
    for (const t of [
      'Hola, quiero 2 fernet branca de 750',
      'no entiendo cuánto sale el envío',
      '¿Qué opciones de whisky tienen?',
      'Tocame el timbre cuando llegues',
      'no te entendí, ¿me repetís el total?',
    ]) expect(esFraseDeBot(t)).toBe(false);
  });
  it('el mismo texto largo por tercera vez es una máquina; un "hola" repetido no', () => {
    const r = 'Gracias por comunicarte con Distribuidora Norte, en breve te respondemos';
    expect(esContestadorAutomatico(r, [r, 'algo', r])).toBe(true);
    expect(esContestadorAutomatico(r, [r])).toBe(false);
    expect(esContestadorAutomatico('hola', ['hola', 'hola'])).toBe(false);
  });
});
