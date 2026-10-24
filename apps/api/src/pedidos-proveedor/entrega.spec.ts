// La fecha de entrega que confirma el proveedor (23/10/2026): qué se hace con
// lo que leyó la IA. La IA solo lee; qué se contesta y qué se guarda lo decide
// el código.
import { decidir, fechaValida, type LecturaRespuesta } from './entrega';

const jueves23 = new Date('2026-10-23T15:00:00-03:00'); // viernes 23/10/2026
const lectura = (o: Partial<LecturaRespuesta>): LecturaRespuesta => ({ sobreElPedido: true, fecha: null, horario: null, faltantes: null, rechaza: false, ...o });

describe('fechaValida', () => {
  it('acepta de hoy en adelante, hasta 90 días', () => {
    expect(fechaValida('2026-10-23', jueves23)).toBe('2026-10-23');
    expect(fechaValida('2026-10-30', jueves23)).toBe('2026-10-30');
  });
  it('descarta el pasado, lo muy lejano y lo que no es fecha', () => {
    expect(fechaValida('2026-10-22', jueves23)).toBeNull();
    expect(fechaValida('2027-03-01', jueves23)).toBeNull();
    expect(fechaValida('2026-02-30', jueves23)).toBeNull();
    expect(fechaValida('el jueves', jueves23)).toBeNull();
    expect(fechaValida(null, jueves23)).toBeNull();
  });
});

describe('decidir', () => {
  it('con fecha: confirma, agradece con el día y la franja', () => {
    const d = decidir(lectura({ fecha: '2026-10-29', horario: 'a la mañana' }), 'OC-2026-00012', false);
    expect(d.accion).toBe('confirmar');
    if (d.accion !== 'confirmar') return;
    expect(d.fecha).toBe('2026-10-29');
    expect(d.texto).toMatch(/OC-2026-00012/);
    expect(d.texto).toMatch(/jueves/);
    expect(d.texto).toMatch(/a la mañana/);
  });
  it('con fecha y faltantes: confirma y deja constancia de lo que falta', () => {
    const d = decidir(lectura({ fecha: '2026-10-29', faltantes: 'no hay Macallan Triple Cask' }), 'OC-1', false);
    expect(d.accion).toBe('confirmar');
    if (d.accion === 'confirmar') expect(d.texto).toMatch(/Macallan Triple Cask/);
  });
  it('sin fecha la primera vez: repregunta', () => {
    const d = decidir(lectura({ faltantes: null }), 'OC-1', false);
    expect(d.accion).toBe('repreguntar');
  });
  it('sin fecha después de repreguntar: lo mira una persona y no se le insiste más', () => {
    const d = decidir(lectura({}), 'OC-1', true);
    expect(d).toMatchObject({ accion: 'a_revisar', texto: null });
  });
  it('si dice que no puede hacer el pedido: a revisar, con un acuse corto', () => {
    const d = decidir(lectura({ rechaza: true }), 'OC-1', false);
    expect(d.accion).toBe('a_revisar');
    if (d.accion === 'a_revisar') expect(d.texto).toBeTruthy();
  });
  it('un mensaje que no habla del pedido no se toca (sigue su camino de siempre)', () => {
    expect(decidir(lectura({ sobreElPedido: false, fecha: '2026-10-29' }), 'OC-1', false)).toEqual({ accion: 'ignorar' });
  });
});
