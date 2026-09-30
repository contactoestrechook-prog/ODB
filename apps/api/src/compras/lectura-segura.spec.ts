import { numeroLeido, interpretarLecturaSegura } from './lectura-segura';
import { ListasService } from '../listas/listas.service';

const fila = { descripcion: 'Agua pack x 6', cantidad: 2, precio: 6000, importe: 12000, unidadesPorBulto: 6, bonificacionPct: null, esDescuento: false, kg: null, puedePorPeso: false };

describe('lectura segura de comprobantes', () => {
  it.each([null, undefined, '', '  ', false, true, [], {}, NaN, Infinity, 'ilegible'])('no inventa un número para %p', (v) => expect(numeroLeido(v)).toBeNull());
  it.each([0, 0.5, 1500.5])('preserva el valor %p', (v) => expect(numeroLeido(v)).toBe(v));
  it('no interpreta un importe ausente como bonificación o cierre', () => {
    expect(interpretarLecturaSegura({ ...fila, importe: null })).toMatchObject({ decision: 'incompleto', faltantes: ['importe'] });
  });
  it.each([null, 0, -1])('no sustituye cantidad %p por una unidad', (cantidad) => {
    expect(interpretarLecturaSegura({ ...fila, cantidad })).toMatchObject({ decision: 'incompleto', cantidad });
  });
  it('no inventa precio cero', () => {
    expect(interpretarLecturaSegura({ ...fila, precio: null })).toMatchObject({ decision: 'incompleto', faltantes: ['precio'] });
  });
  it('preserva la bonificación explícita con importe cero', () => {
    expect(interpretarLecturaSegura({ ...fila, importe: 0, bonificacionPct: 100 }).decision).toBe('bonificado');
  });
  it('mantiene 2 packs de 6 pendientes de definir la unidad del catálogo', () => {
    expect(interpretarLecturaSegura(fila)).toMatchObject({ decision: 'bulto_pendiente', cantidad: 2, unidadesPorBulto: 6 });
  });
  it('lee medio kilo sin redondearlo a una unidad', () => {
    expect(interpretarLecturaSegura({ ...fila, descripcion: 'Queso a granel', cantidad: 1, precio: 1500.5, importe: 750.25, unidadesPorBulto: null, kg: 0.5, puedePorPeso: true })).toMatchObject({ cantidad: 0.5, porPeso: true });
  });
  it('reabrir una lectura mantiene desconocidos y recalcula la advertencia', async () => {
    const service = new ListasService({} as any);
    const result = await (service as any).actualizarLectura({ items: [{ descripcion: 'Agua pack x 6', cantidad: null, precio: null, importe: null }] });
    expect(result.items[0]).toMatchObject({ cantidad: null, precio: null, importe: null, interpretado: { decision: 'incompleto', faltantes: ['cantidad', 'precio', 'importe'] } });
  });
});

describe('confirmación en administración', () => {
  const { camposDeLecturaIncompletos } = require('../../../admin/app/lib/lectura-compras');
  it.each([
    [{ cantidad: '', precio: 100 }, true],
    [{ cantidad: 0, precio: 100 }, true],
    [{ cantidad: 1, precio: null }, true],
    [{ cantidad: 1, precio: false }, true],
    [{ cantidad: 1, precio: -10 }, true],
    [{ cantidad: 1, precio: -10, esDescuento: true }, false],
    [{ cantidad: 1, precio: 0 }, false],
    [{ cantidad: 0.5, precio: 1500.5 }, false],
  ])('valida %p', (i, esperado) => expect(camposDeLecturaIncompletos(i)).toBe(esperado));
});
