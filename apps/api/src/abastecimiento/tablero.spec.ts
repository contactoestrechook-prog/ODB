import { armarTablero, COSTO_MINIMO, estadoDe } from './tablero';

// El tablero del Analista ODB (2/10/2026): las cifras por proveedor que dibuja
// la pantalla. Tienen que coincidir con las notas de pedido de "Qué comprar".

const fila = (x: any = {}) => ({
  producto_id: 'p1', sku: 'L1', nombre: 'Leche Zero 1L', sucursal_id: 'st', sucursal: 'Suc Sant Thomas',
  stock: 0, en_camino: 0, ritmo_dia: 5, ritmo_fuente: 'sistema viejo, período hasta 21/07/2026', ritmo_hasta: '2026-07-21',
  cobertura_dias: 0, proveedor_id: 'pv1', proveedor: 'La Serenísima', proveedor_faltan: ['teléfono / WhatsApp'],
  plazo_dias: 7, plazo_fuente: 'sin confirmar: 7 días por defecto', alerta: 'sin_stock', urgencia: 1000,
  cantidad_sugerida: 10, ultimo_costo: 1000, ...x,
});
const AHORA = new Date('2026-10-02T12:00:00Z').getTime();

describe('tablero: lo que hay que comprar, por proveedor', () => {
  it('parte la plata entre urgente y lo que puede esperar, y la reparte por sucursal', () => {
    const t = armarTablero([
      fila(),
      fila({ sku: 'L2', alerta: 'no_llega', cantidad_sugerida: 5, ultimo_costo: 2000 }),
      fila({ sku: 'L3', alerta: 'menos_de_12', cantidad_sugerida: 4, ultimo_costo: 500, sucursal: 'Suc Santa Ines', sucursal_id: 'si' }),
      fila({ sku: 'L4', alerta: null, cantidad_sugerida: 2, ultimo_costo: 1000 }), // sin alerta: NO está en las notas, no suma
    ], new Map(), AHORA);
    const p = t.compras.proveedores[0];
    expect(p).toMatchObject({ proveedor: 'La Serenísima', productos: 3, urgentes: 2, plata: 10000 + 10000 + 2000, plataUrgente: 20000 });
    expect(p.porSucursal).toEqual([{ sucursal: 'Saint Thomas', plata: 20000 }, { sucursal: 'Santa Inés', plata: 2000 }]);
    expect(t.compras.total).toBe(22000);
    expect(t.compras.totalUrgente).toBe(20000);
  });

  it('redondea la cantidad como la nota de pedido (13,2 → 14)', () => {
    const t = armarTablero([fila({ cantidad_sugerida: 13.2 })], new Map(), AHORA);
    expect(t.compras.proveedores[0].plata).toBe(14000);
  });

  it(`un costo nulo o menor a $${COSTO_MINIMO} va a revisar y no suma`, () => {
    const t = armarTablero([fila({ ultimo_costo: 36.5 }), fila({ sku: 'L2', ultimo_costo: null }), fila({ sku: 'L3' })], new Map(), AHORA);
    const p = t.compras.proveedores[0];
    expect(p.aRevisar).toBe(2);
    expect(p.plata).toBe(10000);
    expect(p.productos).toBe(3);
  });

  it('lo que no tiene proveedor va solo a sinProveedor', () => {
    const t = armarTablero([fila({ proveedor_id: null, proveedor: null }), fila({ sku: 'L2', proveedor_id: null, proveedor: null, alerta: 'menos_de_12' })], new Map(), AHORA);
    expect(t.compras.proveedores).toHaveLength(0);
    expect(t.compras.sinProveedor).toEqual({ productos: 2, urgentes: 1 });
  });

  it('dice de cuándo son las ventas y si los plazos son provisorios', () => {
    const t = armarTablero([fila(), fila({ proveedor_id: 'pv2', plazo_fuente: 'declarado por el proveedor' })], new Map(), AHORA);
    expect(t.datos.ventasHasta).toBe('2026-07-21');
    expect(t.datos.datoViejo).toBe(true);
    expect(t.datos.plazosProvisorios).toEqual({ provisorios: 1, total: 2 });
  });
});

