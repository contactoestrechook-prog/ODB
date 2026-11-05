// Percepciones con base propia (5/11/2026). La Serenísima 06376-00001075:
// neto $800.707,62; percepción de IVA 3 % sobre una base de $449.833,62 =
// $13.495,01; percepción de IIBB 5 % sobre el neto entero = $40.035,38.
// Anabella: «$1.698,30 × 1,29 me da $2.190,80» y el sistema mostraba $2.168,48.
// Regla de Leandro: el porcentaje impreso va entero a todos los renglones, con
// un cartel, y no traba el registro.
import { cargaDePercepciones, textoPercepcionesEnteras } from '../../../admin/app/lib/percepciones-compras';
import { tablaParaIA } from '../../../admin/app/lib/tabla-factura';

const pesos = (v: number) => `$${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NETO = 800707.62;
const laSerenisima = [
  { nombre: 'la percepción de IVA', monto: 13495.01, alicuota: 3, base: 449833.62 },
  { nombre: 'la percepción de IIBB', monto: 40035.38, alicuota: 5, base: 800707.62 },
];

describe('percepción cobrada sobre una base menor que el neto', () => {
  it('va entera a todos los renglones: la leche da 1.698,30 × 1,29', () => {
    const c = cargaDePercepciones(laSerenisima, NETO);
    expect(c.pct).toBeCloseTo(0.08, 6); // 3 % entero + 5 % (que ya era sobre todo el neto)
    const costo = Math.round(1698.3 * (1 + 0.21 + c.pct) * 100) / 100;
    expect(costo).toBe(2190.81); // lo que Anabella escribió como 2.190,80
  });

  it('los costos dan de más justo el 3 % de lo que no estaba en la base, y se dice en el cartel', () => {
    const c = cargaDePercepciones(laSerenisima, NETO);
    expect(c.exceso).toBe(10526.22); // 3 % × (800.707,62 − 449.833,62)
    expect(c.enteras).toEqual([{ nombre: 'la percepción de IVA', alicuota: 3, base: 449833.62, exceso: 10526.22 }]);
    expect(textoPercepcionesEnteras(c, pesos)).toBe('El costo da $10.526,22 más que la factura porque la percepción de IVA (3 %) se cobra sobre $449.833,62 y se aplicó a todos los renglones. Lo que se le paga al proveedor no cambia.');
  });

  it('una percepción sobre todo el neto no es «entera»: se reparte como siempre y no hay cartel', () => {
    const c = cargaDePercepciones([laSerenisima[1]], NETO);
    expect(c.pct).toBeCloseTo(0.05, 6);
    expect(c.exceso).toBe(0);
    expect(textoPercepcionesEnteras(c, pesos)).toBe('');
  });

  it('si el papel no imprime la alícuota ni la base, queda como antes: monto ÷ neto', () => {
    const c = cargaDePercepciones([{ nombre: 'la percepción de IVA', monto: 13495.01, alicuota: 0, base: 0 }, { nombre: 'la percepción de IIBB', monto: 40035.38 }], NETO);
    expect(c.pct).toBeCloseTo(53530.39 / NETO, 8); // el 6,69 % de antes
    expect(c.enteras).toEqual([]);
  });

  it('si la alícuota y la base leídas no dan el monto del papel, no se usan', () => {
    const c = cargaDePercepciones([{ nombre: 'la percepción de IVA', monto: 13495.01, alicuota: 3, base: 100000 }], NETO);
    expect(c.pct).toBeCloseTo(13495.01 / NETO, 8);
    expect(c.exceso).toBe(0);
  });

  it('con impuestos internos (cigarrillos de Grupo Modo) la percepción sigue yendo sobre neto + internos', () => {
    const c = cargaDePercepciones([{ nombre: 'la percepción de IIBB', monto: 15738.61, alicuota: 0, base: 0 }], 69658.2, 245113.9);
    expect(c.pct).toBeCloseTo(0.05, 5);
    expect(c.exceso).toBe(0);
  });

  it('sin neto o sin percepciones no suma nada', () => {
    expect(cargaDePercepciones(laSerenisima, 0)).toEqual({ pct: 0, exceso: 0, enteras: [] });
    expect(cargaDePercepciones([], NETO)).toEqual({ pct: 0, exceso: 0, enteras: [] });
  });
});

// «los precios unitarios no tienen aplicado la oferta» (Anabella, 5/11): sí
// estaba aplicada; ahora el chat ve el precio con el descuento restado.
describe('la oferta ya aplicada, a la vista', () => {
  it('el renglón con 10 % de descuento trae su precio con el descuento restado', () => {
    const leche = { descripcion: 'LECHE PROTEIN', cantidad: 120, precio: 1887, importe: 203796, papel: { bultos: 0, uxb: null, sueltas: 120, precio: 1887, desc: 10, iva: 21, importe: 203796 } };
    const fila: any = tablaParaIA([leche], () => false, () => null)[0];
    expect(fila.precioConDescuento).toBe(1698.3);
    expect(fila.cierra).toBe(true);
    const sinDescuento: any = tablaParaIA([{ ...leche, papel: { ...leche.papel, desc: null, importe: 226440 } }], () => false, () => null)[0];
    expect(sinDescuento.precioConDescuento).toBeUndefined();
  });
});
