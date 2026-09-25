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
});
