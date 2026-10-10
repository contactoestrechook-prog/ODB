// La factura como tabla (8/10/2026). La cuenta vive en el panel
// (apps/admin/app/lib/tabla-factura.ts) porque se recalcula en vivo; se prueba
// acá porque la API es la que tiene los tests. Casos reales de Oxxon y Distri Sur.
import { aplicarCambiosIA, aplicarPapel, cuentaDelPapel, entraDeRenglon, papelDeLectura, tablaParaIA, unidadesDelPapel } from '../../../admin/app/lib/tabla-factura';

const lectura = (cantidad: number, precio: number, importe: number, extra: Record<string, unknown> = {}) => ({ cantidad, precio, importe, ...extra });

describe('papelDeLectura: el renglón como está impreso', () => {
  it('Oxxon, Tiritas: 1 bulto de 12 a $3.598,93 con 10% = $38.868,42', () => {
    const p = papelDeLectura(lectura(1, 3598.93, 38868.42, { unidadesPorBulto: 12, bonificacionPct: 10 }));
    expect(p).toMatchObject({ bultos: 1, uxb: 12, sueltas: 0, precio: 3598.93, desc: 10, importe: 38868.42 });
    expect(cuentaDelPapel(p)).toMatchObject({ unidades: 12, cierra: true });
  });
  it('Oxxon, Durazno: 4 sueltas con 10%', () => {
    const p = papelDeLectura(lectura(4, 2183.46, 7860.47, { bonificacionPct: 10 }));
    expect(p).toMatchObject({ bultos: 0, uxb: null, sueltas: 4 });
    expect(cuentaDelPapel(p).cierra).toBe(true);
  });
  it('Oxxon, Vienissima: la interpretación ya corrigió 1 → 20; el papel dice 1 bulto de 20', () => {
    const p = papelDeLectura(lectura(1, 1814.31, 36286.14, { unidadesPorBulto: 20, interpretado: { decision: 'cantidad_corregida', cantidad: 20, cantidadOriginal: 1, bultoConsumido: 20 } }));
    expect(p).toMatchObject({ bultos: 1, uxb: 20, sueltas: 0 });
    expect(cuentaDelPapel(p)).toMatchObject({ unidades: 20, cierra: true });
  });
  it('Distri Sur, Azafrán: 12 blísters de 2 (la interpretación dedujo 24)', () => {
    const p = papelDeLectura(lectura(12, 2338.18, 56116.44, { interpretado: { decision: 'cantidad_corregida', cantidad: 24, cantidadOriginal: 12 } }));
    expect(p).toMatchObject({ bultos: 12, uxb: 2, sueltas: 0 });
    expect(cuentaDelPapel(p).cierra).toBe(true);
  });
  it('Distri Sur, Ferrero T12: 60 unidades sueltas (el ×12 es la caja del catálogo, no del papel)', () => {
    const p = papelDeLectura(lectura(60, 827.49, 49649.4, { unidadesDelCatalogo: 12, interpretado: { decision: 'unidades_a_envase', cantidad: 5, cantidadOriginal: 60 } }));
    expect(p).toMatchObject({ bultos: 0, sueltas: 60 });
    expect(cuentaDelPapel(p).cierra).toBe(true);
  });
  it('Distri Sur del 11/9, el 5% que el lector no leyó: el renglón queda en rojo con la diferencia', () => {
    const p = papelDeLectura(lectura(18, 2345.25, 40103.82));
    const c = cuentaDelPapel(p);
    expect(c.cierra).toBe(false);
    expect(c.dif).toBeCloseTo(2110.68, 2);
    expect(cuentaDelPapel({ ...p, desc: 5 }).cierra).toBe(true);
  });
  it('un regalo (importe 0 con 100%) cierra', () => {
    expect(cuentaDelPapel(papelDeLectura(lectura(1, 864000, 0, { bonificacionPct: 100 }))).cierra).toBe(true);
  });
});

