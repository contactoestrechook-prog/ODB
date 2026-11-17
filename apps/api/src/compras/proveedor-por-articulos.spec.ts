// EL PROVEEDOR POR SUS ARTÍCULOS y «EL PROVEEDOR ES BIMBO» (17/11/2026).
import { mismoArticulo, proveedorPorArticulos } from './proveedor-por-articulos';
import { claveArticulo } from './ficha-articulo';
import { proveedorPorNombre } from '../../../admin/app/lib/proveedor-por-nombre';
import { cuitValido, elegirProveedor } from './proveedor-match';

const BIMBO = 'bimbo';
const FARINA = 'farina';
// lo que quedó registrado del remito de Bimbo del 12/11 y de La Farina
const conocidos = [
  ...['BIMBO GDE. BLANCO', 'BIMBO CHICO BLANCO', 'PAN ARTESANO X 500', 'HAMBUR. ARTESANO', 'OROWEAT CEREAL', 'FARGO SALVADO CHICO', 'FARGO PAN ALL NATURAL', 'FARGO DOBLE INTEGRAL', 'GRANDE LACTAL CHICO BLANCO', 'PROTEIN RAPID']
    .map((d) => ({ proveedor_id: BIMBO, clave: claveArticulo(d) })),
  ...['Pan árabe clasico x 4 unidades', 'Chips clasicos x 9 unidades', 'Figacitas de manteca con queso x 9 unidades', 'bandejas plasticas retornables']
    .map((d) => ({ proveedor_id: FARINA, clave: claveArticulo(d) })),
];
const claves = (ds: string[]) => ds.map(claveArticulo);

describe('el proveedor, por sus artículos', () => {
  it('el mismo artículo aunque el lector lo copie con la marca adelante', () => {
    expect(mismoArticulo(claveArticulo('PAN ARTESANO X 500'), claveArticulo('BIMBO PAN ARTESANO X 500'))).toBe(true);
    expect(mismoArticulo(claveArticulo('OROWEAT CEREAL'), claveArticulo('BIMBO OROWEAT CEREAL'))).toBe(true);
    expect(mismoArticulo(claveArticulo('FARGO SALVADO CHICO'), claveArticulo('FARGO DOBLE INTEGRAL'))).toBe(false);
    // una sola palabra no alcanza para decir que es el mismo
    expect(mismoArticulo(claveArticulo('Speed'), claveArticulo('Speed x6'))).toBe(false);
  });

  it('el segundo remito de Bimbo (16/11) se reconoce solo', () => {
    const r = proveedorPorArticulos(claves(['BIMBO PAN ARTESANO X 500', 'BIMBO OROWEAT CEREAL', 'FARGO SALVADO CHICO', 'GRANDE LACTAL CHICO BLANCO', 'PAN DE PAPA X 6']), conocidos);
    expect(r).toEqual({ proveedorId: BIMBO, coinciden: 4, de: 5 });
  });

  it('con un solo renglón conocido, o menos de la mitad, no adivina', () => {
    expect(proveedorPorArticulos(claves(['PAN ARTESANO X 500', 'Yerba Playadito 1 kg', 'Azúcar Ledesma 1 kg']), conocidos)).toBeNull();
    expect(proveedorPorArticulos(claves(['PAN ARTESANO X 500']), conocidos)).toBeNull();
    expect(proveedorPorArticulos(claves(['Yerba Playadito 1 kg', 'Azúcar Ledesma 1 kg']), conocidos)).toBeNull();
    expect(proveedorPorArticulos([], conocidos)).toBeNull();
    expect(proveedorPorArticulos(claves(['PAN ARTESANO X 500', 'OROWEAT CEREAL']), [])).toBeNull();
  });

  it('si dos proveedores venden lo mismo, no elige', () => {
    const otro = [...conocidos, ...['PAN ARTESANO X 500', 'OROWEAT CEREAL'].map((d) => ({ proveedor_id: 'distribuidor', clave: claveArticulo(d) }))];
    expect(proveedorPorArticulos(claves(['PAN ARTESANO X 500', 'OROWEAT CEREAL']), otro)).toBeNull();
    // pero si uno tiene el doble de coincidencias, es ese
    expect(proveedorPorArticulos(claves(['PAN ARTESANO X 500', 'OROWEAT CEREAL', 'FARGO SALVADO CHICO', 'PROTEIN RAPID']), otro)?.proveedorId).toBe(BIMBO);
  });
});

