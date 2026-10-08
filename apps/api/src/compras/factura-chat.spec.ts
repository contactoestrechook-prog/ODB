// El chat de la factura (8/10/2026): lo que devuelve la IA se filtra antes de
// llegar a la pantalla. Solo pasan cambios aplicables.
import { validarRespuestaChat } from './factura-chat.service';

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
    expect(validarRespuestaChat({}, 3)).toEqual({ respuesta: 'Listo.', cambios: [], cambiosPie: [], reglaProveedor: null });
  });
});
