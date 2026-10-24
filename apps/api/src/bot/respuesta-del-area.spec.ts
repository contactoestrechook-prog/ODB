import {
  consultaDelDatoNuevo, cuentaSinCita, elegirReferencia, HORAS_SIN_CITA, MINUTOS_SIN_CITA_DESDE_LA_LINEA, origenDelDatoNuevo,
  pareceRespuestaDesdeLaLinea, type Pendiente,
} from './respuesta-del-area';

// Las reglas de la respuesta del área (24/10/2026). Los textos son los que se
// escribieron de verdad en el chat de la línea con administración (21/10).

const AHORA = Date.parse('2026-10-21T13:55:00Z'); // 10:55 en Buenos Aires
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const consulta = (id: string, minutos: number, extra: Partial<Pendiente> = {}): Pendiente => ({ id, waha_msg_id: `true_5491125213601@c.us_W-${id}`, creado_en: hace(minutos), ...extra });

describe('con cita: es la respuesta a lo citado, desde cualquiera de los dos teléfonos', () => {
  it('citando la consulta (id largo o corto) desde el área o desde la línea', () => {
    const c = consulta('ENTRADAS', 4);
    for (const origen of ['area', 'linea'] as const) {
      expect(elegirReferencia({ origen, citado: 'W-ENTRADAS', consultas: [c], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: c });
      expect(elegirReferencia({ origen, citado: 'true_5491125213601@c.us_W-ENTRADAS', consultas: [c], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: c });
    }
  });

  it('una cita vieja sigue identificando su consulta (sin ventana de tiempo)', () => {
    const vieja = consulta('VIEJA', 10 * 24 * 60);
    expect(elegirReferencia({ origen: 'linea', citado: 'W-VIEJA', consultas: [vieja, consulta('OTRA', 2)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: vieja });
  });

  it('citando el «Dato nuevo» de una consulta: es esa consulta', () => {
    const c = consulta('PICADA', 40);
    expect(elegirReferencia({ origen: 'area', citado: 'W-DATO', consultaDelDato: 'PICADA', consultas: [c, consulta('OTRA', 3)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: c });
  });

  it('citando un pago: es ese pago, también desde la línea', () => {
    const p = { id: 'P1', waha_msg_id: 'W-PAGO', creado_en: hace(60) };
    expect(elegirReferencia({ origen: 'linea', citado: 'W-PAGO', consultas: [consulta('X', 2)], pagos: [p], ahora: AHORA })).toEqual({ tipo: 'pago', fila: p });
  });

  it('citando otra cosa: desde el área se pide citar; desde la línea no se dice nada', () => {
    const base = { citado: 'W-CUALQUIERA', consultas: [consulta('A', 2)], pagos: [], ahora: AHORA };
    expect(elegirReferencia({ ...base, origen: 'area' })).toEqual({ tipo: 'pedir_referencia' });
    expect(elegirReferencia({ ...base, origen: 'linea' })).toMatchObject({ tipo: 'nada' });
  });
});

describe('sin cita, desde el teléfono de administración', () => {
  it('las 159 pendientes de días atrás ya no traban: con una sola de las últimas 48 h, es esa', () => {
    const viejas = Array.from({ length: 159 }, (_, i) => consulta(`V${i}`, (HORAS_SIN_CITA + 1 + i) * 60));
    const nueva = consulta('NOEL', 25);
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [...viejas, nueva], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: nueva });
  });

  it('dos de las últimas 48 h: se pide citar', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [consulta('A', 30), consulta('B', 20 * 60)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'pedir_referencia' });
  });

  it('una consulta y un pago recientes: se pide citar', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [consulta('A', 30)], pagos: [{ id: 'P', creado_en: hace(10) }], ahora: AHORA })).toEqual({ tipo: 'pedir_referencia' });
  });

  it('un solo pago reciente (y pagos viejos): es ese pago', () => {
    const p = { id: 'P', creado_en: hace(10) };
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [], pagos: [p, { id: 'VIEJO', creado_en: hace(5 * 24 * 60) }], ahora: AHORA })).toEqual({ tipo: 'pago', fila: p });
  });

  it('con un aviso de pedido del día y un pendiente: el «ok» puede ser del pedido, se pide citar', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [], pagos: [{ id: 'P', creado_en: hace(10) }], avisosDelDia: 1, ahora: AHORA })).toEqual({ tipo: 'pedir_referencia' });
  });

  it('sin fecha de creación cuenta, como antes (dos pagos sin fecha: se pide citar)', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [], pagos: [{ id: 'p1' }, { id: 'p2' }], ahora: AHORA })).toEqual({ tipo: 'pedir_referencia' });
  });

  it('una consulta que ya tiene la respuesta anotada no toma otra', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [consulta('YA', 10, { respuesta_admin: 'Sí, hay' }), consulta('NUEVA', 5)], pagos: [], ahora: AHORA }))
      .toEqual({ tipo: 'consulta', fila: expect.objectContaining({ id: 'NUEVA' }) });
  });

  it('nada pendiente: nada', () => {
    expect(elegirReferencia({ origen: 'area', citado: null, consultas: [consulta('V', HORAS_SIN_CITA * 60 + 5)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'nada', motivo: 'sin consultas o pagos pendientes' });
  });
});

