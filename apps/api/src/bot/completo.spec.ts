import { conPreguntaDeCompleto, diceQueEstaCompleto, elegirPorDefecto, faltaElegirVariante, puedeCotizar } from './completo';

const PREGUNTA = '• 2 × Fernet Branca 750 cc\n• 6 × Coca Cola Zero 1,75 L\n\n¿Está completo el pedido o querés sumar algo?';

describe('el pedido se confirma completo antes de los precios', () => {
  it('un pedido nuevo NO se cotiza de una', () => {
    expect(puedeCotizar('Quiero 2 fernet branca de 750 y 6 coca zero', [])).toBe(false);
    expect(puedeCotizar('Puede ser 4 Malboro gold', ['Buenas tardes, ¿qué necesitás?'])).toBe(false);
  });
  it('el sí a "¿está completo?" habilita los precios', () => {
    for (const t of ['si', 'Sí', 'sí, eso es todo', 'dale', 'nada más', 'es todo', 'no, nada más', 'listo', 'así está bien']) expect(puedeCotizar(t, [PREGUNTA])).toBe(true);
  });
  it('si suma algo, se vuelve a preguntar', () => {
    expect(puedeCotizar('sumale 2 hielos', [PREGUNTA])).toBe(false);
    expect(diceQueEstaCompleto('agregale una picada')).toBe(false);
  });
  it('si el primer mensaje ya dice que es todo, o pregunta un precio, se cotiza', () => {
    expect(puedeCotizar('2 fernet y 3 cocas, eso es todo', [])).toBe(true);
    expect(puedeCotizar('cuánto me salen 3 fernet?', [])).toBe(true);
  });
  it('con precios ya mostrados, un cambio se cotiza directo', () => {
    expect(puedeCotizar('y sumale 1 smirnoff', ['• Fernet — 2 × $20.500 c/u = $41.000\n*Total: $41.000*\n¿Lo retirás o te lo enviamos?'])).toBe(true);
    expect(puedeCotizar('envío a Los Talas 15', ['...\n¿Lo confirmo?'])).toBe(true);
  });
  it('otras formas de preguntar si está completo', () => {
    expect(puedeCotizar('sí', ['• 2 × Fernet\n• 1 × Smirnoff\n\n¿Eso sería todo?'])).toBe(true);
    expect(puedeCotizar('si', ['¿Algo más?'])).toBe(true);
    expect(puedeCotizar('sí', ['• 2 × Fernet\n• 1 × Smirnoff\n\n¿Con eso cerramos?'])).toBe(true);
  });
  it('confirmó completo y después eligió variantes: se cotiza, no se vuelve a preguntar', () => {
    const bot = ['Me faltan dos definiciones: ¿qué Lays? ¿Maní con o sin cáscara?', PREGUNTA];
    expect(puedeCotizar('las clásicas de 134 y el pelado', bot, ['Necesito: 2 fernet...', 'sí, es todo'])).toBe(true);
    expect(puedeCotizar('las clásicas de 134 y el pelado', bot, ['Necesito: 2 fernet...'])).toBe(false);
  });
});

describe('la lista de lo anotado siempre termina con la pregunta', () => {
  it('se agrega si falta', () => {
    expect(conPreguntaDeCompleto('Te anoto:\n• 2 × Fernet Branca 750 cc\n• 1 × Smirnoff 700 cc')).toMatch(/¿Está completo el pedido o querés sumar algo\?$/);
  });
  it('no se toca si ya pregunta algo, si tiene precios o si no es una lista', () => {
    const conPregunta = '• 2 × Fernet\n\n¿Eso sería todo?';
    expect(conPreguntaDeCompleto(conPregunta)).toBe(conPregunta);
    const conPrecio = '• Fernet — 2 × $20.500 c/u = $41.000\nTotal: $41.000';
    expect(conPreguntaDeCompleto(conPrecio)).toBe(conPrecio);
    expect(conPreguntaDeCompleto('Recibido.')).toBe('Recibido.');
  });
});

describe('"es todo" no elige variantes', () => {
  const LISTA = 'Te anoto:\n• 2 × Fernet Branca 750 cc\n• 2 × Papas Lays — decime cuál: clásicas 134 g o 330 g\n• 1 × Maní King — con cáscara 400 g o pelado 350 g\n\n¿Está completo el pedido o querés sumar algo?';
  it('con opciones abiertas, "sí, es todo" no alcanza para cotizar', () => {
    expect(faltaElegirVariante('sí, es todo', [LISTA])).toBe(true);
    expect(faltaElegirVariante('si', [LISTA])).toBe(true);
  });
  it('si elige, o si no había nada para elegir, sigue normal', () => {
    expect(faltaElegirVariante('las clásicas de 134 y el pelado', [LISTA])).toBe(false);
    expect(faltaElegirVariante('sí, es todo', ['• 2 × Fernet Branca 750 cc\n• 6 × Coca Cola 1,75 L\n\n¿Está completo el pedido o querés sumar algo?'])).toBe(false);
  });
});

describe('los dos escapes del banco del 30/9', () => {
  it('"Sumado: 1 × Smirnoff" sin viñeta también lleva la pregunta', () => {
    expect(conPreguntaDeCompleto('Sumado: 1 × Smirnoff Vodka 700 cc.')).toMatch(/¿Está completo el pedido o querés sumar algo\?$/);
  });
  it('la lista que termina en «¿qué papas te preparo?» también frena el "es todo"', () => {
    const lista = 'Te anoté:\n• 2 × Fernet Branca 750 cc\n• 2 × Papas Lays (a definir variante)\n• 1 × Maní King (a definir variante)\n\n¿Qué papas Lays y qué Maní King te preparo?';
    expect(faltaElegirVariante('sí, es todo', [lista])).toBe(true);
  });
});

