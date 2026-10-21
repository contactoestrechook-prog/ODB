import { ClientesController, fechaDeNacimiento } from './clientes.controller';

describe('fecha de nacimiento del cliente (la pide Eventos para los cumpleaños)', () => {
  const hoy = new Date('2026-10-21T12:00:00Z');

  it('acepta una fecha posible y vacía la borra', () => {
    expect(fechaDeNacimiento('1996-10-21', hoy)).toBe('1996-10-21');
    expect(fechaDeNacimiento('2000-02-29', hoy)).toBe('2000-02-29');
    expect(fechaDeNacimiento('', hoy)).toBeNull();
    expect(fechaDeNacimiento(null, hoy)).toBeNull();
  });

  it('rechaza lo que no es una fecha de nacimiento', () => {
    for (const mala of ['21/10/1996', '1999-02-29', '1890-01-01', '2027-01-01', 'mañana']) {
      expect(() => fechaDeNacimiento(mala, hoy)).toThrow('La fecha de nacimiento no es válida.');
    }
  });

  it('la edición del cliente la guarda en fecha_nacimiento', async () => {
    const update = jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) }));
    const db: any = { from: jest.fn(() => ({ update })) };
    await new ClientesController(db).editar('cli1', { fechaNacimiento: '1990-05-20' });
    expect(update).toHaveBeenCalledWith({ fecha_nacimiento: '1990-05-20' });
  });
});
