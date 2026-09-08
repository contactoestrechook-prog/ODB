import { elegirProveedor, tokensDistintivos } from './proveedor-match';

const base = [
  { id: 'vistalba', razon_social: 'BODEGA VISTALBA S.A.', cuit: '30705166923' },
  { id: 'galletitas', razon_social: 'Distribuidora Galletitas del Sur', cuit: '30111111111' },
  { id: 'maniking', razon_social: 'MANI KING', cuit: null },
  { id: 'baires', razon_social: 'Baires Distribuciones', cuit: '30222222222' },
];

describe('elegirProveedor — el caso Diamandes/Vistalba (2026-09-08)', () => {
  it('"bodega" es genérica: otra bodega NO es el mismo proveedor', () => {
    expect(elegirProveedor({ nombre: 'BODEGA DIAMANDES S.A.', cuit: '30699582855' }, base)).toBeNull();
    expect(elegirProveedor({ nombre: 'BODEGA DIAMANDES S.A.', cuit: null }, base)).toBeNull();
  });
  it('el CUIT exacto manda, aunque el nombre esté escrito distinto', () => {
    expect(elegirProveedor({ nombre: 'Vistalba Wines', cuit: '30-70516692-3' }, base)?.id).toBe('vistalba');
  });
  it('por nombre: la parte distintiva del candidato está en lo leído', () => {
    expect(elegirProveedor({ nombre: 'Distribuidora de Galletitas y Alimentos del Sur SA', cuit: null }, [base[1], base[2]])?.id).toBe('galletitas');
    expect(elegirProveedor({ nombre: 'Mani King SRL', cuit: null }, base)?.id).toBe('maniking');
    expect(elegirProveedor({ nombre: 'Baires Distribuciones Sur S.A.', cuit: null }, base)?.id).toBe('baires');
  });
  it('mismo nombre pero CUIT distinto: no es el mismo (candado 1)', () => {
    expect(elegirProveedor({ nombre: 'Distribuidora Galletitas del Sur', cuit: '30555555555' }, base)).toBeNull();
  });
  it('compartir solo palabras genéricas no vincula', () => {
    expect(elegirProveedor({ nombre: 'Distribuidora del Sur Alimentos SA', cuit: null }, base)).toBeNull();
  });
  it('tokens distintivos ignoran tildes, siglas y genéricas', () => {
    expect(tokensDistintivos('Bodega Fincas Diamándes S.A.')).toEqual(['diamandes']);
  });
});