describe('"(a elegir)" también es una variante pendiente (banco 1/10/2026)', () => {
  it('frena el "es todo"', () => {
    const lista = 'Te anoto:\n• 2 × Fernet Branca 750 cc\n• 2 × Papas Lays (a elegir)\n• 1 × Maní King (a elegir)\n\n¿Me confirmás las variantes de esos: papas (134 g o 330 g) y Maní King (con cáscara o pelado)?';
    expect(faltaElegirVariante('sí, es todo', [lista])).toBe(true);
  });
});

describe('confirmó completo y después eligió variantes, aunque la última pregunta fuera otra', () => {
  it('se cotiza', () => {
    const bot = ['Me falta una sola definición: qué Lays, qué maní y qué hielo.', 'Te anoto:\n• 2 × Fernet\n• 1 × Hielo (falta definir tamaño)\n\n¿Qué hielo preferís?'];
    expect(puedeCotizar('las clásicas de 134, el maní pelado y el hielo de 15 kg', bot, ['Necesito: …', 'sí, es todo'])).toBe(true);
  });
});

describe('la lista terminó en otra pregunta: "es todo" no la contesta', () => {
  it('frena', () => {
    const lista = 'Te anoto:\n• 2 × Fernet Branca 750 cc\n• 1 × Hielo (bolsa de 5 kg o de 15 kg)\n• 2 × Papas Lays (clásicas 134 g o 330 g)\n\n¿Me confirmás qué presentación querés en el hielo y las papas?';
    expect(faltaElegirVariante('sí, es todo', [lista])).toBe(true);
  });
  it('si la última pregunta es la de completo, no frena', () => {
    expect(faltaElegirVariante('sí, es todo', ['• 2 × Fernet\n• 6 × Coca Cola 1,75 L\n\n¿Está completo el pedido o querés sumar algo?'])).toBe(false);
  });
});

describe('por defecto, el más vendido (Leandro, 1/10/2026)', () => {
  const v: Record<string, number> = { L124: 83, L150: 6, L151: 5, L2720: 41, L12343: 9, L2766: 96, L3459: 72, L6347: 58 };
  const vendidas = (sku: string) => v[sku] ?? 0;
  it('Baron B → Extra Brut, Savora → 250 g, Manteca → La Serenísima 200 g', () => {
    expect(elegirPorDefecto([{ sku: 'L150' }, { sku: 'L124' }, { sku: 'L151' }], vendidas)?.sku).toBe('L124');
    expect(elegirPorDefecto([{ sku: 'L12343' }, { sku: 'L2720' }], vendidas)?.sku).toBe('L2720');
    expect(elegirPorDefecto([{ sku: 'L6347' }, { sku: 'L3459' }, { sku: 'L2766' }], vendidas)?.sku).toBe('L2766');
  });
  it('sin ventas no hay defecto', () => {
    expect(elegirPorDefecto([{ sku: 'X' }, { sku: 'Y' }], vendidas)).toBeNull();
  });
});

describe('el por defecto coincide con lo pedido', () => {
  const vend: Record<string, number> = { H: 500, B: 83, BN: 6, D: 900, C: 40, S: 300, L: 12 };
  const v = (sku: string) => vend[sku] ?? 0;
  it('"champaña baron b" no elige un Havana añejo aunque se venda más', () => {
    const items = [{ sku: 'H', nombre: 'Havana añejo' }, { sku: 'B', nombre: 'Baron B Extra Brut' }, { sku: 'BN', nombre: 'Baron B Brut Nature' }];
    expect(elegirPorDefecto(items, v, 'champaña baron b')?.sku).toBe('B');
  });
  it('"galletitas de arroz cerealitas" → Cerealitas, no Don Satur', () => {
    const items = [{ sku: 'D', nombre: 'Galletitas Don Satur Bizcocho de Grasa x 200 gr' }, { sku: 'C', nombre: 'Galletitas de arroz Cerealitas x 100 gr' }];
    expect(elegirPorDefecto(items, v, 'galletitas de arroz cerealitas')?.sku).toBe('C');
  });
  it('"lysoform aerosol" sin Lysoform en los resultados: no hay defecto', () => {
    const items = [{ sku: 'S', nombre: 'Aromatizante Saphirus Difusor VARIOS' }];
    expect(elegirPorDefecto(items, v, 'lysoform aerosol')?.sku ?? null).toBe(null);
  });
});

describe('contestar el cierre es dar el pedido por completo (Leandro, 10/10/2026: «me vuelve a preguntar si está completo, cansa»)', () => {
  const LISTA = 'Estos productos no los tengo disponibles ahora en la cantidad que pediste:\n• 10 × Té verde Twinings x 10\n¿Lo retirás en la sucursal Saint Thomas o te lo enviamos?';
  it('«Leandro» al «¿A nombre de quién?» después de la lista: ya se puede cotizar', () => {
    const bot = ['¿A nombre de quién preparo el pedido para retirar en la sucursal Saint Thomas?', LISTA];
    expect(puedeCotizar('Leandro', bot, ['los retiro'])).toBe(true);
  });
  it('«los retiro» al «¿Lo retirás o te lo enviamos?» después de la lista: ya se puede cotizar', () => {
    expect(puedeCotizar('los retiro', [LISTA], [])).toBe(true);
  });
  it('si con eso suma o cambia algo, todavía no', () => {
    expect(puedeCotizar('los retiro, sumame 2 aguas', [LISTA], [])).toBe(false);
  });
  it('sin una lista antes, no', () => {
    expect(puedeCotizar('Leandro', ['¿A nombre de quién lo preparo?'], [])).toBe(false);
  });
});
