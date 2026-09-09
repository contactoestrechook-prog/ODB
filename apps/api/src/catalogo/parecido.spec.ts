import { pareceElMismoProducto, esBasura, palabras } from './parecido';

// Los casos reales de la primera corrida del 9/9/2026: 263 fotos traídas por
// código de barras, de las que ~9 eran de otro producto.
describe('pareceElMismoProducto', () => {
  const mal: [string, string, string?][] = [
    ['Viña Cobos Vinculum Chardonnay x750cc', '7792951118967 POLACRIN TALENTO LATEX INT/EXT', 'POLACRIN'],
    ['Alcauciles Condimentadas Familia Gullo', '7792951118967 POLACRIN TALENTO LATEX INT/EXT', 'POLACRIN'],
    ['Luigi Bosca De Sangre MAGNUM Cabernet Sauvignon', 'DOWEN PAGIO TALADRO PERCUTOR 13 MM 1100 WATTS', null as any],
    ['Phillip Morris Comun x 20', 'DOWEN PAGIO BATRERÍA 12 Vcc - 1.5 Ah LI-ION', null as any],
    ['Sal Fuegos & Sabores con mostaza y romero', 'Creatina Monohidratada', 'Eclipse Music'],
    ['Domain Bousquet Reserva Cabernet Franc x750cc', 'Limpia Pisos Blanco Procenez 1800ml', null as any],
    ['Limoncello Iltico Intenso', '1/6 Oz Pink Glass Roller Bottles 6 Pack 5ml', null as any],
    ['Gelato XL granizado choco intenso x 500 gr', 'Helado Chocotorta Aguila 500g', null as any],
  ];
  it.each(mal)('marca como dudoso: %s → %s', (nuestro, externo, marca) => {
    expect(pareceElMismoProducto(nuestro, externo, marca ?? null).parecido).toBe(false);
  });

  const bien: [string, string, string?][] = [
    ['Prestobarba Gillete Mach 3 Repuesto x1Un', 'Repuestos De Afeitar Gillette Mach3 Sensitive', 'Gillette'],
    ['Dececco Pasatta di Pomodoro x 700 gr', 'Passata Classica', 'De Cecco'],
    ['Queso Crema Ligth philadelphia x 300G', 'Cream Cheese', 'Philadelphia'],
    ['Dececco Fetuccini al huevo x 250 gr', 'Egg Fettucine', 'De Cecco'],
    ['Sky x750cc', 'Vodka Original 750 Ml Skyy', 'Skyy'],
    ['Raffaelo x 3u', 'Raffaello', 'Ferrero'],
    ['Bonomo Montiel Brut Nature x750cc', 'Espumante Bonomo & Montiel 750ml', null as any],
    ['Chandon Extra Brut', 'Espumante Chandon Extra Brut 750 Ml', 'Chandon'],
    ['Taittinger Brut', '75CL Champagne Brut Reserve Taittinger', 'Taittinger'],
    ['Queso Untable Sabor Fontina La Paulina', 'Queso Untable Sabor Fontina 190 Grs x 1 Un La Paulina', 'La Paulina'],
  ];
  it.each(bien)('acepta: %s → %s', (nuestro, externo, marca) => {
    expect(pareceElMismoProducto(nuestro, externo, marca ?? null).parecido).toBe(true);
  });

  it('sin nombre de algún lado, no se guarda sola', () => {
    expect(pareceElMismoProducto('Chandon Extra Brut', '').parecido).toBe(false);
    expect(pareceElMismoProducto('', 'Chandon Extra Brut').parecido).toBe(false);
  });

  it('el motivo dice en qué coincidió', () => {
    expect(pareceElMismoProducto('Chandon Extra Brut', 'Espumante Chandon 750', null).motivo).toMatch(/chandon/);
  });
});

describe('esBasura', () => {
  it('detecta la ficha que arranca con otro código de barras', () => {
    expect(esBasura('7792951118967 POLACRIN TALENTO LATEX')).toBe(true);
    expect(esBasura('Chandon Extra Brut')).toBe(false);
    expect(esBasura('7up Soda Cherry')).toBe(false);
  });
});

describe('palabras', () => {
  it('descarta gramajes, medidas y palabras de relleno', () => {
    expect([...palabras('Queso Crema Ligth philadelphia x 300G')]).toEqual(['queso', 'crema', 'philadelphia']);
  });
});