describe('tablero: la plata parada', () => {
  it('lo que no se vende vale stock × costo; lo que sobra, lo que pasa de 90 días', () => {
    const t = armarTablero([
      fila({ stock: 10, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultimo_costo: 100 }), // quieto: 1000
      fila({ sku: 'L2', stock: 100, ritmo_dia: 0.5, cobertura_dias: 200, alerta: null, cantidad_sugerida: 0, ultimo_costo: 10 }), // sobra (100 − 45) × 10 = 550
      fila({ sku: 'L3', stock: 20, ritmo_dia: 1, cobertura_dias: 20, alerta: null, cantidad_sugerida: 0 }), // ni una cosa ni la otra
    ], new Map(), AHORA);
    expect(t.parado.totalQuieto).toBe(1000);
    expect(t.parado.totalSobra).toBe(550);
    expect(t.parado.proveedores[0]).toMatchObject({ quietos: 1, sobran: 1, masCaro: { nombre: 'Leche Zero 1L', plata: 1000 } });
  });

  it('sin último costo usa el del catálogo; sin ninguno, cuenta como sin valorizar', () => {
    const t = armarTablero([
      fila({ stock: 5, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultimo_costo: null }),
      fila({ sku: 'L2', producto_id: 'p2', stock: 5, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultimo_costo: null }),
    ], new Map([['p1', 200]]), AHORA);
    expect(t.parado.totalQuieto).toBe(1000);
    expect(t.parado.sinValorizar).toBe(1);
  });
});

describe('tablero: un producto no está a la vez en COMPRAS y en PLATA PARADA', () => {
  it('un "menos de 12" que no se vende va a compras (esperar), no a plata parada', () => {
    const t = armarTablero([fila({ alerta: 'menos_de_12', ritmo_dia: 0, stock: 3, cantidad_sugerida: 9, ultimo_costo: 1000 })], new Map(), AHORA);
    expect(t.compras.proveedores[0].productos).toBe(1);
    expect(t.parado.totalQuieto).toBe(0);
    expect(t.parado.proveedores).toHaveLength(0);
  });
});

describe('tablero: lo comprado después del último reporte de ventas', () => {
  it('con ritmo 0 no se sabe si se vende: no va a plata parada (192 Red Bull recibidos el 2/10)', () => {
    const t = armarTablero([fila({ stock: 192, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultimo_costo: 2521, ultima_compra: '2026-10-02' })], new Map(), AHORA);
    expect(t.parado.totalQuieto).toBe(0);
    expect(estadoDe(fila({ stock: 192, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultima_compra: '2026-10-02' }))).toBe('ok');
    // comprado ANTES del reporte y sin ventas en el período: sí está parado
    expect(estadoDe(fila({ stock: 5, ritmo_dia: 0, alerta: null, cantidad_sugerida: 0, ultima_compra: '2026-06-01' }))).toBe('muerto');
  });
});

describe('estado de cada renglón (la forma de siempre del Analista)', () => {
  it('urgente → quiebre; menos de 12 o con sugerido → reponer; sin ventas con stock → muerto; más de 90 días → sobrestock', () => {
    expect(estadoDe(fila())).toBe('quiebre_inminente');
    expect(estadoDe(fila({ alerta: 'no_llega' }))).toBe('quiebre_inminente');
    expect(estadoDe(fila({ alerta: 'menos_de_12', ritmo_dia: 0 }))).toBe('reponer');
    expect(estadoDe(fila({ alerta: null, cantidad_sugerida: 3 }))).toBe('reponer');
    expect(estadoDe(fila({ alerta: null, cantidad_sugerida: 0, stock: 4, ritmo_dia: 0 }))).toBe('muerto');
    expect(estadoDe(fila({ alerta: null, cantidad_sugerida: 0, stock: 100, ritmo_dia: 1, cobertura_dias: 91 }))).toBe('sobrestock');
    expect(estadoDe(fila({ alerta: null, cantidad_sugerida: 0, stock: 89, ritmo_dia: 1, cobertura_dias: 89 }))).toBe('ok');
  });
});