describe('sin cita, desde el teléfono de la línea (21/10: «Siii quedan» a la consulta de las entradas)', () => {
  it('una sola consulta de los últimos 30 min: es esa', () => {
    const c = consulta('ENTRADAS', 3);
    expect(elegirReferencia({ origen: 'linea', citado: null, consultas: [c, consulta('VIEJA', 3 * 60)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'consulta', fila: c });
  });

  it('la consulta de hace más de 30 min ya no cuenta sin cita', () => {
    expect(elegirReferencia({ origen: 'linea', citado: null, consultas: [consulta('A', MINUTOS_SIN_CITA_DESDE_LA_LINEA + 1)], pagos: [], ahora: AHORA }))
      .toEqual({ tipo: 'nada', motivo: 'no hay una consulta reciente para esto' });
  });

  it('dos consultas recientes: se pide citar', () => {
    expect(elegirReferencia({ origen: 'linea', citado: null, consultas: [consulta('A', 3), consulta('B', 10)], pagos: [], ahora: AHORA })).toEqual({ tipo: 'pedir_referencia' });
  });

  it('un pago nunca se confirma sin citar desde la línea (aunque sea el único)', () => {
    expect(elegirReferencia({ origen: 'linea', citado: null, consultas: [], pagos: [{ id: 'P', creado_en: hace(2) }], ahora: AHORA })).toMatchObject({ tipo: 'nada' });
  });

  it('los avisos de pedidos del día no cuentan desde la línea', () => {
    const c = consulta('A', 3);
    expect(elegirReferencia({ origen: 'linea', citado: null, consultas: [c], pagos: [], avisosDelDia: 3, ahora: AHORA })).toEqual({ tipo: 'consulta', fila: c });
  });
});

describe('¿parece una respuesta para el cliente? (lo escrito sin citar desde la línea)', () => {
  it('las respuestas reales del 21/10 sí', () => {
    for (const t of ['Siii quedan', 'Si hay', 'Si si podemos entregar', 'Ya sale a reparto', 'Si hay 1k mignones', 'Si perfecto podemos tomarla para el sábado', 'Si', 'Bebible', 'Rutini es de cartón Angélica es de cartón pero tipo felpudo con textura']) {
      expect(pareceRespuestaDesdeLaLinea(t)).toBe(true);
    }
  });

  it('los teléfonos, los contactos y las listas con teléfono, no', () => {
    for (const t of ['+54 9 11 5160-4731', 'Suegra Jordi +54 9 11 6750-9996', 'Jimena La Horqueta 148 +54 9 11 5385-0001', '1151604731']) {
      expect(pareceRespuestaDesdeLaLinea(t)).toBe(false);
    }
  });

  it('precios, horarios y fechas no son un teléfono', () => {
    for (const t of ['Sale $79.500 y pican 6', 'De 11 a 19 hs', 'Para el 30/10/2026 quedan 12', 'Cuestan $44.500 cada una']) {
      expect(pareceRespuestaDesdeLaLinea(t)).toBe(true);
    }
  });

  it('un agradecimiento o emojis solos, no', () => {
    for (const t of ['Gracias', 'muchas gracias!!', '👍', '🙏🏻', '']) expect(pareceRespuestaDesdeLaLinea(t)).toBe(false);
  });

  it('un reenvío o un archivo, no', () => {
    expect(pareceRespuestaDesdeLaLinea('1 smirnoff mango 1 smirnoff normal', { reenviado: true })).toBe(false);
    expect(pareceRespuestaDesdeLaLinea('📄 Archivo enviado', { conArchivo: true })).toBe(false);
  });

  it('lo que escribe el sistema en ese chat, no', () => {
    for (const t of [
      '❓ Consulta de un cliente (Administración)', 'Dato nuevo para una consulta que sigue sin respuesta (administracion)', 'Respondé CITANDO el aviso exacto de la consulta o del pago.',
      'PEDIDO NUEVO · PICKUP-5F2451C6C111', 'Listo, le avisé a Juan que todavía no figura', 'Listo: se lo pasé a Cliente.', '⏳ Consulta sin respuesta: pasó a una persona',
      '💳 Comprobante recibido por WhatsApp', '🧾 Proveedor por una factura', 'No le dije nada a Andrea sobre su pago de $50.000.', 'Para que le llegue al cliente, respondé CITANDO la consulta: hay más de una abierta.',
    ]) {
      expect(pareceRespuestaDesdeLaLinea(t)).toBe(false);
    }
  });

  it('algo larguísimo, no', () => {
    expect(pareceRespuestaDesdeLaLinea('a'.repeat(1001))).toBe(false);
  });
});

describe('el «Dato nuevo» queda anotado con su consulta', () => {
  it('ida y vuelta del origen en bot_envios', () => {
    expect(consultaDelDatoNuevo(origenDelDatoNuevo('29457dec-4de0'))).toBe('29457dec-4de0');
    expect(consultaDelDatoNuevo('aviso-interno')).toBeNull();
    expect(consultaDelDatoNuevo('consulta-dato:')).toBeNull();
    expect(consultaDelDatoNuevo(null)).toBeNull();
  });
});

describe('cuentaSinCita', () => {
  it('ventanas: 48 h desde el área, 30 min desde la línea', () => {
    const f = { id: 'x', creado_en: hace(40) };
    expect(cuentaSinCita(f, { esConsulta: true, origen: 'area', ahora: AHORA })).toBe(true);
    expect(cuentaSinCita(f, { esConsulta: true, origen: 'linea', ahora: AHORA })).toBe(false);
  });
  it('un pago con una respuesta anterior no concluyente sigue contando', () => {
    expect(cuentaSinCita({ id: 'p', creado_en: hace(5), respuesta_admin: 'lo reviso' }, { esConsulta: false, origen: 'area', ahora: AHORA })).toBe(true);
  });
});
