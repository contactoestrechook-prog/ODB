import { cartelPedido, leerResumenDePedido, nombreParaCartel } from './cartel-pedido';

const RESUMEN = [
  '• Fernet Branca  x750cc — 2 × $20.500 c/u = $41.000',
  '• Coca Cola Zero x1.75L — 6 × $4.700 c/u = $28.200',
  '• Hielo Bolsa 15KG — 1 × $14.000 c/u = $14.000',
  '',
  '*Total: $83.200*',
  'Envío sin cargo a Los Talas 15. Recibe Catalina.',
  '¿Lo confirmo?',
].join('\n');

describe('cartel del pedido (diseño Placa roja)', () => {
  it('nombres como se leen', () => {
    expect(nombreParaCartel('Fernet Branca  x750cc')).toBe('Fernet Branca 750 cc');
    expect(nombreParaCartel('Coca Cola Zero x1.75L')).toBe('Coca Cola Zero 1,75 L');
    expect(nombreParaCartel('Hielo Bolsa 15KG')).toBe('Hielo Bolsa 15 kg');
    expect(nombreParaCartel('Papas Fritas clasicas Lays x 134 gr')).toBe('Papas Fritas clasicas Lays 134 g');
    expect(nombreParaCartel('Mani pelado Mani King  x 350g')).toBe('Mani pelado Mani King 350 g');
  });

  it('lee renglones, total y entrega; lo demás va de epígrafe', () => {
    const r = leerResumenDePedido(RESUMEN)!;
    expect(r.renglones).toEqual([
      { nombre: 'Fernet Branca 750 cc', cantidad: 2, unitario: 20500, subtotal: 41000 },
      { nombre: 'Coca Cola Zero 1,75 L', cantidad: 6, unitario: 4700, subtotal: 28200 },
      { nombre: 'Hielo Bolsa 15 kg', cantidad: 1, unitario: 14000, subtotal: 14000 },
    ]);
    expect(r.total).toBe(83200);
    expect(r.entrega).toEqual({ titulo: 'Envío sin cargo', detalle: 'Los Talas 15 · recibe Catalina' });
    expect(r.confirmar).toBe(true);
    expect(r.pie).toBe('¿Lo confirmo?');
  });

  it('retiro en la sucursal', () => {
    const r = leerResumenDePedido(RESUMEN.replace('Envío sin cargo a Los Talas 15. Recibe Catalina.', 'Retiro en la sucursal Saint Thomas.'))!;
    expect(r.entrega?.titulo).toBe('Retiro en la sucursal Saint Thomas');
  });

  it('sin cartel: un solo producto, sin total, un renglón ilegible o cuentas que no cierran', () => {
    expect(leerResumenDePedido('• Fernet Branca x750cc — 2 × $20.500 c/u = $41.000\nTotal: $41.000')).toBeNull();
    expect(leerResumenDePedido(RESUMEN.replace('*Total: $83.200*', ''))).toBeNull();
    expect(leerResumenDePedido(RESUMEN.replace('• Hielo Bolsa 15KG — 1 × $14.000 c/u = $14.000', '• Hielo: de 5 kg no tengo stock'))).toBeNull();
    expect(leerResumenDePedido(RESUMEN.replace('$83.200', '$90.000'))).toBeNull();
  });

  it('cantidades por peso', () => {
    const r = leerResumenDePedido('• Jamón crudo — 0,5 × $39.000 c/u = $19.500\n• Queso — 1 × $10.000 c/u = $10.000\nTotal: $29.500')!;
    expect(r.renglones[0].cantidad).toBe(0.5);
  });

  it('dibuja la imagen', async () => {
    const png = await cartelPedido(leerResumenDePedido(RESUMEN)!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(20_000);
  });

  // 26/9/2026: la tarjeta no salía nunca porque el bot escribe el total con texto
  // pegado. Estos son textos REALES que mandó en producción.
  it('el total con texto pegado en el mismo renglón (real, 25/9)', () => {
    const real = [
      '• Fernet Branca 450 — 1 × $13.500 c/u = $13.500',
      '• Coca Cola 1.75l — 1 × $4.700 c/u = $4.700',
      '',
      '*Total: $18.200* (envío sin cargo) El reparto de hoy ya cerró, así que el envío saldría mañana viernes. Pasame la dirección dentro de Solar del Bosque (calle y número o lote) y el nombre de quien recibe.',
    ].join('\n');
    const r = leerResumenDePedido(real)!;
    expect(r).not.toBeNull();
    expect(r.total).toBe(18200);
    expect(r.renglones).toHaveLength(2);
    expect(r.entrega?.titulo).toBe('Envío sin cargo');
    expect(r.entrega?.detalle ?? '').not.toMatch(/recibe y/);        // "quien recibe y la dirección" no es un nombre
    expect(r.pie).toContain('El reparto de hoy ya cerró');             // lo que seguía al monto va de epígrafe
    expect(r.pie).not.toMatch(/Total/);
    expect(r.pie).not.toMatch(/^\(env[ií]o sin cargo\)/i);           // no se repite lo que muestra el recuadro
  });

  it('"el envío es sin cargo" en otra oración (real, 24/9)', () => {
    const real = [
      'Por ahora queda así:',
      '',
      '• Coca Cola Zero x1.75L — 4 × $4.700 c/u = $18.800',
      '• Pan al peso — 1 × $4.500 c/u = $4.500',
      '',
      'Total: $23.300 (sin la picada, que se suma cuando tenga la confirmación). El envío es sin cargo.',
      '',
      'Para el delivery, pasame nombre de quien recibe y la dirección con calle y número.',
    ].join('\n');
    const r = leerResumenDePedido(real)!;
    expect(r.total).toBe(23300);
    expect(r.entrega).toEqual({ titulo: 'Envío sin cargo', detalle: null });
    expect(r.pie).toContain('sin la picada');
  });

  it('el envío con dirección y quién recibe, dichos al pasar', () => {
    const r = leerResumenDePedido('• A — 1 × $1.000 c/u = $1.000\n• B — 2 × $500 c/u = $1.000\nTotal: $2.000. Te lo llevamos con envío sin cargo a Los Talas 15. Recibe Catalina.')!;
    expect(r.entrega).toEqual({ titulo: 'Envío sin cargo', detalle: 'Los Talas 15 · recibe Catalina' });
  });

  it('el retiro ofrecido como alternativa no se toma como elegido', () => {
    const r = leerResumenDePedido('• A — 1 × $1.000 c/u = $1.000\n• B — 2 × $500 c/u = $1.000\nTotal: $2.000\nEl envío sin cargo a domicilio es desde $70.000; si no, podés retirarlo en la sucursal.')!;
    expect(r).not.toBeNull();
    expect(r.entrega).toBeNull();
  });
});


import { cartelListaPrecios, imagenEsperada, pieSinPrecios, preciosDeLaRespuesta } from './cartel-pedido';
describe('lista de precios como imagen (Karina, 30/9/2026)', () => {
  const REAL = 'Rones: Havana Blanco 3 años $17.800, Havana Añejo $20.300, Bacardi Blanco 1 L $25.700 (Brugal sin stock). Whisky: JW Red 1 L $46.900, Black 1 L $59.400, Jack Daniel\'s N° 7 750 cc $54.900.\nCampari 750 cc $12.500, Martini Rosso y Bianco $9.400 c/u. ¿Me pasás las cantidades?';
  const CATALOGO = [
    { sku: 'A', nombre: 'Ron Havana Club Blanco 3 Años x750cc', precio: 17800, precioEfectivo: 16020 },
    { sku: 'B', nombre: 'Ron Havana Club Añejo Especial x750cc', precio: 20300, precioEfectivo: 18270 },
    { sku: 'C', nombre: 'Ron Bacardi Blanco x1L', precio: 25700, precioEfectivo: 23130 },
    { sku: 'D', nombre: 'Whisky Johnnie Walker Red Label x1L', precio: 46900, precioEfectivo: 42210 },
    { sku: 'E', nombre: 'Whisky Johnnie Walker Black Label x1L', precio: 59400, precioEfectivo: 53460 },
    { sku: 'F', nombre: "Whiskey Jack Daniel's Old N°7 x750cc", precio: 54900, precioEfectivo: 49410 },
    { sku: 'G', nombre: 'Campari x750cc', precio: 12500, precioEfectivo: 11250 },
    { sku: 'H', nombre: 'Martini Rosso x1L', precio: 9400, precioEfectivo: 8460 },
    { sku: 'I', nombre: 'Martini Bianco x1L', precio: 9400, precioEfectivo: 8460 },
    { sku: 'J', nombre: 'Gaseosa Coca Cola x1.75L', precio: 9400 },          // mismo precio, no la nombró
    { sku: 'K', nombre: 'Whisky Chivas Regal 12 x750cc', precio: 70000 },  // consultado, no nombrado
  ];
  it('toma los nombrados con su precio del sistema, en orden, sin los que no nombró', () => {
    const r = preciosDeLaRespuesta(REAL, CATALOGO);
    expect(r.map((x) => x.sku)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  });
  it('el epígrafe queda con lo que no es precio', () => {
    expect(pieSinPrecios(REAL)).toBe('¿Me pasás las cantidades?');
  });
  it('dibuja la imagen', async () => {
    const png = await cartelListaPrecios(preciosDeLaRespuesta(REAL, CATALOGO), '01/10');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('la imagen correcta, con el producto correcto (banco 1/10/2026)', () => {
  const COCAS = [
    { sku: 'Z', nombre: 'Coca Cola Zero x1.75L', precio: 4700 },
    { sku: 'C', nombre: 'Coca Cola 1.75l', precio: 4700 },
    { sku: 'L', nombre: 'Coca Cola Light x1.75L', precio: 4700 },
  ];
  it('un resumen de un solo producto no arma lista de precios', () => {
    const t = '• Coca Cola 1.75l — 4 × $4.700 c/u = $18.800\nTotal: $18.800\nRetiro en la sucursal Saint Thomas.\n¿Lo confirmo?';
    expect(preciosDeLaRespuesta(t, COCAS)).toEqual([]);
    expect(imagenEsperada(t)).toBeNull();
  });
  it('mismo precio: gana el nombre que coincide', () => {
    const r = preciosDeLaRespuesta('• Coca Cola Zero 1,75 L — $4.700\n• Fernet — $20.500', [...COCAS, { sku: 'F', nombre: 'Fernet Branca x750cc', precio: 20500 }]);
    expect(r.map((x) => x.sku)).toEqual(['Z', 'F']);
  });
  it('con precio en efectivo entre paréntesis, cada producto una vez', () => {
    const t = '• Havana Club Blanco 3 años — $17.800 ($16.020)\n• Havana Añejo — $20.300 ($18.270)\n• Bacardi Blanco 1 L — $25.700 ($23.130)';
    const cat = [
      { sku: 'A', nombre: 'Ron Havana Club Blanco 3 Años x750cc', precio: 17800, precioEfectivo: 16020 },
      { sku: 'B', nombre: 'Ron Havana Club Añejo Especial x750cc', precio: 20300, precioEfectivo: 18270 },
      { sku: 'C', nombre: 'Ron Bacardi Blanco x1L', precio: 25700, precioEfectivo: 23130 },
    ];
    expect(preciosDeLaRespuesta(t, cat).map((x) => x.sku)).toEqual(['A', 'B', 'C']);
    expect(imagenEsperada(t)).toBe('precios');
  });
  it('qué imagen corresponde', () => {
    expect(imagenEsperada('• A — 2 × $1.000 c/u = $2.000\n• B — 1 × $500 c/u = $500\nTotal: $2.500')).toBe('resumen');
    expect(imagenEsperada('Pedido X confirmado. Total: $55.100.\nSe abona al retirar, $55.100 con tarjeta o $51.000 en efectivo o transferencia.')).toBeNull();
    expect(imagenEsperada('• Hibiki 700 cc — $290.000, o $261.000 en efectivo o transferencia\n• Kamiki 750 cc — $430.000, o $387.000 en efectivo o transferencia')).toBeNull();
    expect(imagenEsperada('Johnnie Walker Black Label 1 L: $59.400, o $53.460 en efectivo o transferencia.')).toBeNull();
  });
});

describe('el bot abrevia el producto por su medida', () => {
  it('"la de 600 cc y la lata de 355 están $2.500"', () => {
    const cat = [
      { sku: 'G', nombre: 'Coca Cola Zero x1.75L', precio: 4700 },
      { sku: 'S', nombre: 'Coca Cola Zero x600cc', precio: 2500 },
      { sku: 'L', nombre: 'Coca Cola Zero Lata x355ml', precio: 2500 },
    ];
    const r = preciosDeLaRespuesta('Coca Cola Zero 1,75 L $4.700, la de 600 cc $2.500 y la lata de 355 $2.500.', cat);
    expect(r.map((x) => x.sku)).toEqual(['G', 'S', 'L']);
  });
});
