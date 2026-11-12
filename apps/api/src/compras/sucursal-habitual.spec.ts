// La sucursal de la entrada no arranca vacía (12/11/2026).
// La lógica vive en apps/admin/app/lib/sucursal-habitual.ts.
import { sucursalHabitual } from '../../../admin/app/lib/sucursal-habitual';

const ST = { id: 'st', nombre: 'Suc Sant Thomas' };
const SI = { id: 'si', nombre: 'Suc Santa Ines' };
const ordenes = [
  { sucursal: { nombre: 'Suc Sant Thomas' } },
  { sucursal: { nombre: 'Suc Santa Ines' } },
  { sucursal: { nombre: 'Suc Sant Thomas' } },
  { sucursal: null },
];

describe('sucursal habitual de la entrada', () => {
  it('la última elegida en la compu manda', () => {
    expect(sucursalHabitual([ST, SI], ordenes, 'si')).toBe('si');
  });

  it('si la guardada ya no existe, va la que más órdenes tiene', () => {
    expect(sucursalHabitual([ST, SI], ordenes, 'borrada')).toBe('st');
  });

  it('sin nada guardado, la que más mercadería recibe', () => {
    expect(sucursalHabitual([SI, ST], ordenes, null)).toBe('st');
  });

  it('sin órdenes y con una sola sucursal, esa', () => {
    expect(sucursalHabitual([ST], [], null)).toBe('st');
  });

  it('sin órdenes y con varias, queda para elegir', () => {
    expect(sucursalHabitual([ST, SI], [], null)).toBe('');
  });
});
