import { aclaracionDe, aclaracionesDeNotas, aclaracionesPorSku, notasConAclaraciones, sinAclaraciones } from './aclaraciones';
import { sinRestosDeMarcado } from './texto-limpio';

// 20/11/2026, simulacro de Leandro: «Saphirus limón» se anotaba como «Aromatizante
// Saphirus Textil VARIOS» y a quien armaba no le llegaba el «limón».
describe('la aclaración de un renglón viaja en las notas del pedido', () => {
  const SAPHIRUS = 'Aromatizante Saphirus Textil VARIOS';

  it('del modelo, por SKU (vacía o repetida no cuenta)', () => {
    const m = aclaracionesPorSku([{ sku: 'L7454', cantidad: 1, aclaracion: ' limón ' }, { sku: 'L2954', cantidad: 1, aclaracion: '' }, { sku: 'L7454', cantidad: 1, aclaracion: 'lavanda' }]);
    expect([...m]).toEqual([['L7454', 'limón']]);
    expect(aclaracionesPorSku(undefined).size).toBe(0);
  });

  it('primero las aclaraciones (las notas se cortan a 300) y después lo demás; se lee de vuelta por renglón', () => {
    const notas = notasConAclaraciones('Paga en efectivo', [{ nombre: SAPHIRUS, texto: 'limón' }, { nombre: 'Vela aromática VARIOS', texto: 'vainilla' }]);
    expect(notas).toBe('Aclaraciones: Aromatizante Saphirus Textil VARIOS «limón»; Vela aromática VARIOS «vainilla» · Paga en efectivo');
    // así llega al pedido: la base le pone «Retira: …» adelante y la prueba, «PRUEBA — …»
    const enElPedido = `PRUEBA — se arma pero NO se cobra ni se entrega (simulacro). Retira: Daniela · ${notas}`;
    expect(aclaracionesDeNotas(enElPedido)).toEqual([{ nombre: SAPHIRUS, texto: 'limón' }, { nombre: 'Vela aromática VARIOS', texto: 'vainilla' }]);
    expect(aclaracionDe('aromatizante saphirus  textil varios', aclaracionesDeNotas(enElPedido))).toBe('limón');
    expect(aclaracionDe('Rexona', aclaracionesDeNotas(enElPedido))).toBeNull();
    expect(sinAclaraciones(enElPedido)).toBe('PRUEBA — se arma pero NO se cobra ni se entrega (simulacro). Retira: Daniela · Paga en efectivo');
  });

  it('al recotizar no se duplican, y sin aclaraciones las notas quedan como estaban', () => {
    const una = notasConAclaraciones('Paga en efectivo', [{ nombre: SAPHIRUS, texto: 'limón' }]);
    expect(notasConAclaraciones(una, [{ nombre: SAPHIRUS, texto: 'limón' }])).toBe(una);
    expect(notasConAclaraciones('Paga en efectivo', [])).toBe('Paga en efectivo');
    expect(notasConAclaraciones('', [])).toBe('');
  });

  it('lo que escribe el cliente no rompe la forma (comillas, punto y coma)', () => {
    const notas = notasConAclaraciones('', [{ nombre: SAPHIRUS, texto: '«limón»; o pomelo' }]);
    expect(aclaracionesDeNotas(notas)).toEqual([{ nombre: SAPHIRUS, texto: 'limón o pomelo' }]);
  });

  it('la limpieza de textos del pedido no se la lleva', () => {
    const notas = notasConAclaraciones('Paga en efectivo', [{ nombre: SAPHIRUS, texto: 'limón' }]);
    expect(aclaracionesDeNotas(sinRestosDeMarcado(notas))).toEqual([{ nombre: SAPHIRUS, texto: 'limón' }]);
  });
});
