import { lineaDeLaCava, vinosDeLaRespuesta, type VinoDeLaCava } from './vinos-recomendados';

const vino = (v: Partial<VinoDeLaCava> & Pick<VinoDeLaCava, 'sku' | 'nombre' | 'precio'>): VinoDeLaCava => ({
  id: v.sku,
  categoria: 'Vino Tinto',
  descripcion: null,
  stock: 12,
  promo: null,
  ...v,
});

const CAVA: VinoDeLaCava[] = [
  vino({ sku: 'ALA750', nombre: 'Vino Alamos Malbec x750cc', precio: 9000 }),
  vino({ sku: 'TRA750', nombre: 'Vino Trapiche Reserva Cabernet Sauvignon x750cc', precio: 12500, promo: { nombre: 'Semana del Cabernet', antes: 14000 } }),
  vino({ sku: 'RUT750', nombre: 'Vino Rutini Cabernet Malbec x750cc', precio: 25000 }),
  vino({ sku: 'CHA750', nombre: 'Champagne Chandon Extra Brut x750cc', categoria: 'Champagne', precio: 18000 }),
  // mismo precio que el Alamos: no se tiene que colar
  vino({ sku: 'NOR750', nombre: 'Vino Norton Malbec Clásico x750cc', precio: 9000 }),
];

describe('lineaDeLaCava (lo que lee el modelo no cambia)', () => {
  it('el renglón de siempre, con la promo y la descripción', () => {
    expect(lineaDeLaCava({ ...CAVA[1], descripcion: 'Cuerpo medio' })).toBe(
      'TRA750 · Vino Trapiche Reserva Cabernet Sauvignon x750cc (Vino Tinto) · $12500 · PROMO "Semana del Cabernet" (antes $14000) · stock 12 — Cuerpo medio',
    );
    expect(lineaDeLaCava({ ...CAVA[0], categoria: null })).toBe('ALA750 · Vino Alamos Malbec x750cc · $9000 · stock 12');
  });
});

describe('vinosDeLaRespuesta (los recomendados van a la Placa roja, 2/10/2026)', () => {
  it('un vino por renglón: precio de la cava, promo, efectivo y el porqué', () => {
    const t = [
      'Para el asado te sugiero:',
      '- Alamos Malbec ($9.000): fruta roja y taninos suaves, acompaña bien la carne.',
      '- Trapiche Reserva Cabernet a $12.500 (promo, antes $14.000). Más estructura, ideal para cortes con hueso.',
      '¿Querés que te cuente de alguno más?',
    ].join('\n');
    const r = vinosDeLaRespuesta(t, CAVA);
    expect(r.recomendaciones).toEqual([
      { sku: 'ALA750', nombre: 'Vino Alamos Malbec x750cc', categoria: 'Vino Tinto', precio: 9000, precioEfectivo: 8100, promo: null, porque: 'Fruta roja y taninos suaves, acompaña bien la carne.' },
      { sku: 'TRA750', nombre: 'Vino Trapiche Reserva Cabernet Sauvignon x750cc', categoria: 'Vino Tinto', precio: 12500, precioEfectivo: 11250, promo: { nombre: 'Semana del Cabernet', antes: 14000 }, porque: 'Más estructura, ideal para cortes con hueso.' },
    ]);
    expect(r.introduccion).toBe('Para el asado te sugiero:');
    expect(r.cierre).toBe('¿Querés que te cuente de alguno más?');
  });

  it('sin viñetas, con el precio al final y el porqué antes', () => {
    const t = 'Alamos Malbec: frutado y fácil de tomar, a $9.000.\n\nRutini Cabernet Malbec, $25000. Para una ocasión especial.\n\n¿Te reservo alguno?';
    const r = vinosDeLaRespuesta(t, CAVA);
    expect(r.recomendaciones.map((v) => [v.sku, v.porque])).toEqual([
      ['ALA750', 'Frutado y fácil de tomar'],
      ['RUT750', 'Para una ocasión especial.'],
    ]);
    expect(r.introduccion).toBe('');
    expect(r.cierre).toBe('¿Te reservo alguno?');
  });

  it('el porqué en el renglón de abajo', () => {
    const t = '1. Alamos Malbec — $9.000\nFruta roja, ideal para el asado.\n2. Rutini Cabernet Malbec — $25.000\nMás cuerpo y guarda.';
    const r = vinosDeLaRespuesta(t, CAVA);
    expect(r.recomendaciones.map((v) => [v.sku, v.porque])).toEqual([
      ['ALA750', 'Fruta roja, ideal para el asado.'],
      ['RUT750', 'Más cuerpo y guarda.'],
    ]);
    expect(r.introduccion).toBe('');
    expect(r.cierre).toBe('');
  });

  it('en un párrafo: lo que presenta al vino antes de los dos puntos queda como texto', () => {
    const t = 'Para brindar va muy bien algo con burbujas: el Chandon Extra Brut, $18.000, fresco y seco. Si preferís tinto, el Alamos Malbec a $9.000 es suave y frutado.';
    const r = vinosDeLaRespuesta(t, CAVA);
    expect(r.recomendaciones.map((v) => [v.sku, v.porque])).toEqual([
      ['CHA750', 'Fresco y seco.'],
      ['ALA750', 'Es suave y frutado.'],
    ]);
    expect(r.introduccion).toBe('Para brindar va muy bien algo con burbujas:');
  });

  it('el champagne no lleva precio en efectivo (no entra en el descuento)', () => {
    const r = vinosDeLaRespuesta('Chandon Extra Brut a $18.000, para brindar.\nAlamos Malbec a $9.000, para la comida.', CAVA);
    expect(r.recomendaciones.map((v) => [v.sku, v.precioEfectivo])).toEqual([['CHA750', null], ['ALA750', 8100]]);
  });

  it('dos vinos en la misma oración: van a la placa sin porqué y el texto queda entero', () => {
    const t = 'Te sugiero el Alamos Malbec a $9.000 o el Rutini Cabernet Malbec a $25.000, según cuánto quieras gastar. ¿Para cuántos es?';
    const r = vinosDeLaRespuesta(t, CAVA);
    expect(r.recomendaciones.map((v) => [v.sku, v.porque])).toEqual([['ALA750', ''], ['RUT750', '']]);
    expect(r.introduccion).toBe(t);
    expect(r.cierre).toBe('');
  });

  it('si pregunta y no recomienda, no hay vinos y el texto queda como está', () => {
    const t = '¡Buenísimo! ¿Para qué comida lo buscás? ¿Y en qué presupuesto por botella pensás, hasta $15.000?';
    expect(vinosDeLaRespuesta(t, CAVA)).toEqual({ recomendaciones: [], introduccion: t, cierre: '' });
  });

  it('un vino que no está en la cava no aparece, aunque tenga precio', () => {
    const r = vinosDeLaRespuesta('- Catena Zapata Malbec Argentino a $90.000: un clásico.\n- Alamos Malbec a $9.000: rinde.', CAVA);
    expect(r.recomendaciones.map((v) => v.sku)).toEqual(['ALA750']);
    expect(r.introduccion).toBe('Catena Zapata Malbec Argentino a $90.000: un clásico.');
  });
});