describe('aplicarPapel: lo que entra al stock', () => {
  const fila = { descripcion: 'SD-TIRITAS DE POLLO X (300 GRS)', cantidad: 1, precio: 3598.93, importe: 38868.42, bonificacionPct: 10, unidadesPorBulto: 12, sku: 'L12590' };
  it('en unidades: 12 Tiritas, el importe del papel, el bulto decidido', () => {
    const p = papelDeLectura(fila);
    const r = aplicarPapel(fila, p, { como: 'unidades' });
    expect(r).toMatchObject({ cantidad: 12, precio: 3598.93, importe: 38868.42, bonificacionPct: 10, unidadesPorBulto: null, bultoAplicado: 12, envaseAplicado: null, sku: 'L12590' });
    expect(r.importe / r.cantidad).toBeCloseTo(3239.04, 1);
  });
  it('en cajas (el producto del catálogo es la caja de 12): 1 caja al precio de la caja', () => {
    const r = aplicarPapel(fila, papelDeLectura(fila), { como: 'cajas', de: 12 });
    expect(r).toMatchObject({ cantidad: 1, envaseAplicado: 12, bultoAplicado: null });
    expect(r.precio).toBeCloseTo(43187.16, 2);
  });
  it('Ana corrige la cantidad en la tabla: 2 bultos en vez de 1 → 24 unidades', () => {
    const p = { ...papelDeLectura(fila), bultos: 2, importe: 77736.84 };
    expect(aplicarPapel(fila, p, { como: 'unidades' }).cantidad).toBe(24);
  });
  it('cómo entra un renglón recién cargado', () => {
    expect(entraDeRenglon({ envaseAplicado: 12 }, papelDeLectura(fila))).toEqual({ como: 'cajas', de: 12 });
    expect(entraDeRenglon({ unidadesPorBulto: 12 }, papelDeLectura(fila))).toBeNull();
    expect(entraDeRenglon({}, papelDeLectura(fila))).toEqual({ como: 'unidades' });
  });
  it('unidades del papel', () => {
    expect(unidadesDelPapel({ bultos: 2, uxb: 12, sueltas: 3, precio: 1, desc: null, iva: null, importe: null })).toBe(27);
  });
});

describe('aplicarCambiosIA: lo que corrige el chat', () => {
  const esDesc = (f: any) => !!f.esDescuento;
  const items = [
    { descripcion: 'Tom.Triturado BOTELLA X950Grs Inca', cantidad: 18, precio: 2345.25, importe: 40103.82 },
    { descripcion: 'Bocadito Ferrero Rocher T12', cantidad: 12, precio: 827.49, importe: 9929.93 },
    { descripcion: 'Descuento', esDescuento: true, cantidad: 1, precio: 0, importe: -9929.93 },
  ];
  it('«el tomate tiene 5%» → el renglón 1 cierra', () => {
    const r = aplicarCambiosIA(items, [{ renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'la columna %Des. dice 5,0' }], esDesc);
    expect(r.registros).toEqual([{ renglon: 1, campo: 'desc', antes: null, despues: 5, motivo: 'la columna %Des. dice 5,0' }]);
    expect(r.items[0].bonificacionPct).toBe(5);
    expect(cuentaDelPapel(r.items[0].papel).cierra).toBe(true);
  });
  it('«no apliques ese descuento» → noAplicar en el renglón de descuento', () => {
    const r = aplicarCambiosIA(items, [{ renglon: 3, campo: 'noAplicar', valor: true }], esDesc);
    expect(r.items[2].noAplicar).toBe(true);
  });
  it('descarta lo que no entiende sin romper nada', () => {
    const r = aplicarCambiosIA(items, [
      { renglon: 9, campo: 'precio', valor: 10 },
      { renglon: 1, campo: 'color', valor: 'rojo' },
      { renglon: 1, campo: 'precio', valor: 'mucho' },
      { renglon: 3, campo: 'precio', valor: 1 },
    ], esDesc);
    expect(r.descartados).toHaveLength(4);
    expect(r.items).toEqual(items);
  });
  it('la tabla que lee la IA lleva lo del papel y si cierra', () => {
    const t = tablaParaIA(items, esDesc, (k) => (k === 2 ? 'renglón 2' : null));
    expect(t[0]).toMatchObject({ renglon: 1, sueltas: 18, precio: 2345.25, importe: 40103.82, cierra: false });
    expect(t[2]).toMatchObject({ renglon: 3, descuento: true, aplicaA: 'renglón 2' });
  });
});