describe('«el proveedor es…» escrito en el chat de la factura', () => {
  const lista = [
    { id: '1', nombre: 'BIMBO' }, { id: '2', nombre: 'Cagnoli Pablo' }, { id: '3', nombre: 'El Zamorano' }, { id: '4', nombre: 'Mangni' },
    { id: '5', nombre: 'SURTISUR' }, { id: '6', nombre: 'POPH' }, { id: '7', nombre: 'HER.C' }, { id: '8', nombre: 'COSTE VALENTINA' },
    { id: '9', nombre: 'Distribuidora City' }, { id: '10', nombre: 'Distribuidora de Galletitas y Alimentos del Sur SA', otro: 'Distri Sur' },
  ];
  it('lo encuentra como lo escribe la gente', () => {
    expect(proveedorPorNombre('BIMBO', lista).elegido?.id).toBe('1');
    expect(proveedorPorNombre('PABLO CAGNOLI', lista).elegido?.id).toBe('2');
    expect(proveedorPorNombre('el zamorano', lista).elegido?.id).toBe('3');
    expect(proveedorPorNombre('MANGINI', lista).elegido?.id).toBe('4'); // una letra de más
    expect(proveedorPorNombre('coste valentina', lista).elegido?.id).toBe('8');
    expect(proveedorPorNombre('distri sur', lista).elegido?.id).toBe('10'); // por el nombre de fantasía
  });
  it('si pueden ser varios, los devuelve para elegir; si no hay ninguno, nada', () => {
    const r = proveedorPorNombre('distribuidora', lista);
    expect(r.elegido).toBeNull();
    expect(r.opciones.map((o) => o.id).sort()).toEqual(['10', '9']);
    expect(proveedorPorNombre('La Serenísima', lista)).toEqual({ elegido: null, opciones: [] });
    expect(proveedorPorNombre('  ', lista)).toEqual({ elegido: null, opciones: [] });
  });
});

// 17/11/2026: Oxxon y Ricardo Nini estaban dados de alta dos veces por un CUIT mal leído.
describe('un CUIT mal leído no da de alta al proveedor otra vez', () => {
  const base = [
    { id: 'oxxon', razon_social: 'OXXON Comercializacion', cuit: '30-71405298-1' },
    { id: 'nini', razon_social: 'RICARDO NINI S.A.', cuit: '30565574759' },
  ];
  it('el dígito verificador', () => {
    expect(cuitValido('30714052981')).toBe(true);
    expect(cuitValido('30-56557475-9')).toBe(true);
    expect(cuitValido('30714052081')).toBe(false); // el 9 leído como 0
    expect(cuitValido('30565747509')).toBe(false); // dígitos cruzados
    expect(cuitValido('3071405298')).toBe(false);
    expect(cuitValido(null)).toBe(false);
  });
  it('Oxxon con un dígito mal leído sigue siendo Oxxon', () => {
    expect(elegirProveedor({ nombre: 'OXXON COMERCIALIZACION Y DISTRIBUCION S.A.', cuit: '30714052081' }, base)?.id).toBe('oxxon');
    // aunque no se lea el nombre: hay un solo CUIT válido a un dígito
    expect(elegirProveedor({ nombre: null, cuit: '30714052081' }, base)?.id).toBe('oxxon');
  });
  it('Ricardo Nini con los dígitos cruzados se reconoce por el nombre', () => {
    expect(elegirProveedor({ nombre: 'RICARDO NINI S.A.', cuit: '30565747509' }, base)?.id).toBe('nini');
  });
  it('un CUIT bien leído que es de otro sigue sin vincularse por parecerse el nombre', () => {
    // CUIT válido y distinto: es otra empresa aunque se llame parecido
    expect(elegirProveedor({ nombre: 'OXXON S.A.', cuit: '30565574759' }, base.slice(0, 1))).toBeNull();
  });
  it('entre dos fichas del mismo nombre, la del CUIT válido', () => {
    const dos = [{ id: 'mala', razon_social: 'RICARDO NINI S.A.', cuit: '30565747509' }, { id: 'buena', razon_social: 'RICARDO NINI S.A.', cuit: '30565574759' }];
    expect(elegirProveedor({ nombre: 'RICARDO NINI S.A.', cuit: null }, dos)?.id).toBe('buena');
  });
});
