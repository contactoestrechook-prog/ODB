import { quitarOraciones } from './prolijo';

describe('quitarOraciones (sin aplanar el mensaje, 3/10/2026)', () => {
  const LISTA = 'Te anoto:\n• 3 × Combo Picada Box\n• 2 × Fernet Branca 750 cc\n\nSi algo no es lo que buscás, decime y lo cambio.\n\n¿Está completo el pedido o querés sumar algo?';

  it('sin nada para quitar, el mensaje queda igual (con sus renglones)', () => {
    expect(quitarOraciones(LISTA, () => false)).toEqual({ texto: LISTA, quitadas: 0 });
  });

  it('quita una oración y los renglones siguen en su lugar', () => {
    const r = quitarOraciones(LISTA, (o) => /^Si algo no es/.test(o));
    expect(r.quitadas).toBe(1);
    expect(r.texto).toBe('Te anoto:\n• 3 × Combo Picada Box\n• 2 × Fernet Branca 750 cc\n\n¿Está completo el pedido o querés sumar algo?');
  });

  it('quita una oración en medio de un renglón', () => {
    expect(quitarOraciones('Hola. Ya te lo dije antes. ¿Algo más?', (o) => /antes/.test(o)).texto).toBe('Hola. ¿Algo más?');
  });
});
