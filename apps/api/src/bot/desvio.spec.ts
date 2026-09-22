import { desvioDeLoPedido, fragmentoDelProducto } from './desvio';

// El pedido real que dejó al bot sin poder vender (22/9/2026)
const PEDIDO = 'Hola, quiero 2 fernet branca de 750 y 3 coca zero de 1.75, paso a retirar yo, Juan Perez';

describe('fragmento del mensaje que habla de cada producto', () => {
  it('cada producto mira su pedazo', () => {
    expect(fragmentoDelProducto('Fernet Branca  x750cc', PEDIDO)).toBe('quiero 2 fernet branca de 750');
    expect(fragmentoDelProducto('Coca Cola Zero x1.75L', PEDIDO)).toBe('3 coca zero de 1.75');
  });
  it('misma marca en dos variedades: cada una a la suya', () => {
    const t = '3 coca de 1.75 y 2 coca zero de 600';
    expect(fragmentoDelProducto('Coca Cola 1.75l', t)).toBe('3 coca de 1.75');
    expect(fragmentoDelProducto('Coca Cola Zero botella x 600cc', t)).toBe('2 coca zero de 600');
  });
  it('si no se puede atribuir, no se inventa', () => {
    expect(fragmentoDelProducto('Pan al peso', PEDIDO)).toBe('');
    expect(fragmentoDelProducto('Marlboro Gold Box x20', 'Puede ser 4 Malboro gold el blanco y dorado')).toContain('malboro gold');
  });
});

describe('desvío entre lo pedido y lo cotizado', () => {
  it('el fernet no es un desvío porque otro renglón diga "zero"', () => {
    expect(desvioDeLoPedido('Fernet Branca  x750cc', PEDIDO)).toBeNull();
    expect(desvioDeLoPedido('Coca Cola Zero x1.75L', PEDIDO)).toBeNull();
  });
  it('sigue frenando el reemplazo silencioso', () => {
    expect(desvioDeLoPedido('Coca Cola 1.75l', 'quiero 3 coca zero de 1.75')).toMatch(/pidió zero/);
    expect(desvioDeLoPedido('Coca Cola Zero x1.75L', 'quiero 3 coca de 1.5')).toMatch(/1,5 L/);
    expect(desvioDeLoPedido('Quilmes IPA 473cc', 'una quilmes clasica')).toMatch(/clásica/);
  });
  it('un mensaje de un solo producto se compara entero, como antes', () => {
    expect(desvioDeLoPedido('Coca Cola Zero x1.75L', 'coca zero de 1.75')).toBeNull();
    expect(desvioDeLoPedido('Coca Cola 1.75l', 'coca zero 1.75')).toMatch(/zero/);
  });
});
