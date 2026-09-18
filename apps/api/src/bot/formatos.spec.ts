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
