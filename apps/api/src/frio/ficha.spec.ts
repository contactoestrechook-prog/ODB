import { cambiosFicha, idEquipoValido, siguienteCodigo } from './ficha';

describe('frío · ficha', () => {
  const actual = { minimo: -22, maximo: -15 };

  it('toma solo lo que viene y limpia los textos', () => {
    expect(cambiosFicha({ nombre: '  Cámara 1 ', lugar: '' }, actual)).toEqual({ nombre: 'Cámara 1', lugar: null });
  });

  it('acepta coma decimal en el rango', () => {
    expect(cambiosFicha({ minimo: '-18,5', maximo: '-8' }, actual)).toEqual({ minimo: -18.5, maximo: -8 });
  });

  it('rechaza un máximo menor o igual al mínimo, también contra el rango que ya tiene', () => {
    expect(() => cambiosFicha({ minimo: 2, maximo: 2 }, actual)).toThrow('mayor');
    expect(() => cambiosFicha({ minimo: -10 }, actual)).toThrow('mayor');
  });

  it('rechaza nombre vacío, tipo desconocido y minutos fuera de escala', () => {
    expect(() => cambiosFicha({ nombre: ' ' }, actual)).toThrow('vacío');
    expect(() => cambiosFicha({ tipo: 'helados' }, actual)).toThrow('Tipo');
    expect(() => cambiosFicha({ mudo_min: 1 }, actual)).toThrow('entre 2');
    expect(() => cambiosFicha({ demora_min: 2.5 }, actual)).toThrow('entero');
  });

  it('el número de equipo es solo números', () => {
    expect(idEquipoValido(' 2796 ')).toBe('2796');
    expect(() => idEquipoValido('EQ-1')).toThrow();
  });

  it('el código siguiente es el próximo libre', () => {
    expect(siguienteCodigo(['F-01', 'F-03', 'F-02'])).toBe('F-04');
    expect(siguienteCodigo([])).toBe('F-01');
  });
});
