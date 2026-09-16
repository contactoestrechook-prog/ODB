import { etiquetaVolumen, pideTamano, volumenMl } from './formatos';

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
