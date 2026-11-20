import {
  cantidadEquivalente, conCantidad, enHorarioDeMensajes, leerSiNo, sePesa, soloCortesia, ordenarParecidos, puntajeParecido, textoDeCierre, textoDePregunta, textoParaQuienArma,
  enLista, leerVariedad, variedadesLimpias,
} from './reemplazos';

// «No hay ese sabor; de ese hay estos» (Leandro, 20/11/2026)
describe('la variedad que elige el cliente', () => {
  const HAY = ['lavanda', 'coco', 'vainilla'];
  it('nombra una sola: esa', () => {
    expect(leerVariedad('lavanda', HAY)).toEqual({ elegida: 'lavanda' });
    expect(leerVariedad('LAVANDA!!', HAY)).toEqual({ elegida: 'lavanda' });
    expect(leerVariedad('Hola, mandame la de coco porfa', HAY)).toEqual({ elegida: 'coco' });
    expect(leerVariedad('vainílla', HAY)).toEqual({ elegida: 'vainilla' });
  });
  it('dos, una que no está o una pregunta: no se decide sola', () => {
    expect(leerVariedad('lavanda y coco', HAY)).toBeNull();
    expect(leerVariedad('¿no tenés de naranja?', HAY)).toBeNull();
    expect(leerVariedad('sí', HAY)).toBeNull();
  });
  it('ninguna: no; con una sola opción, el sí la elige', () => {
    expect(leerVariedad('no', HAY)).toBe('no');
    expect(leerVariedad('ninguna, gracias', HAY)).toBe('no');
    expect(leerVariedad('dale', ['coco'])).toEqual({ elegida: 'coco' });
  });
  it('lo que anota quien arma queda limpio y la lista se lee bien', () => {
    expect(variedadesLimpias([' Lavanda ', 'lavanda', '', '«coco»;', null])).toEqual(['Lavanda', 'coco']);
    expect(enLista(['a', 'b', 'c'], '*')).toBe('*a*, *b* y *c*');
    expect(enLista(['a'])).toBe('a');
  });
});

// «Tengo parecido» y la consulta al cliente (Leandro y Jaqui, 20/11/2026).

describe('el sí o el no del cliente', () => {
  it.each([
    'Si', 'sí', 'SII', 'Siii dale', 'si dale', 'Sí, gracias', 'Dale', 'dalee', 'ok', 'Okey', 'Perfecto', 'Bueno', 'joya', 'de una',
    'Está bien', 'si si', 'Sí, me sirve', 'si mandalo', 'Hola, sí', 'Buenas! dale gracias', '👍', 'Si 👍', 'no hay problema', 'No pasa nada, mandalo',
    'listo', 'claro', 'genial gracias!!', 'Sí por favor', 'No tengo drama', 'ningún problema', 'si mandame la de 100', 'Si 😊',
  ])('«%s» es SÍ', (t) => expect(leerSiNo(t)).toBe('si'));

  it.each([
    'No', 'no', 'NO', 'Nooo', 'no gracias', 'No, gracias', 'mejor no', 'No me sirve', 'sacalo', 'no quiero', 'dejalo', '👎', 'nop',
    'Hola, no gracias', 'para nada',
  ])('«%s» es NO', (t) => expect(leerSiNo(t)).toBe('no'));

  it.each([
    '¿Y cuánto sale?', 'si pero mandame 3', 'no tenés la de 200?', 'sí, no', 'no, dale', 'Mejor otra marca',
    'Si hay de la otra mandame esa', 'No sé', 'Hola', 'te llamo', '',
    'si me lo pueden mandar mañana a la tarde también estaría bien porque hoy no estoy en casa',
    'No, está bien', 'no sé', 'gracias', 'Hola buenas tardes', 'Ok pero sin sal',
  ])('«%s» no se decide solo', (t) => expect(leerSiNo(t)).toBeNull());
});

describe('solo un saludo o un gracias', () => {
  it.each(['gracias', 'Muchas gracias!', 'Hola', 'buen día', '🙏', 'de nada'])('«%s» no contesta la pregunta', (t) => expect(soloCortesia(t)).toBe(true));
  it.each(['si', 'ok gracias', 'no gracias', '¿cuánto sale?', 'hola, sí'])('«%s» dice algo', (t) => expect(soloCortesia(t)).toBe(false));
});

const manteca = { nombre_falta: 'Manteca La Serenisima 200 gr', pide: 1, hay: 0, nombre_reemplazo: 'Manteca La Serenisima x 100 gr', cantidad: 2, precio: 3000 };

