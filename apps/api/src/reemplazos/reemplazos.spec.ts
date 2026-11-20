import {
  cantidadEquivalente, enHorarioDeMensajes, leerSiNo, ordenarParecidos, puntajeParecido, textoDeCierre, textoDePregunta, textoParaQuienArma,
} from './reemplazos';

// «Tengo parecido» y la consulta al cliente (Leandro y Jaqui, 20/11/2026).

describe('el sí o el no del cliente', () => {
  it.each([
    'Si', 'sí', 'SII', 'Siii dale', 'si dale', 'Sí, gracias', 'Dale', 'dalee', 'ok', 'Okey', 'Perfecto', 'Bueno', 'joya', 'de una',
    'Está bien', 'si si', 'Sí, me sirve', 'si mandalo', 'Hola, sí', 'Buenas! dale gracias', '👍', 'Si 👍', 'no hay problema', 'No pasa nada, mandalo',
    'listo', 'claro', 'genial gracias!!', 'Sí por favor',
  ])('«%s» es SÍ', (t) => expect(leerSiNo(t)).toBe('si'));

  it.each([
    'No', 'no', 'NO', 'Nooo', 'no gracias', 'No, gracias', 'mejor no', 'No me sirve', 'sacalo', 'no quiero', 'dejalo', '👎', 'nop',
    'Hola, no gracias', 'para nada',
  ])('«%s» es NO', (t) => expect(leerSiNo(t)).toBe('no'));

  it.each([
    '¿Y cuánto sale?', 'si pero mandame 3', 'no tenés la de 200?', 'sí, no', 'no, dale', 'Mejor otra marca',
    'Si hay de la otra mandame esa', 'No sé', 'Hola', 'te llamo', '',
    'si me lo pueden mandar mañana a la tarde también estaría bien porque hoy no estoy en casa',
  ])('«%s» no se decide solo', (t) => expect(leerSiNo(t)).toBeNull());
});

const manteca = { nombre_falta: 'Manteca La Serenisima 200 gr', pide: 1, hay: 0, nombre_reemplazo: 'Manteca La Serenisima x 100 gr', cantidad: 2, precio: 3000 };

describe('lo que le llega al cliente', () => {
  it('la pregunta de Jaqui: no hay, en su lugar va, sí o no', () => {
    const t = textoDePregunta(manteca, { cliente: 'andrea chagas', codigo: 'DOM-87B017B4EA14', numero: 1, total: 1 });
    expect(t).toBe('Hola Andrea, te escribimos de ODB por tu pedido DOM-87B017B4EA14.\n\n*Manteca La Serenisima 200 gr* no hay. En su lugar va *2 × Manteca La Serenisima x 100 gr* ($6.000).\n\n¿Te sirve? Respondé *SÍ* o *NO*.');
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
  it('1 de 200 g son 2 de 100 g; 2 de 200 g son 1 de 400 g; si no da justo, la misma cantidad', () => {
    expect(cantidadEquivalente(1, 'Manteca La Serenisima 200 gr', 'Manteca La Serenisima x 100 gr')).toBe(2);
    expect(cantidadEquivalente(2, 'Yerba x 500g', 'Yerba x 1 kg')).toBe(1);
    expect(cantidadEquivalente(1, 'Yerba x 500g', 'Yerba x 1 kg')).toBe(1);
    expect(cantidadEquivalente(3, 'Coca Cola 1,5 L', 'Coca Cola 2,25 L')).toBe(2);
    expect(cantidadEquivalente(1, 'Fernet Branca 750 ml', 'Fernet Branca 1 L')).toBe(1);
    expect(cantidadEquivalente(6, 'Quilmes lata 473', 'Brahma lata 473')).toBe(6);
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
