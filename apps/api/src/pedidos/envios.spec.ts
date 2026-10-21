import { armarEnvio, avisoAlCliente, clasificar, cobroDe, diaLegible, indicacionesDe, medioPorDefecto, ordenarEnvios, textoDeEntrega, whatsappDe, type FilaEnvio, lineaDeCambioDeEnvio } from './envios';

// Envíos a domicilio (Leandro, 21/10/2026: «misma basura»). Los casos son los
// cuatro envíos vivos de producción ese día.
const AHORA = new Date('2026-10-21T14:00:00-03:00'); // miércoles 21/10, 14 h en Canning

const YD5GNY: FilaEnvio = {
  id: '45771560-aaaa-bbbb-cccc-000000000001', canal: 'domicilio', estado: 'en_camino', total: '13650.00', qr_retiro: 'DOM-YD5GNY', origen: 'web',
  creado_en: '2026-08-21T21:51:07Z', preparacion_en: '2026-08-25T18:24:39Z', listo_en: '2026-08-28T16:28:29Z', en_camino_en: '2026-08-28T16:28:34Z',
  notas: 'WhatsApp: </antml name diretipo">domicilio', forma_pago: null, destino_direccion: 'St Thomas Norte, lote 118',
  cliente: { nombre: 'St Thomas 118 Jimena', telefono: '1144444892' },
  items: [{ cantidad: 3, precio_unitario: 3500, producto: { sku: 'AGU-1', nombre: 'Agua Villavicencio 1,5 L x6' } }, { cantidad: 1, precio_unitario: 3150, producto: { sku: 'LAC-1', nombre: 'Crema La Serenísima 520 g' } }],
};
const EFB1: FilaEnvio = {
  id: 'efb1', canal: 'domicilio', estado: 'recibido', total: '105600.00', qr_retiro: 'DOM-EFB1F49E3E30', origen: 'bot', creado_en: '2026-10-10T13:18:34Z',
  notas: 'Griller. Paga en efectivo al recibir. Sin factura A, con remito.', forma_pago: 'efectivo', destino_direccion: 'Av Mariano Castex 1148',
  cliente: { nombre: 'Eloy o Lucas', telefono: '5491124529390' }, items: [{ cantidad: 1, precio_unitario: 105600, producto: { sku: 'X', nombre: 'Griller' } }],
};
const EE97: FilaEnvio = {
  id: 'ee97', canal: 'domicilio', estado: 'recibido', total: 77000, qr_retiro: 'DOM-EE976E419B78', origen: 'bot', creado_en: '2026-10-14T02:06:22Z',
  entrega_fecha: '2026-10-14', notas: 'Paga con transferencia', forma_pago: 'transferencia', destino_direccion: 'Lote 95, Barrio La Alameda',
  cliente: { nombre: '💪🏿 Alameda 95', telefono: '1155617246' }, items: [],
};

describe('en qué grupo va cada envío', () => {
  it('«En camino» desde agosto: atrasado y con la pregunta directa', () => {
    const c = clasificar(YD5GNY, AHORA);
    expect(c.grupo).toBe('atrasado');
    expect(c.atraso?.motivo).toBe('en_la_calle');
    expect(c.atraso?.texto).toBe('Salió hace 54 días y nadie lo marcó entregado');
    expect(c.paraCerrar).toBe(true);
  });

  it('salió hace 2 horas: está en la calle, no atrasado', () => {
    expect(clasificar({ ...YD5GNY, en_camino_en: '2026-10-21T12:00:00-03:00' }, AHORA)).toEqual({ grupo: 'hoy', atraso: null, paraCerrar: false });
  });

  it('salió hace 13 horas: atrasado (en la calle más de 12 h)', () => {
    expect(clasificar({ ...YD5GNY, en_camino_en: '2026-10-21T01:00:00-03:00' }, AHORA).grupo).toBe('atrasado');
  });

  it('la fecha pactada ya pasó: atrasado, con el día y cuánto hace', () => {
    const c = clasificar(EE97, AHORA);
    expect(c.grupo).toBe('atrasado');
    expect(c.atraso?.motivo).toBe('fecha');
    expect(c.atraso?.texto).toBe('La entrega era el miércoles 14/10 (hace 7 días)');
    expect(c.paraCerrar).toBe(true);
  });

  it('era para ayer: atrasado pero todavía no se pregunta si se entregó', () => {
    const c = clasificar({ ...EE97, creado_en: '2026-10-19T10:00:00-03:00', entrega_fecha: '2026-10-20' }, AHORA);
    expect(c.atraso?.texto).toBe('La entrega era el martes 20/10 (ayer)');
    expect(c.paraCerrar).toBe(false);
  });

  it('sin fecha y nadie lo tocó en 11 días: atrasado por quieto', () => {
    const c = clasificar(EFB1, AHORA);
    expect(c.grupo).toBe('atrasado');
    expect(c.atraso?.motivo).toBe('sin_moverse');
    expect(c.atraso?.texto).toBe('Entró hace 11 días y nadie lo movió');
  });

  it('entró hace 3 horas, sin fecha: para hoy', () => {
    expect(clasificar({ ...EFB1, creado_en: '2026-10-21T11:00:00-03:00' }, AHORA).grupo).toBe('hoy');
  });

  it('pactado para hoy, aunque haya entrado hace días: para hoy (no es atraso esperar el día)', () => {
    expect(clasificar({ ...EE97, creado_en: '2026-10-15T10:00:00-03:00', entrega_fecha: '2026-10-21' }, AHORA).grupo).toBe('hoy');
  });

  it('con fecha futura: programado', () => {
    expect(clasificar({ ...EE97, entrega_fecha: '2026-10-23' }, AHORA)).toEqual({ grupo: 'programado', atraso: null, paraCerrar: false });
  });

  it('listo hace 30 horas: atrasado, todavía sin la pregunta; a las 48 h, con la pregunta', () => {
    const listo = { ...EFB1, estado: 'listo', creado_en: '2026-10-18T10:00:00-03:00', listo_en: '2026-10-20T08:00:00-03:00' };
    const c = clasificar(listo, AHORA);
    expect(c.atraso?.texto).toBe('Está listo hace 30 h y nadie lo movió');
    expect(c.paraCerrar).toBe(false);
    expect(clasificar({ ...listo, listo_en: '2026-10-19T08:00:00-03:00' }, AHORA).paraCerrar).toBe(true);
  });

  it('a las 22 h de Buenos Aires sigue siendo hoy (no el día de Londres)', () => {
    const noche = new Date('2026-10-21T22:30:00-03:00');
    expect(clasificar({ ...EE97, creado_en: '2026-10-21T20:00:00-03:00', entrega_fecha: '2026-10-21' }, noche).grupo).toBe('hoy');
  });
});

