// El chat de la factura (8/10/2026): lo que devuelve la IA se filtra antes de
// llegar a la pantalla. Solo pasan cambios aplicables.
import { motivoParaCorregir, validarRespuestaChat } from './factura-chat.service';

describe('validarRespuestaChat', () => {
  it('deja pasar los cambios válidos y descarta el resto', () => {
    const r = validarRespuestaChat({
      respuesta: 'Le puse el 5% al tomate: ahora cierra.',
      cambios: [
        { renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'columna %Des.' },
        { renglon: 0, campo: 'precio', valor: 1, motivo: '' },
        { renglon: 99, campo: 'precio', valor: 1, motivo: '' },
        { renglon: 2, campo: 'color', valor: 'rojo', motivo: '' },
        { renglon: 2.5, campo: 'precio', valor: 1, motivo: '' },
      ],
      cambiosPie: [{ campo: 'percepcionIibb', valor: 16151.75, motivo: 'ARBA' }, { campo: 'otro', valor: 1, motivo: '' }, { campo: 'iva', valor: -3, motivo: '' }],
      reglaProveedor: '  En Distri-Sur el «Descuento» de abajo es el regalo del renglón de arriba. ',
    }, 15);
    expect(r.cambios).toEqual([{ renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'columna %Des.' }]);
    expect(r.cambiosPie).toEqual([{ campo: 'percepcionIibb', valor: 16151.75, motivo: 'ARBA' }]);
    expect(r.reglaProveedor).toBe('En Distri-Sur el «Descuento» de abajo es el regalo del renglón de arriba.');
    expect(r.respuesta).toContain('5%');
  });
  it('sin nada útil devuelve una respuesta vacía de cambios', () => {
    expect(validarRespuestaChat({}, 3)).toEqual({ respuesta: 'Listo.', cambios: [], cambiosPie: [], reglaProveedor: null, descartados: [] });
  });
  it('lo que se descarta vuelve con el porqué, para que la pantalla lo diga (22/10/2026)', () => {
    const r = validarRespuestaChat({
      respuesta: 'Listo, le bajé el costo.',
      cambios: [{ renglon: 1, campo: 'costo', valor: 5165, motivo: '' }, { renglon: 40, campo: 'precio', valor: 1, motivo: '' }, { renglon: 4, campo: 'ingresa', valor: false, motivo: 'no llegó' }],
    }, 24);
    expect(r.cambios).toEqual([{ renglon: 4, campo: 'ingresa', valor: false, motivo: 'no llegó' }]);
    expect(r.descartados).toEqual([
      { renglon: 1, campo: 'costo', porque: 'ese dato no se puede cambiar desde el chat' },
      { renglon: 40, campo: 'precio', porque: 'ese renglón no existe en la factura' },
    ]);
  });
});

// «Resuelve bien en la conversación pero no después en el cambio» (22/10/2026):
// cuándo el servidor le pide a la IA que mande el cambio de forma aplicable.
describe('motivoParaCorregir', () => {
  const salida = (o: any) => ({ respuesta: '', cambios: [], cambiosPie: [], reglaProveedor: null, descartados: [], ...o });
  it('dice que cambió algo y no mandó cambios → se le pide de nuevo', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Listo, le saqué el 18% al Oreo y ahora cierra.' }))).toMatch(/no mandaste ninguno/);
  });
  it('mandó un cambio que no se puede aplicar → se le pide de nuevo, con el porqué', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Puse el costo en 5165.', descartados: [{ renglon: 1, campo: 'costo', porque: 'ese dato no se puede cambiar desde el chat' }] }))).toMatch(/renglón 1 «costo»/);
  });
  it('dice lo que cambió y lo mandó → está bien', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Le saqué el 18%: ahora cierra.', cambios: [{ renglon: 1, campo: 'descuentoPct', valor: null, motivo: '' }] }))).toBeNull();
  });
  it('solo explica, sin decir que cambió nada → está bien', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'El 5165 sale de 4004,07 más IVA 21% y percepciones 8%.' }))).toBeNull();
  });
});
