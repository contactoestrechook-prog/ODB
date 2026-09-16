import { celularWhatsapp } from './whatsapp';

// Sin el 9, WhatsApp acepta el mensaje y no le llega a nadie (Jackie, 16/9/2026).
describe('celularWhatsapp: el número como lo espera WhatsApp', () => {
  it.each([
    ['541122812200', '5491122812200'],        // el caso de Jackie
    ['5491126600320', '5491126600320'],       // ya bien
    ['+54 9 11 2660-0320', '5491126600320'],
    ['11 2281-2200', '5491122812200'],
    ['011 15 2281-2200', '5491122812200'],
    ['1522812200', '1522812200'],             // sin área no se inventa
    ['+54 0221 15 456-7890', '5492214567890'],
    ['+598 99 123 456', '59899123456'],       // otro país: tal cual
  ])('%s → %s', (entrada, esperado) => {
    expect(celularWhatsapp(entrada)).toBe(esperado);
  });
});
