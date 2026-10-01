import { cantidadesPedidas, etiquetaVolumen, medidaPartida, pideTamano, resumenDeTamanos, volumenMl } from './formatos';

describe('tamaño de las botellas', () => {
  it('lee la medida como la escribe el catálogo', () => {
    expect(volumenMl('Chivas Regal 12 años Balancin x4.5Lt')).toBe(4500);
    expect(volumenMl('BALANCIN J.RED 3000 CC X 1')).toBe(3000);
    expect(volumenMl('Jack Daniels Sinatra Edition x1l')).toBe(1000);
    expect(volumenMl('Dalmore The Trio 1lt')).toBe(1000);
    expect(volumenMl('Johnnie Walker Black Label x 1000cc')).toBe(1000);
    expect(volumenMl('Whisky Jack Daniel con Coca x 269ml')).toBe(269);
    expect(volumenMl('Chivas Regal 18 años')).toBeNull();
    expect(volumenMl('Coleccion Johnny Walker x4un')).toBeNull();
    expect(etiquetaVolumen(4500)).toBe('4,5 L');
    expect(etiquetaVolumen(750)).toBe('750 cc');
  });
  it('detecta cuándo el cliente pide tamaño', () => {
    expect(pideTamano('Quiero saber que opciones de Whisky en botellas de más 1 litro tienen')).toEqual({ ml: 1000, grande: true });
    expect(pideTamano('No tienen botellas de 2 o 3 litros!?')).toEqual({ ml: 3000, grande: true });
    expect(pideTamano('whisky balancín')).toEqual({ ml: null, grande: true });
    expect(pideTamano('whisky 750')).toBeNull();
    expect(pideTamano('fernet')).toBeNull();
  });
});

describe('medida partida y tamaños del catálogo', () => {
  it('"coca zero de 2 litros 25" son 2,25 L', () => {
    expect(medidaPartida('Coca zero de 2 litros 25')).toBe(2250);
    expect(medidaPartida('coca de 1 litro 5')).toBe(1500);
    expect(medidaPartida('un litro y medio de coca')).toBe(1500);
    expect(medidaPartida('Coca de 2 litros')).toBeNull();
    expect(medidaPartida('llevame 2 litros 25 de coca')).toBe(2250);
    expect(medidaPartida('agua x 500 gr')).toBeNull();
  });
  it('los tamaños dicen cuál existe sin stock', () => {
    const r = resumenDeTamanos(['Coca Cola Zero x1.75L', 'Coca Cola 1.75l'], ['Coca Cola Zero 2.25L', 'Coca Cola 2.25L']);
    expect(r).toMatch(/2,25 L \(SIN stock\)/);
    expect(r).toMatch(/1,75 L \(hay\)/);
    expect(r).toMatch(/NUNCA "no lo tenemos"/);
  });
  it('un solo tamaño no arma resumen', () => {
    expect(resumenDeTamanos(['Fernet Branca x750cc'], [])).toBeNull();
  });
});

describe('cantidades que pide el cliente', () => {
  it('"4 Malboro gold" son cuatro', () => {
    expect(cantidadesPedidas('Puede ser 4 Malboro gold el blanco y dorado')).toEqual([{ cantidad: 4, que: 'malboro gold el blanco y dorado' }]);
    expect(cantidadesPedidas('4 Malboro gold el blanco y dorado')).toEqual([{ cantidad: 4, que: 'malboro gold el blanco y dorado' }]);
    expect(cantidadesPedidas('Pero 4 necesito')).toEqual([]);
    expect(cantidadesPedidas('necesito 4 de fernet\n2 coca de 600')).toEqual([
      { cantidad: 4, que: 'fernet' }, { cantidad: 2, que: 'coca de 600' },
    ]);
    expect(cantidadesPedidas('dame dos quilmes porron')).toEqual([{ cantidad: 2, que: 'quilmes porron' }]);
  });
  it('una medida no es una cantidad', () => {
    expect(cantidadesPedidas('Coca zero de 2 litros 25')).toEqual([]);
    expect(cantidadesPedidas('2 litros de coca')).toEqual([]);
  });
});

import { emprolijarListado } from './prolijo';
describe('la lista: nombre y cuenta en un solo renglón', () => {
  it('une "• Nombre" + "• 2 × $X c/u = $Y"', () => {
    const r = emprolijarListado('Te paso lo que tengo:\n• Fernet Branca x750cc\n• 2 × $20.500 c/u = $41.000\n• Coca Cola 1.75l\n• 6 × $4.700 c/u = $28.200\n\nTotal: $69.200');
    expect(r).toContain('• Fernet Branca x750cc — 2 × $20.500 c/u = $41.000');
    expect(r).toContain('• Coca Cola 1.75l — 6 × $4.700 c/u = $28.200');
    expect(r).toContain('*Total: $69.200*');
  });
  it('no toca un renglón ya completo ni una pregunta', () => {
    const ok = '• Fernet Branca x750cc — 2 × $20.500 c/u = $41.000';
    expect(emprolijarListado(ok)).toBe(ok);
    expect(emprolijarListado('¿Cuántas querés?\n2 × $4.700 c/u = $9.400')).toContain('¿Cuántas querés?');
  });
});

describe('renglón con precio en efectivo', () => {
  it('la oración que sigue baja a su línea', () => {
    const r = emprolijarListado('Tengo dos:\n• Hibiki 700 cc — $290.000, o $261.000 en efectivo o transferencia\n• Kamiki 750 cc — $430.000, o $387.000 en efectivo o transferencia Suntory está sin stock por ahora.');
    expect(r).toContain('• Kamiki 750 cc — $430.000, o $387.000 en efectivo o transferencia\n\nSuntory está sin stock por ahora.');
    expect(r).toContain('• Hibiki 700 cc — $290.000, o $261.000 en efectivo o transferencia\n• Kamiki');
  });
});

describe('el total en mitad de una oración no se desarma (1/10/2026)', () => {
  it('"el total queda en $X (en efectivo: $Y)" queda como está', () => {
    const t = 'Con el maní pelado, el total queda en $88.300 (en efectivo o transferencia: $84.200). ¿Te sumo la de 5 kg?';
    expect(emprolijarListado(t)).toBe(t);
  });
  it('la etiqueta Total sigue en su renglón y en negrita', () => {
    expect(emprolijarListado('• A — 1 × $1.000 c/u = $1.000 Total: $1.000')).toContain('*Total: $1.000*');
  });
});

describe('una pregunta adentro de un paréntesis no parte el renglón (banco 1/10/2026)', () => {
  it('queda en su renglón', () => {
    const t = '• 10 × Villavicencio sin gas 2 L (va por botella suelta, no por pack: ¿te anoto 10 botellas?)';
    expect(emprolijarListado(t)).toBe(t);
  });
  it('la pregunta suelta al final del renglón sigue bajando', () => {
    expect(emprolijarListado('• Hielo 15 kg (se compra en el mostrador) ¿Cuántas necesitás?')).toContain('\n\n¿Cuántas necesitás?');
  });
});