describe('lo que le llega al cliente', () => {
  it('la pregunta de Jaqui: no hay, en su lugar va, sí o no', () => {
    const t = textoDePregunta(manteca, { cliente: 'andrea chagas', codigo: 'DOM-87B017B4EA14', numero: 1, total: 1 });
    expect(t).toBe('Hola Andrea, te escribimos de ODB por tu pedido DOM-87B017B4EA14.\n\n*Manteca La Serenisima 200 gr* no hay. En su lugar va *2 × Manteca La Serenisima x 100 gr* ($6.000).\n\n¿Te sirve? Respondé *SÍ* o *NO*.');
  });

  it('un nombre que no es un nombre no se usa para saludar', () => {
    expect(textoDePregunta(manteca, { cliente: 'Cliente PedidosYa', codigo: 'X', numero: 1, total: 1 }).startsWith('Hola, te escribimos')).toBe(true);
    expect(textoDePregunta(manteca, { cliente: 'Sra. Gómez', codigo: 'X', numero: 1, total: 1 }).startsWith('Hola, te escribimos')).toBe(true);
    expect(textoDePregunta(manteca, { cliente: 'jaqueline', codigo: 'X', numero: 1, total: 1 }).startsWith('Hola Jaqueline,')).toBe(true);
  });

  it('con varios: la primera dice cuántos son, las siguientes arrancan con «Anotado»', () => {
    const primera = textoDePregunta(manteca, { cliente: null, codigo: 'PICKUP-1', numero: 1, total: 3 });
    expect(primera).toContain('Hola, te escribimos de ODB por tu pedido PICKUP-1. Nos faltan 3 productos y te consultamos de a uno.');
    expect(primera).toContain('(1 de 3) *Manteca La Serenisima 200 gr* no hay.');
    const segunda = textoDePregunta({ ...manteca, cantidad: 1 }, { cliente: 'Andrea', codigo: 'PICKUP-1', numero: 2, total: 3, anotado: true });
    expect(segunda.startsWith('Anotado ✔\n\n(2 de 3) *Manteca La Serenisima 200 gr* no hay. En su lugar va *Manteca La Serenisima x 100 gr* ($3.000).')).toBe(true);
  });

  it('si hay menos de lo que pidió, se ofrece por lo que falta', () => {
    const t = textoDePregunta({ ...manteca, pide: 3, hay: 1, cantidad: 4 }, { codigo: 'X', numero: 1, total: 1 });
    expect(t).toContain('De *Manteca La Serenisima 200 gr* pediste 3 y hay 1. Por las que faltan va *4 × Manteca La Serenisima x 100 gr* ($12.000).');
  });

  it('lo que se pesa va en gramos', () => {
    const t = textoDePregunta({ nombre_falta: 'Jamón crudo Serrano', pide: 0.25, hay: 0, nombre_reemplazo: 'Jamón crudo Parma', cantidad: 0.25, precio: 40000, faltaPorPeso: true, reemplazoPorPeso: true }, { codigo: 'X', numero: 1, total: 1 });
    expect(t).toContain('*Jamón crudo Serrano* no hay. En su lugar va *250 g de Jamón crudo Parma* ($10.000).');
  });

  it('al cerrar: cómo queda el pedido', () => {
    const t = textoDeCierre([
      { ...manteca, estado: 'aceptado' },
      { nombre_falta: 'Queso Adler', pide: 2, hay: 1, nombre_reemplazo: 'Queso Holanda', cantidad: 1, precio: 9000, estado: 'rechazado' },
    ], { cliente: 'Andrea', codigo: 'DOM-1', total: 25300 });
    expect(t).toBe('Anotado ✔ ¡Gracias, Andrea! Tu pedido DOM-1 queda así:\n✔ 2 × Manteca La Serenisima x 100 gr (en lugar de Manteca La Serenisima 200 gr)\n✖ Queso Adler: va solo 1\nTotal: $25.300.');
  });

  it('a quien arma: lo confirmado, el total y si hay que avisar a la caja', () => {
    const t = textoParaQuienArma([
      { ...manteca, estado: 'aceptado' },
      { nombre_falta: 'Queso Adler', pide: 1, hay: 0, nombre_reemplazo: 'Queso Holanda', cantidad: 1, precio: 9000, estado: 'rechazado' },
    ], { cliente: 'Andrea Chagas', codigo: 'DOM-1', total: 25300, totalAntes: 28500, pagado: true, link: 'https://sistema/salon' });
    expect(t.split('\n')).toEqual([
      'CAMBIOS CONFIRMADOS · DOM-1',
      'Andrea Chagas contestó:',
      '✔ SÍ: 2 × Manteca La Serenisima x 100 gr (por Manteca La Serenisima 200 gr)',
      '✖ NO: Queso Adler sale del pedido',
      'Total ahora: $25.300 (antes $28.500).',
      'Ya estaba pagado: avisale a la caja la diferencia.',
      'Sumá lo nuevo al carro y terminá el pedido.',
      'https://sistema/salon',
    ]);
  });
});