describe('cuándo se entrega', () => {
  it.each([
    [null, null, 'Lo antes posible'],
    [null, 'tarde', 'Lo antes posible, a la tarde'],
    ['2026-10-21', 'tarde', 'Hoy a la tarde'],
    ['2026-10-22', null, 'Mañana'],
    ['2026-10-23', 'mañana', 'viernes 23/10 a la mañana'],
    ['2026-10-14', null, 'Era el miércoles 14/10'],
  ])('%s %s → %s', (fecha, franja, texto) => {
    expect(textoDeEntrega(fecha, franja, AHORA)).toBe(texto);
  });
  it('el día de la semana sale bien', () => {
    expect(diaLegible('2026-10-14')).toBe('miércoles 14/10');
    expect(diaLegible('2026-11-01')).toBe('domingo 1/11');
  });
});

describe('cómo se cobra', () => {
  it('transferencia o efectivo: se cobra al entregar y se propone ese medio', () => {
    expect(cobroDe(EE97)).toEqual({ pagado: false, medio: 'transferencia', preguntar: true, texto: 'Se cobra al entregar: transferencia' });
    expect(cobroDe(EFB1).medio).toBe('efectivo');
  });
  it('pagado con Mercado Pago o de PedidosYa: no se cobra nada en la puerta', () => {
    expect(cobroDe({ ...EE97, pagado_en: '2026-10-14T03:00:00Z' })).toMatchObject({ pagado: true, preguntar: false, texto: 'Pagado con Mercado Pago' });
    expect(cobroDe({ qr_retiro: 'PY-123', forma_pago: null })).toMatchObject({ pagado: true, texto: 'Lo cobra PedidosYa' });
  });
  it('dijo Mercado Pago y el pago no entró, o no dijo nada: se pregunta en la puerta', () => {
    expect(cobroDe({ forma_pago: 'mercadopago' })).toMatchObject({ pagado: false, medio: null, preguntar: true });
    expect(cobroDe(YD5GNY).texto).toBe('Se cobra al entregar (no dijo cómo paga)');
  });
  it('al entregar sin elegir, se usa lo que dijo el cliente si se puede cobrar en la puerta', () => {
    expect(medioPorDefecto('transferencia')).toBe('transferencia');
    expect(medioPorDefecto('cuenta_corriente')).toBeNull();
    expect(medioPorDefecto('mercadopago')).toBeNull();
    expect(medioPorDefecto(null)).toBeNull();
  });
});

describe('indicaciones limpias', () => {
  it('la basura de DOM-YD5GNY no llega a la pantalla', () => {
    expect(indicacionesDe(YD5GNY.notas, null)).toBeNull();
  });
  it('la forma de pago sale de las indicaciones cuando ya tiene su renglón', () => {
    expect(indicacionesDe(EFB1.notas, 'efectivo')).toBe('Griller. Sin factura A, con remito.');
    expect(indicacionesDe('Paga con transferencia', 'transferencia')).toBeNull();
  });
  it('si no se sabe cómo paga, la nota queda entera (no se pierde el dato)', () => {
    expect(indicacionesDe('Paga en efectivo al recibir. Tocar timbre 2', null)).toBe('Paga en efectivo al recibir. Tocar timbre 2');
  });
  it('una frase que habla del pago y de otra cosa no se toca', () => {
    expect(indicacionesDe('Paga en efectivo, tiene cambio de $20.000', 'efectivo')).toBe('Paga en efectivo, tiene cambio de $20.000');
  });
});

