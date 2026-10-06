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

// Mapaca (6/10/2026): la lectura del 2/10 quedó guardada con el ×14 del modelo.
// Al reabrirla se rehace con las reglas de hoy: los 28 Doritos ya son unidades.
describe('reabrir una lectura con «×N» (Doritos de Mapaca, 6/10/2026)', () => {
  const DORITOS = { descripcion: 'DORITOS QUESO 200GX14', cantidad: 28, precio: 4899.65, importe: 137190.2, unidadesPorBulto: 14, bonificacionPct: null, esDescuento: false, kg: null, puedePorPeso: false };

  it('con el costo del producto vinculado: 28 unidades, sin bulto pendiente', () => {
    expect(interpretarLecturaSegura({ ...DORITOS, bultoOrigen: 'modelo', costoCatalogo: 5714.29 })).toMatchObject({
      decision: 'ya_en_unidades', cantidad: 28, unidadesPorBulto: null, bultoDescartado: 14, faltantes: [],
    });
  });

  it('una lectura incompleta no inventa la decisión del bulto', () => {
    expect(interpretarLecturaSegura({ ...DORITOS, importe: null, costoCatalogo: 5714.29 })).toMatchObject({
      decision: 'incompleto', unidadesPorBulto: 14, bultoDescartado: null, razonBulto: null,
    });
  });

  it('reabierta desde la bandeja: decide con las reglas de hoy y rehace la variación', async () => {
    const db = { from: () => ({ select: () => ({ in: async () => ({ data: [{ sku: 'L5248', alicuota_iva: 21 }] }) }) }) };
    const service = new ListasService(db as any);
    const guardada = {
      items: [{
        codigo: null, ...DORITOS,
        match: { sku: 'L5248', nombre: 'Doritos de Queso 200g', costoActual: 5714.29, variacionPct: -93.9, metodo: 'alias', margenPct: 65 },
      }],
    };
    const r = await (service as any).actualizarLectura(guardada);
    expect(r.items[0].interpretado).toMatchObject({ decision: 'ya_en_unidades', cantidad: 28, unidadesPorBulto: null, bultoDescartado: 14 });
    expect(r.items[0].interpretado.razonBulto).toMatchObject({ sugerencia: 'unidades', evidencia: 'costo' });
    // ya no el −93,9% de comparar $350 contra $5.714
    expect(r.items[0].match.variacionPct).toBeCloseTo(-14.3, 1);
    // el panel sabe que el 14 no está escrito como bulto en la descripción
    expect(r.items[0].bultoOrigen).toBe('modelo');
  });

  it('si el producto es solo una sugerencia de la IA, queda la pregunta con la sugerencia', async () => {
    const db = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) };
    const service = new ListasService(db as any);
    const r = await (service as any).actualizarLectura({
      items: [{ codigo: null, ...DORITOS, match: { sku: 'L5248', nombre: 'Doritos de Queso 200g', costoActual: 5714.29, variacionPct: null, metodo: 'ia', sugerido: true } }],
    });
    expect(r.items[0].interpretado).toMatchObject({ decision: 'bulto_pendiente', unidadesPorBulto: 14, razonBulto: { sugerencia: 'unidades' } });
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
