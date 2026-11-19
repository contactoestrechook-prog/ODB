import { veTodoElArmado } from './salon.service';

// 19/11/2026, Leandro: «todos pueden ver el pedido que prepara el resto, está
// pésimo». Los roles son los de los usuarios reales de ese día.
describe('quién ve el armado de todos', () => {
  it('dueños y gerentes ven todo', () => {
    expect(veTodoElArmado({ roles: ['dueno'] })).toBe(true);
    expect(veTodoElArmado({ roles: ['gerente', 'cajero'] })).toBe(true);
  });
  it('la caja que no arma ve todo (Ailin, Guadalupe, Mariana, Romina)', () => {
    expect(veTodoElArmado({ roles: ['cajero'] })).toBe(true);
    expect(veTodoElArmado({ roles: ['administrativo', 'cajero'] })).toBe(true);
  });
  it('el que arma ve solo lo suyo, aunque también sea caja', () => {
    expect(veTodoElArmado({ roles: ['deposito', 'repartidor'] })).toBe(false); // Pablo
    expect(veTodoElArmado({ roles: ['deposito'] })).toBe(false); // Luka, Pedro
    expect(veTodoElArmado({ roles: ['cajero', 'op_salon'] })).toBe(false); // Alexis
    expect(veTodoElArmado({ roles: ['cajero', 'repartidor', 'op_salon'] })).toBe(false); // Matías
    expect(veTodoElArmado({ roles: ['op_salon'] })).toBe(false);
    expect(veTodoElArmado({ roles: ['fiambreria'] })).toBe(false);
  });
  it('un token viejo, sin la lista de roles, usa el principal', () => {
    expect(veTodoElArmado({ rol: 'deposito' })).toBe(false);
    expect(veTodoElArmado({ rol: 'cajero' })).toBe(true);
    expect(veTodoElArmado({ rol: 'dueno', roles: [] })).toBe(true);
  });
});