describe('el envío completo', () => {
  it('trae a quién, su WhatsApp, qué lleva, cómo se cobra y las indicaciones limpias', () => {
    const e = armarEnvio(EFB1, { ahora: AHORA });
    expect(e.cliente).toEqual({ nombre: 'Eloy o Lucas', telefono: '5491124529390', whatsapp: '5491124529390' });
    expect(e.items).toEqual([{ cantidad: 1, nombre: 'Griller', sku: 'X', precio: 105600, subtotal: 105600 }]);
    expect(e.total).toBe(105600);
    expect(e.indicaciones).toBe('Griller. Sin factura A, con remito.');
    expect(e.cobro.medio).toBe('efectivo');
    expect(e.codigo).toBe('DOM-EFB1F49E3E30');
    expect(e.repartidor).toBeNull();
  });

  it('el teléfono de la ficha sin 549 igual sirve para WhatsApp', () => {
    expect(armarEnvio(YD5GNY, { ahora: AHORA }).cliente.whatsapp).toBe('5491144444892');
    expect(whatsappDe('1522812200')).toBeNull(); // sin código de área no se inventa
  });

  it('sin ficha, el nombre y el teléfono que dejó al comprar', () => {
    const e = armarEnvio({ ...EFB1, cliente: null, contacto_nombre: 'Jimena', contacto_telefono: '5491133334444' }, { ahora: AHORA });
    expect(e.cliente.nombre).toBe('Jimena');
    expect(e.cliente.whatsapp).toBe('5491133334444');
  });

  it('la nota basura no llega ni por el campo viejo', () => {
    const e = armarEnvio(YD5GNY, { ahora: AHORA });
    expect(e.notas).toBeNull();
    expect(e.indicaciones).toBeNull();
  });

  it('con el repartidor en la calle y coordenadas, cuánto le falta', () => {
    const e = armarEnvio(
      { ...YD5GNY, en_camino_en: '2026-10-21T13:30:00-03:00', repartidor_id: 'u-1', destino_lat: -34.86, destino_lng: -58.5, repartidor_lat: -34.87, repartidor_lng: -58.5 },
      { ahora: AHORA, nombres: new Map([['u-1', 'Rubén']]) },
    );
    expect(e.repartidor).toEqual({ id: 'u-1', nombre: 'Rubén' });
    expect(e.enVivo?.distanciaM).toBeGreaterThan(1000);
    expect(e.enVivo?.etaMin).toBeGreaterThanOrEqual(3);
  });

  it('atrasados primero (el más viejo arriba), después hoy y programados', () => {
    const hoy = armarEnvio({ ...EFB1, id: 'hoy', creado_en: '2026-10-21T11:00:00-03:00' }, { ahora: AHORA });
    const prog = armarEnvio({ ...EE97, id: 'prog', entrega_fecha: '2026-10-25' }, { ahora: AHORA });
    const lista = ordenarEnvios([prog, hoy, armarEnvio(EE97, { ahora: AHORA }), armarEnvio(YD5GNY, { ahora: AHORA }), armarEnvio(EFB1, { ahora: AHORA })]);
    expect(lista.map((e) => e.id)).toEqual([YD5GNY.id, 'efb1', 'ee97', 'hoy', 'prog']);
  });
});

describe('el WhatsApp al cliente', () => {
  it('un envío a domicilio listo NO lo manda a retirar a la sucursal', () => {
    const t = avisoAlCliente({ canal: 'domicilio', qr_retiro: 'DOM-1' }, 'listo');
    expect(t).toBe('Su pedido de O.D.B (DOM-1) ya está preparado. En breve sale hacia su domicilio.');
    expect(t).not.toMatch(/retirar|sucursal/i);
  });
  it('un retiro listo sigue diciendo dónde retirarlo', () => {
    expect(avisoAlCliente({ canal: 'pickup', qr_retiro: 'PICKUP-1' }, 'listo')).toMatch(/listo para retirar\. Código: PICKUP-1\. Lo esperamos/);
  });
  it('los pasos que no se avisan no tienen texto', () => {
    expect(avisoAlCliente({ canal: 'domicilio' }, 'en_preparacion')).toBeNull();
    expect(avisoAlCliente({ canal: 'domicilio' }, 'cancelado')).toBeNull();
  });
});

describe('el historial de un cambio de envío', () => {
  it('dice cómo quedó la entrega completa y la dirección nueva', () => {
    expect(lineaDeCambioDeEnvio({ despues: { entrega_franja: 'tarde' }, entrega: { fecha: '2026-10-23', franja: 'tarde' } })).toBe('Cambió el envío: se entrega viernes 23/10 a la tarde');
    expect(lineaDeCambioDeEnvio({ despues: { entrega_fecha: null }, entrega: { fecha: null, franja: null } })).toBe('Cambió el envío: se entrega lo antes posible');
    expect(lineaDeCambioDeEnvio({ despues: { destino_direccion: 'St Thomas Norte, lote 118' } })).toBe('Cambió el envío: dirección: St Thomas Norte, lote 118');
    expect(lineaDeCambioDeEnvio(null)).toBe('Cambió el envío');
  });
});
