// La factura como tabla (8/10/2026). La cuenta vive en el panel
// (apps/admin/app/lib/tabla-factura.ts) porque se recalcula en vivo; se prueba
// acá porque la API es la que tiene los tests. Casos reales de Oxxon y Distri Sur.
import { aplicarCambiosIA, aplicarPapel, frenarReglasAbsurdas, cuentaDelPapel, entraDeRenglon, papelDeLectura, tablaParaIA, unidadesDelPapel } from '../../../admin/app/lib/tabla-factura';

const lectura = (cantidad: number, precio: number, importe: number, extra: Record<string, unknown> = {}) => ({ cantidad, precio, importe, ...extra });

describe('papelDeLectura: el renglón como está impreso', () => {
  it('Oxxon 5/11, Pronto Manzana: el lector da 4 bultos y 4 sueltas aparte y «cantidad» 8 → 36 unidades, cierra', () => {
    const p = papelDeLectura(lectura(8, 1439.61, 46643.23, { bultos: 4, unidadesSueltas: 4, unidadesPorBulto: 8, bonificacionPct: 10, interpretado: { decision: 'bonificado', cantidad: 8, unidadesPorBulto: 8 } }));
    expect(p).toMatchObject({ bultos: 4, uxb: 8, sueltas: 4, desc: 10 });
    expect(cuentaDelPapel(p)).toMatchObject({ unidades: 36, cierra: true });
  });

  it('si los bultos leídos no cierran, sigue mirando la cantidad como antes', () => {
    const p = papelDeLectura(lectura(5, 1439.61, 51825.82, { bultos: 2, unidadesPorBulto: 8, bonificacionPct: 10 }));
    expect(p).toMatchObject({ bultos: 5, uxb: 8, sueltas: 0 });
  });

  it('Galletitas del Sur 5/11, Jorgito «18 x 6U»: 1 bulto leído ×6, el importe da 18 → 1 bulto de 18, cierra solo', () => {
    const p = papelDeLectura(lectura(1, 2255.68, 39384.17, { unidadesPorBulto: 6, unidadesDelCatalogo: 6, bonificacionPct: 3, interpretado: { decision: 'bonificado', cantidad: 1, unidadesPorBulto: 6 } }));
    expect(p).toMatchObject({ bultos: 1, uxb: 18, sueltas: 0, desc: 3 });
    expect(cuentaDelPapel(p)).toMatchObject({ unidades: 18, cierra: true });
  });
  it('si el importe no da un entero de unidades (algo por kilo), no inventa bultos', () => {
    const p = papelDeLectura(lectura(1, 1000, 5530, { unidadesPorBulto: 6 }));
    expect(p).toMatchObject({ bultos: 1, uxb: 6 });
    expect(cuentaDelPapel(p).cierra).toBe(false);
  });

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
  it('«aplicale 5 % al renglón 1» y el importe leído no lo tenía: descuento + ajustarImporte → cierra con la cuenta de la persona', () => {
    const fila: any = { cantidad: 10, precio: 1000, importe: 10000, sku: 'A' };
    const r = aplicarCambiosIA([fila], [
      { renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'lo dijo la persona' },
      { renglon: 1, campo: 'ajustarImporte', valor: true, motivo: 'manda su cuenta' },
    ], () => false);
    expect(r.descartados).toHaveLength(0);
    expect(r.items[0].papel).toMatchObject({ desc: 5, importe: 9500 });
    expect(cuentaDelPapel(r.items[0].papel).cierra).toBe(true);
    // queda anotado como un cambio de importe: se deshace como cualquier otro
    expect(r.registros.map((g) => g.campo)).toEqual(['desc', 'importe']);
  });
  it('«el precio es por bulto» (2 bultos de 12 a $12.000): sueltas 2 y entra abriendo la caja → 24 a $1.000', () => {
    const fila = { cantidad: 24, precio: 12000, importe: 24000, sku: 'A', papel: { bultos: 2, uxb: 12, sueltas: 0, precio: 12000, desc: null, iva: 21, importe: 24000 } };
    const r = aplicarCambiosIA([fila], [
      { renglon: 1, campo: 'bultos', valor: 0 }, { renglon: 1, campo: 'sueltas', valor: 2 }, { renglon: 1, campo: 'entraComo', valor: 'abiertas' },
    ], () => false);
    expect(r.descartados).toHaveLength(0);
    expect(cuentaDelPapel(r.items[0].papel).cierra).toBe(true);
    expect(r.items[0]).toMatchObject({ cantidad: 24, precio: 1000 });
  });

  it('«del Pronto Manzana llegaron 3 bultos» (Oxxon, 4/11/2026) → recibidas 28 de 36, el papel no se toca', () => {
    const papel = { bultos: 4, uxb: 8, sueltas: 4, precio: 1439.61, desc: 10, iva: 21, importe: 46643.23 };
    const fila = [{ descripcion: 'BG- PRONTO MANZANA X (1000 CC)', cantidad: 36, precio: 1439.61, importe: 46643.23, bonificacionPct: 10, papel }];
    const r = aplicarCambiosIA(fila, [{ renglon: 1, campo: 'recibidas', valor: 28, motivo: 'la nota dice ingresaron 3 bultos' }], esDesc);
    expect(r.descartados).toEqual([]);
    expect(r.items[0]).toMatchObject({ recibidoAMano: 28, cantidad: 36, importe: 46643.23, papel });
    // más de lo facturado no puede llegar; todas = sin marca
    expect(aplicarCambiosIA(fila, [{ renglon: 1, campo: 'recibidas', valor: 40 }], esDesc).descartados).toHaveLength(1);
    expect(aplicarCambiosIA(fila, [{ renglon: 1, campo: 'recibidas', valor: 36 }], esDesc).items[0]).toMatchObject({ recibidoAMano: null });
  });
  it('«el jamón va por peso, 39 kg» (Oxxon, 4/11/2026) → entra en kilos y el costo es por kilo', () => {
    const jamon = [{ descripcion: 'BCT- JAMON NAT BOCATTI X (6,6 KG)', cantidad: 6, precio: 17614.03, importe: 619520.7, kg: 39, bonificacionPct: 10 }];
    const r = aplicarCambiosIA(jamon, [{ renglon: 1, campo: 'kilos', valor: 39, motivo: 'la persona dice que va por peso' }], esDesc);
    expect(r.descartados).toEqual([]);
    expect(r.items[0]).toMatchObject({ cantidad: 39, porPeso: true, importe: 619520.7 });
    expect((r.items[0] as any).precio).toBeCloseTo(15885.15, 1);
    expect(aplicarCambiosIA(jamon, [{ renglon: 1, campo: 'kilos', valor: 0 }], esDesc).descartados).toHaveLength(1);
  });
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

// Rueda Que Rueda 0007-00136173 (22/10/2026): el lector marcó «bonif. 18%» en
// renglones cuyo precio ya venía bonificado (12 × $4.004,07 = $48.048,84 justo),
// y Melba y Milka Avellana no ingresaron. Se veía «no cierra» y el Oreo a $5.587.
describe('Rueda Que Rueda: bonificación ya incluida y lo que no ingresó', () => {
  it('la bonificación que ya está en el precio no se descuenta otra vez: el renglón cierra', () => {
    const p = papelDeLectura(lectura(12, 4004.07, 48048.84, { bonificacionPct: 18, unidadesPorBulto: 12 }));
    expect(p.desc).toBeNull();
    expect(p.descIncluido).toBe(18);
    expect(cuentaDelPapel(p)).toMatchObject({ unidades: 12, cierra: true });
  });
  it('si el importe sí trae el descuento, se aplica como siempre (Oxxon 10%)', () => {
    const p = papelDeLectura(lectura(1, 3598.93, 38868.42, { unidadesPorBulto: 12, bonificacionPct: 10 }));
    expect(p.desc).toBe(10);
    expect(p.descIncluido).toBeUndefined();
  });
  it('si no cierra de ninguna de las dos formas, el descuento queda y el renglón sigue en rojo', () => {
    const p = papelDeLectura(lectura(12, 4004.07, 40000, { bonificacionPct: 18 }));
    expect(p.desc).toBe(18);
    expect(cuentaDelPapel(p).cierra).toBe(false);
  });
  it('«Melba no ingresó» → ingresa = false: sale del stock sin tocar el papel', () => {
    const fila: any = { descripcion: 'MELBA TRIPACK X 360GR', sku: 'L100', incluir: true, cantidad: 15, precio: 2479.87, importe: 37198.05 };
    const r = aplicarCambiosIA([fila], [{ renglon: 1, campo: 'ingresa', valor: false, motivo: 'no llegó' }], () => false);
    expect(r.items[0].incluir).toBe(false);
    expect(r.items[0].cantidad).toBe(15);
    expect(r.items[0].importe).toBe(37198.05);
    expect(r.registros).toEqual([{ renglon: 1, campo: 'ingresa', antes: true, despues: false, motivo: 'no llegó' }]);
  });
  it('no se puede hacer ingresar un renglón sin producto elegido', () => {
    const fila: any = { descripcion: 'ALGO SIN MATCH', sku: null, incluir: false, cantidad: 1, precio: 10, importe: 10 };
    expect(aplicarCambiosIA([fila], [{ renglon: 1, campo: 'ingresa', valor: true }], () => false).descartados).toHaveLength(1);
  });
  it('el chat recibe el costo final, si ingresa y la bonificación incluida', () => {
    const fila: any = { descripcion: 'OREO', incluir: false, cantidad: 12, precio: 4004.07, importe: 48048.84, bonificacionPct: 18 };
    const [t] = tablaParaIA([fila], () => false, () => null, () => ({ costoFinalConIva: 5165.25, comoSeCalcula: '4004,07 + IVA 21% + percepciones 8%' })) as any[];
    expect(t).toMatchObject({ ingresa: false, bonificacionYaEnElPrecio: 18, costoFinalConIva: 5165.25, cierra: true });
  });
});

// 5/11/2026, Grupo Modo (lectura b1ba1749): la regla «la cantidad es en paquetes,
// 1 por bulto», dicha por una factura de cigarrillos, se aplicó sola a las barras.
describe('frenarReglasAbsurdas: una regla aplicada sola no rompe un renglón', () => {
  const esDesc = () => false;
  const lucky: any = { descripcion: 'LUCKY COOL BOX 20 XL', cantidad: 30, precio: 5622.69, importe: 168680.7, alicuotaIva: 21, unidadesPorBulto: 20, unidadesDelCatalogo: 20, interpretado: { cantidad: 30, bultoDescartado: 20, unidadesPorBulto: null } };
  const barra: any = { descripcion: 'BARRA PROTEICA PASTA MANI/ARANDANO X 10u', cantidad: 2, precio: 15625.03, importe: 31250.07, alicuotaIva: 21, unidadesPorBulto: 10, interpretado: { cantidad: 2, unidadesPorBulto: 10 } };
  const fila = (raw: any, costoCatalogo: number) => ({ ...raw, unidadesPorBulto: raw.interpretado.unidadesPorBulto, bultoDescartado: raw.interpretado.bultoDescartado ?? null, costoCatalogo, papel: papelDeLectura(raw) });
  const regla = (renglon: number, cantidad: number) => [
    { renglon, campo: 'unidadesPorBulto', valor: 1, motivo: 'Regla del proveedor' },
    { renglon, campo: 'bultos', valor: cantidad, motivo: 'Regla del proveedor' },
    { renglon, campo: 'sueltas', valor: 0, motivo: 'Regla del proveedor' },
  ];

  it('las barras «X 10u» vuelven a como se leyeron y los cigarrillos quedan con la regla', () => {
    const antes = [fila(lucky, 5831.9), fila(barra, 1496.89)];
    const r = aplicarCambiosIA(antes, [...regla(1, 30), ...regla(2, 2)], esDesc);
    const f = frenarReglasAbsurdas(antes, r.items, r.registros);
    expect(f.frenados).toEqual([2]);
    expect(f.items[1]).toBe(antes[1]);
    expect(f.items[1].unidadesPorBulto).toBe(10);
    expect(f.registros.every((g) => g.renglon === 1)).toBe(true);
    expect(f.items[0]).toBe(r.items[0]);
  });

  it('sin costo de catálogo no frena nada', () => {
    const antes = [fila(barra, 0)];
    const r = aplicarCambiosIA(antes, regla(1, 2), esDesc);
    expect(frenarReglasAbsurdas(antes, r.items, r.registros).frenados).toEqual([]);
  });

  it('un cambio que acerca el costo al catálogo pasa', () => {
    // estaba cargada como 2 barras a $15.625 y la regla dice que la caja trae 10
    const mal = { ...fila(barra, 1496.89), unidadesPorBulto: null };
    const bien = { ...mal, cantidad: 20, precio: 1562.5 };
    const f = frenarReglasAbsurdas([mal], [bien], [{ renglon: 1, campo: 'uxb', antes: 1, despues: 10, motivo: '' }]);
    expect(f.frenados).toEqual([]);
    expect(f.items[0]).toBe(bien);
  });
});

// 9/11/2026, quesos fraccionados de La Serenísima: el chat dijo «les saqué el
// peso» y la pantalla contestó «el valor no es válido para ese dato».
describe('«kilos» vacío le saca el peso al renglón', () => {
  const esDesc = () => false;
  it('si pasó a peso en la pantalla, vuelve a como estaba', () => {
    const queso: any[] = [lectura(6, 0.1, 0.6, { descripcion: 'QUESO LS GOUDA FRACC 340GR' })];
    const enKilos = aplicarCambiosIA(queso, [{ renglon: 1, campo: 'kilos', valor: 2.04 }], esDesc).items;
    expect(enKilos[0].porPeso).toBe(true);
    const r = aplicarCambiosIA(enKilos, [{ renglon: 1, campo: 'kilos', valor: null, motivo: 'los fraccionados van por unidad' }], esDesc);
    expect(r.descartados).toHaveLength(0);
    expect(r.items[0]).toMatchObject({ porPeso: false, cantidad: 6, precio: 0.1, importe: 0.6, antesDePeso: null });
  });
  it('si lo leyó así el lector, las unidades salen del papel', () => {
    const queso: any[] = [lectura(2.04, 0.29, 0.6, { porPeso: true, papel: { bultos: 0, uxb: null, sueltas: 6, precio: 0.1, desc: null, iva: 21, importe: 0.6 } })];
    const r = aplicarCambiosIA(queso, [{ renglon: 1, campo: 'kilos', valor: 0 }], esDesc);
    expect(r.descartados).toHaveLength(0);
    expect(r.items[0]).toMatchObject({ porPeso: false, cantidad: 6, precio: 0.1 });
  });
});

// 9/11/2026, Ricardo Nini: la Playadito (3 bultos × 5) pintada con «-1» se leyó
// como devuelta entera. Volvió UN paquete: recibidas 14, entra lo que quedó.
describe('«recibidas» en un renglón marcado como devuelto entero', () => {
  it('deja de estar devuelto y entra lo recibido', () => {
    const yerba: any[] = [{ ...lectura(3, 3139.67, 47095.05), descripcion: 'PLAYADITO yerba c/palo 5x1', unidadesPorBulto: 5, sku: 'Y1', devueltoAMano: true, incluir: false }];
    const r = aplicarCambiosIA(yerba, [{ renglon: 1, campo: 'recibidas', valor: 14, motivo: 'volvió 1 paquete' }], () => false);
    expect(r.descartados).toHaveLength(0);
    expect(r.items[0]).toMatchObject({ recibidoAMano: 14, devueltoAMano: false, incluir: true });
  });
});
