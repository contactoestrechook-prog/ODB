import { ordenarPorRelevancia, puntajeRelevancia } from './relevancia';

// Caso real (Leandro, 15/9/2026): cargando una factura buscó "leche la sere"
// para vincular "LECHE LS ULTRA ENTERA 3% FORT SACHET 1L" y el desplegable
// mostraba dulces de leche; la leche quedaba abajo o afuera.
const CATALOGO = [
  { nombre: 'Dulce de Leche La Serenisima Colonial 400gr', sku: 'L2429', activo: true },
  { nombre: 'Dulce de Leche La Serenisima Colonial x 250', sku: 'L5758', activo: true },
  { nombre: 'Dulce de Leche La Serenisima Dubai 250gr', sku: 'L11826', activo: true },
  { nombre: 'Dulce de Leche La Serenisima Zero Lactosa x 250gr', sku: 'L10501', activo: true },
  { nombre: 'Leche La Serenisima 1% descremada  SACHET x 1lt', sku: 'L5757', activo: true },
  { nombre: 'Leche La Serenisima 3% clasica  sachet  x 1lt', sku: 'L5756', activo: true },
  { nombre: 'Leche La Serenisima 3% clasica sachet x 1lt', sku: '5756', activo: false }, // duplicado viejo
  { nombre: 'Leche La Serenisima entera Clasica 3% botella x 1LT', sku: 'L2431', activo: true },
  { nombre: 'Crema de Leche La Serenisima Tetra x 520 gr', sku: 'L3761', activo: true },
];

describe('búsqueda de productos — relevancia', () => {
  it('"leche la sere": las leches van primero, los dulces después', () => {
    const r = ordenarPorRelevancia(CATALOGO, 'leche la sere');
    expect(r[0].nombre).toMatch(/^Leche La Serenisima/);
    // las 3 leches activas van antes que cualquier dulce o crema
    expect(r.slice(0, 3).every((p) => /^Leche La Serenisima/.test(p.nombre))).toBe(true);
    expect(r.findIndex((p) => p.nombre.startsWith('Dulce'))).toBe(3);
  });

  it('los productos dados de baja van siempre al final', () => {
    const r = ordenarPorRelevancia(CATALOGO, 'leche la serenisima 3% sachet');
    expect(r[r.length - 1].activo).toBe(false);
    expect(r[0].sku).toBe('L5756');
  });

  it('las palabras en cualquier orden encuentran el producto', () => {
    const r = ordenarPorRelevancia(CATALOGO, 'sachet leche 3%');
    expect(r[0].nombre).toContain('3% clasica');
  });

  it('el SKU exacto gana a cualquier coincidencia de nombre', () => {
    const r = ordenarPorRelevancia(CATALOGO, 'l2431');
    expect(r[0].sku).toBe('L2431');
  });

  it('el nombre exacto puntúa más que uno que solo lo contiene', () => {
    expect(puntajeRelevancia('Leche entera', 'leche entera')).toBeGreaterThan(
      puntajeRelevancia('Dulce de Leche entera especial edicion', 'leche entera'),
    );
  });
});