describe('el bulto pendiente no se resuelve solo', () => {
  // Tiritas recién leída: 1 bulto de 12, nadie eligió todavía cómo entra
  const fila: Record<string, any> = { descripcion: 'SD-TIRITAS DE POLLO X (300 GRS)', cantidad: 1, precio: 3598.93, importe: 38868.42, unidadesPorBulto: 12 };
  it('corregir el descuento deja el bulto por decidir', () => {
    const r = aplicarCambiosIA([fila], [{ renglon: 1, campo: 'descuentoPct', valor: 10 }], () => false);
    expect(r.items[0]).toMatchObject({ cantidad: 1, unidadesPorBulto: 12, bonificacionPct: 10 });
    expect(entraDeRenglon(r.items[0], r.items[0].papel)).toBeNull();
  });
  it('elegir «unidades» lo resuelve: 12 unidades', () => {
    const r = aplicarCambiosIA([fila], [{ renglon: 1, campo: 'entraComo', valor: 'unidades' }], () => false);
    expect(r.items[0]).toMatchObject({ cantidad: 12, unidadesPorBulto: null, bultoAplicado: 12 });
    expect(entraDeRenglon(r.items[0], r.items[0].papel)).toEqual({ como: 'unidades' });
  });
  it('elegir «cajas» entra 1 caja de 12 y queda así', () => {
    const r = aplicarCambiosIA([fila], [{ renglon: 1, campo: 'entraComo', valor: 'cajas' }], () => false);
    expect(r.items[0]).toMatchObject({ cantidad: 1, envaseAplicado: 12 });
    expect(entraDeRenglon(r.items[0], r.items[0].papel)).toEqual({ como: 'cajas', de: 12 });
  });
});

