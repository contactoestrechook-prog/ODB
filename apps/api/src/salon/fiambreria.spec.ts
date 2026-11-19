import { esDeFiambreria, parteDeFiambreria } from './salon.service';

// Ventana de fiambrería (Leandro, 19/11/2026: «también a fiambrería si es que
// hay algo de fiambrería, así lo preparan»)
const item = (nombre: string, categoria: string | null, cantidad = 1, porPeso = false) =>
  ({ cantidad, producto: { sku: nombre.slice(0, 3), nombre, vendido_por_peso: porPeso, categoria: categoria ? { nombre: categoria } : null } });

describe('fiambrería: qué le toca', () => {
  it('reconoce las categorías sin importar mayúsculas ni tildes', () => {
    expect(esDeFiambreria('Fiambres')).toBe(true);
    expect(esDeFiambreria('quesos')).toBe(true);
    expect(esDeFiambreria(' Chacinados ')).toBe(true);
    expect(esDeFiambreria('Vinos Tintos Malbec')).toBe(false);
    expect(esDeFiambreria(null)).toBe(false);
  });

  it('un pedido sin fiambrería no le llega', () => {
    expect(parteDeFiambreria({ id: 'p1', items: [item('Fernet 750', 'Aperitivos'), item('Coca 2,25', 'Gaseosas')] })).toBeNull();
  });

  it('de un pedido mixto le pasa solo lo suyo y cuenta el resto', () => {
    const p = parteDeFiambreria({
      id: 'abcdef1234', qr_retiro: null, canal: 'domicilio', destino_direccion: 'Los Pinos 123', creado_en: '2026-11-19T18:00:00Z',
      cliente: { nombre: 'Marta' },
      items: [item('Jamón Crudo Campo Austral', 'Fiambres', 0.25, true), item('Malbec', 'Vinos Tintos Malbec', 2), item('Queso Tybo x fraccion', 'quesos', 0.3, true), item('Picada ODB XL', 'Fiambres')],
    })!;
    expect(p.codigo).toBe('ABCDEF12');
    expect(p.cliente).toBe('Marta');
    expect(p.envio).toBe('Los Pinos 123');
    expect(p.items.map((i) => i.nombre)).toEqual(['Jamón Crudo Campo Austral', 'Queso Tybo x fraccion', 'Picada ODB XL']);
    expect(p.items[0]).toMatchObject({ cantidad: 0.25, porPeso: true });
    expect(p.otros).toBe(1);
  });

  it('retiro en el local: sin dirección', () => {
    const p = parteDeFiambreria({ id: 'p2', canal: 'pickup', contacto_nombre: 'Juan', items: [item('Salamín Ponce', 'Chacinados', 1, true)] })!;
    expect(p.envio).toBeNull();
    expect(p.cliente).toBe('Juan');
  });
});