describe('qué se parece', () => {
  it('solo cuentas naturales: 1 de 200 g son 2 de 100 g; 2 de 500 g, 1 de 1 kg; si es raro, la misma cantidad', () => {
    expect(cantidadEquivalente(1, 'Manteca La Serenisima 200 gr', 'Manteca La Serenisima x 100 gr')).toBe(2);
    expect(cantidadEquivalente(2, 'Yerba x 500g', 'Yerba x 1 kg')).toBe(1);
    expect(cantidadEquivalente(1, 'Yerba x 500g', 'Yerba x 1 kg')).toBe(1);
    expect(cantidadEquivalente(1, 'Jugo Citric de naranja x 3 LT', 'Jugo Citric Naranja x  1l')).toBe(3);
    expect(cantidadEquivalente(1, 'Fernet Branca 750 ml', 'Fernet Branca 1 L')).toBe(1);
    expect(cantidadEquivalente(6, 'Quilmes lata 473', 'Brahma lata 473')).toBe(6);
    // casos reales del 20/11: daban 70 botellitas y 15 cajitas
    expect(cantidadEquivalente(24, 'Coca Cola Zero x1.75L', 'Coca Cola Zero botella x 600cc')).toBe(24);
    expect(cantidadEquivalente(3, 'Leche Cindor x 1lt', 'Leche Cindor x 200 cc')).toBe(3);
    expect(cantidadEquivalente(12, 'Villavicencio Con Gas Gas 1.5L x6un', 'Villavicencio sin gas x2lt')).toBe(12);
  });

  it('entre lo que se pesa y lo que va por unidad, por los gramos', () => {
    expect(cantidadEquivalente(0.3, { nombre: 'Mortadela Bocatti con pistacho', porPeso: true }, { nombre: 'Mini Mortadela con pistacho Cagnoli x 250grs' })).toBe(1);
    expect(cantidadEquivalente(0.5, { nombre: 'Jamón cocido', porPeso: true }, { nombre: 'Jamón cocido feteado x 250 g' })).toBe(2);
    expect(cantidadEquivalente(0.3, { nombre: 'Lomo ahumado', porPeso: true }, { nombre: 'Panceta 214 Ahumada' })).toBe(0.3);
    expect(cantidadEquivalente(2, { nombre: 'Queso Muzzarella La Tarantela  x 1kg' }, { nombre: 'Queso Muzzarella La Tarantela x fracccion', porPeso: true })).toBe(2);
    expect(cantidadEquivalente(4, { nombre: 'Queso Adler Jamon x 100g' }, { nombre: 'Queso de máquina', porPeso: true })).toBe(0.4);
    expect(cantidadEquivalente(0.25, { nombre: 'Jamón crudo', porPeso: true }, { nombre: 'Jamón crudo Parma', porPeso: true })).toBe(0.25);
  });

  it('pesa más lo que dice qué es que la marca o la góndola (casos reales del 20/11)', () => {
    const muzza = ordenarParecidos('Queso Muzzarella La Tarantela  x 1kg', [
      { id: 'cremon', nombre: 'Queso Cremoso Cremon LS  x 500g', stock: 64, vendidas: 900, mismaCategoria: true },
      { id: 'barraza', nombre: 'Queso Muzzarella Barraza  x 1klg', stock: 1, mismaCategoria: true },
      { id: 'taran', nombre: 'Queso Muzzarella La Tarantela x fracccion', stock: 40, mismaCategoria: false },
    ]);
    expect(muzza.slice(0, 2).map((x) => x.id).sort()).toEqual(['barraza', 'taran']);
    expect(muzza[2].id).toBe('cremon');
    const cheddar = ordenarParecidos('Queso Cheddar La Serenisima Finlandia x Fraccion', [
      { id: 'danbo', nombre: 'Queso Danbo La Serenisima x fraccion', stock: 10, vendidas: 500, mismaCategoria: true },
      { id: 'milkaut', nombre: 'Queso Cheddar  fetas Milkaut x fraccion', stock: 12, mismaCategoria: true },
    ]);
    expect(cheddar[0].id).toBe('milkaut');
    // otro fiambre de la misma góndola que solo comparte la marca no es parecido
    expect(ordenarParecidos('Panceta Ahumada Calchaqui x Fraccion', [{ id: 'm', nombre: 'Mortadela bocha Calchaqui x fraccion', stock: 100, mismaCategoria: true }])).toEqual([]);
  });

  it('lo que se pesa aunque no esté marcado: por el nombre o por los decimales', () => {
    expect(sePesa('Jamon Crudo Paladini Parma x fraccion', false)).toBe(true);
    expect(sePesa('Panceta 214 Ahumada', false, 0.2)).toBe(true);
    expect(sePesa('Manteca La Serenisima x 100 gr', false, 2)).toBe(false);
    expect(conCantidad(0.2, 'Panceta 214 Ahumada')).toBe('200 g de Panceta 214 Ahumada');
  });

  it('de otra góndola, solo lo que empieza igual (por la panceta, no las papas sabor panceta)', () => {
    const lista = ordenarParecidos('Panceta Ahumada Calchaqui x Fraccion', [
      { id: 'lays', nombre: 'Papas Fritas Lays Panceta x 77gr', stock: 3, mismaCategoria: false },
      { id: 'luv', nombre: 'Panceta Ahumada Luvianka', stock: 3.6, mismaCategoria: true },
      { id: '214', nombre: 'Panceta 214 Ahumada', stock: 3.2, mismaCategoria: true },
    ]);
    expect(lista.map((x) => x.id)).toEqual(['luv', '214']);
    const lomo = ordenarParecidos('Lomo ahumado Tronconi x fraccion', [
      { id: 'mila', nombre: 'Milanesa Pane de lomo x 1 K', stock: 22, mismaCategoria: false },
      { id: 'atun', nombre: 'Lomo de Atun Bahia en Aceite x 170grs', stock: 4, mismaCategoria: false },
      { id: 'boc', nombre: 'Lomo Bocatti con hierbas', stock: 57, mismaCategoria: true },
    ]);
    expect(lomo.map((x) => x.id)).toEqual(['boc', 'atun']);
  });

  it('para la manteca de 200: primero las mantecas, nunca el papel manteca ni los pochoclos', () => {
    const lista = ordenarParecidos('Manteca La Serenisima 200 gr', [
      { id: 'papel', nombre: 'Papel manteca familiar', stock: 5 },
      { id: 'pochoclo', nombre: 'Pochoclos con manteca y sal Sabores nuestros x 38gr', stock: 10 },
      { id: 'ls100', nombre: 'Manteca La Serenisima x 100 gr', stock: 45, vendidas: 300 },
      { id: 'paulina', nombre: 'Manteca La Paulina  x 200g', stock: 41, vendidas: 50 },
      { id: 'light', nombre: 'Manteca LS ligth x 200gr', stock: 28, vendidas: 80 },
      { id: 'sin', nombre: 'Manteca La Serenisima x 100 gr sin sal', stock: 0 },
      { id: 'yerba', nombre: 'Yerba Playadito 500g', stock: 90 },
    ]);
    expect(lista[0].id).toBe('ls100');
    expect(lista.slice(0, 3).map((x) => x.id).sort()).toEqual(['light', 'ls100', 'paulina']);
    expect(lista.map((x) => x.id)).not.toContain('yerba');
    expect(lista.map((x) => x.id)).not.toContain('sin');
    expect(puntajeParecido('Manteca La Serenisima 200 gr', 'Papel manteca familiar')).toBeLessThan(puntajeParecido('Manteca La Serenisima 200 gr', 'Manteca LS ligth x 200gr'));
  });
});

describe('horario de los mensajes', () => {
  it('de 8 a 22 de Buenos Aires', () => {
    expect(enHorarioDeMensajes(new Date('2026-11-20T07:30:00-03:00'))).toBe(false);
    expect(enHorarioDeMensajes(new Date('2026-11-20T08:00:00-03:00'))).toBe(true);
    expect(enHorarioDeMensajes(new Date('2026-11-20T21:59:00-03:00'))).toBe(true);
    expect(enHorarioDeMensajes(new Date('2026-11-20T22:00:00-03:00'))).toBe(false);
  });
});