describe('cómo está entrando hoy: Oxxon 0006-00295763 (7/10/2026)', () => {
  it('Fuet: el papel dice 3 bultos de 10 y el renglón entra 3 → son 3 cajas de 10', () => {
    const raw = { cantidad: 3, precio: 3950.89, importe: 106674.17, bonificacionPct: 10, unidadesPorBulto: 10, interpretado: { decision: 'bonificado', cantidad: 3 } };
    const p = papelDeLectura(raw);
    expect(p).toMatchObject({ bultos: 3, uxb: 10, sueltas: 0 });
    expect(cuentaDelPapel(p).cierra).toBe(true);
    expect(entraDeRenglon({ cantidad: 3 }, p)).toEqual({ como: 'cajas', de: 10 });
    // Ana elige unidades: 30 Fuet a $3.950,89 menos 10%
    const r = aplicarPapel({ cantidad: 3, precio: 3950.89, importe: 106674.17 }, p, { como: 'unidades' });
    expect(r).toMatchObject({ cantidad: 30, precio: 3950.89, bultoAplicado: 10, envaseAplicado: null });
    expect(entraDeRenglon(r, p)).toEqual({ como: 'unidades' });
  });
  it('Mantecol: 1 bulto de 12 entrando como 1 → 1 caja de 12', () => {
    const p = papelDeLectura({ cantidad: 1, precio: 1957.87, importe: 21144.95, bonificacionPct: 10, unidadesPorBulto: 12 });
    expect(entraDeRenglon({ cantidad: 1 }, p)).toEqual({ como: 'cajas', de: 12 });
  });
  it('Jugo de pomelo: la interpretación ya lo pasó a 12 → unidades', () => {
    const p = papelDeLectura({ cantidad: 1, precio: 3519.76, importe: 42237.17, unidadesPorBulto: 12, interpretado: { decision: 'cantidad_corregida', cantidad: 12, cantidadOriginal: 1 } });
    expect(entraDeRenglon({ cantidad: 12 }, p)).toEqual({ como: 'unidades' });
  });
  it('Paty Light caja ×4: 6 cajas a $5.927,19; abrirlas da 24 hamburguesas a $1.481,80', () => {
    const fila = { cantidad: 6, precio: 5927.19, importe: 35563.15, unidadesPorBulto: 4 };
    const p = papelDeLectura(fila);
    expect(p).toMatchObject({ bultos: 0, uxb: 4, sueltas: 6 });
    expect(cuentaDelPapel(p).cierra).toBe(true);
    expect(entraDeRenglon(fila, p)).toBeNull(); // bulto pendiente
    const abiertas = aplicarPapel(fila, p, { como: 'abiertas', de: 4 });
    expect(abiertas).toMatchObject({ cantidad: 24, precio: 1481.8, bultoAplicado: 4, unidadesPorBulto: null, importe: 35563.15 });
    expect(entraDeRenglon(abiertas, p)).toEqual({ como: 'abiertas', de: 4 });
    const tal = aplicarPapel(fila, p, { como: 'unidades' });
    expect(tal).toMatchObject({ cantidad: 6, precio: 5927.19, unidadesPorBulto: null });
    expect(entraDeRenglon(tal, p)).toEqual({ como: 'unidades' });
  });
  it('la IA puede pedir «abrir» la caja', () => {
    const r = aplicarCambiosIA([{ cantidad: 6, precio: 5927.19, importe: 35563.15, unidadesPorBulto: 4 }], [{ renglon: 1, campo: 'entraComo', valor: 'abrir' }], () => false);
    expect(r.items[0]).toMatchObject({ cantidad: 24 });
    expect(r.registros[0]).toMatchObject({ antes: null, despues: 'abiertas' });
  });
});

describe('se vende en paquetes (Ana, 10/10/2026: las Rodesias vienen por 36 y se venden de a 3)', () => {
  it('2 cajas × 36 a $929,44 por unidad → entran 24 paquetes de 3 a $2.788,32 cada uno; la cuenta del papel no cambia', () => {
    const fila: any = { descripcion: 'RODESIA X36', cantidad: 2, precio: 33459.84, importe: 66919.68 };
    const papel = { bultos: 2, uxb: 36, sueltas: null, precio: 929.44, desc: null, iva: 21, importe: 66919.68 };
    const conPapel = { ...fila, papel };
    const r = aplicarCambiosIA([conPapel], [{ renglon: 1, campo: 'unidadesPorVenta', valor: 3, motivo: 'se venden de a 3' }], () => false);
    expect(r.descartados).toHaveLength(0);
    expect(r.items[0].cantidad).toBe(24);
    expect(r.items[0].precio).toBeCloseTo(2788.32, 2);
    expect(cuentaDelPapel(r.items[0].papel).cuenta).toBeCloseTo(66919.68, 1);
    // si después se corrige otra cosa del renglón, sigue entrando en paquetes de 3
    expect(entraDeRenglon(r.items[0], r.items[0].papel)).toEqual({ como: 'cajas', de: 3 });
  });
  it('un valor que no sirve (1, 0, texto) se descarta', () => {
    const fila: any = { descripcion: 'RODESIA X36', cantidad: 2, precio: 1, importe: 72, papel: { bultos: 2, uxb: 36, sueltas: null, precio: 1, desc: null, iva: 21, importe: 72 } };
    for (const v of [1, 0, 'tres']) expect(aplicarCambiosIA([fila], [{ renglon: 1, campo: 'unidadesPorVenta', valor: v as any, motivo: '' }], () => false).descartados).toHaveLength(1);
  });
});
