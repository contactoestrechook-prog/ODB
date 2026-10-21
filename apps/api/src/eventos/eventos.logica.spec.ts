import {
  comprasGrandes,
  cumpleanosProximos,
  umbralCompraGrande,
  diasEntre,
  empresasFinDeAno,
  esEmpresa,
  eventoDeCumple,
  faltaColumna,
  hoyBA,
  limpiarDatosEvento,
  limpiarItems,
  motivoTelefono,
  nombreDePila,
  nombreSugerido,
  pasarExtrasANotas,
  proximoCumple,
  resumenEventos,
  siguienteEtapa,
  sumarDias,
  telDiez,
  temporadaFinDeAno,
  telefonoLimpio,
  type EventoLiviano,
} from './eventos.logica';

const HOY = '2026-10-21';
const ev = (p: Partial<EventoLiviano>): EventoLiviano => ({
  id: 'e1', cliente_id: 'c1', tipo: 'otro', estado: 'prospecto', fecha: null, creado_en: '2026-10-01T10:00:00Z', ...p,
});

describe('fechas', () => {
  it('hoy en Buenos Aires, no en Londres', () => {
    // 21/10 a las 23:30 en Buenos Aires = 22/10 02:30 UTC
    expect(hoyBA(new Date('2026-10-22T02:30:00Z'))).toBe('2026-10-21');
  });
  it('suma y resta días cruzando meses', () => {
    expect(sumarDias('2026-10-21', 11)).toBe('2026-11-01');
    expect(sumarDias('2026-01-05', -10)).toBe('2025-12-26');
    expect(diasEntre('2026-10-21', '2026-10-28')).toBe(7);
    expect(diasEntre('2026-10-21', '2026-10-20T23:00:00Z')).toBe(-1);
  });
});

describe('etapas y nombres', () => {
  it('cada etapa sabe cuál sigue; realizado y cancelado no siguen', () => {
    expect(siguienteEtapa('prospecto')).toBe('propuesta');
    expect(siguienteEtapa('propuesta')).toBe('confirmado');
    expect(siguienteEtapa('confirmado')).toBe('realizado');
    expect(siguienteEtapa('realizado')).toBeNull();
    expect(siguienteEtapa('cancelado')).toBeNull();
  });

  it('nombre sugerido: primer nombre en lo personal, nombre entero en lo de empresa', () => {
    expect(nombreSugerido('casamiento', 'Ana  Pérez')).toBe('Casamiento de Ana');
    expect(nombreSugerido('cumpleanos', 'Joaquín')).toBe('Cumpleaños de Joaquín');
    expect(nombreSugerido('fin_de_ano', 'Estudio Pérez SRL')).toBe('Fin de año de Estudio Pérez SRL');
    expect(nombreSugerido('corporativo', 'Banco Sur')).toBe('Evento de Banco Sur');
    expect(nombreSugerido('otro', null)).toBe('Evento');
    expect(nombreSugerido('cualquiera', '')).toBe('Evento');
  });

  it('clientes cargados por lote o barrio (cerca de 900 en la base): el nombre de pila o solo el tipo', () => {
    // nombres reales de la base del 21/10/2026
    expect(nombreSugerido('cumpleanos', 'St Thomas 118 Jimena')).toBe('Cumpleaños de Jimena');
    expect(nombreSugerido('casamiento', 'Campos 147 Hector')).toBe('Casamiento de Hector');
    expect(nombreSugerido('cumpleanos', 'St Thomas Este 232 Karina')).toBe('Cumpleaños de Karina');
    expect(nombreSugerido('cumpleanos', 'Don Joaquin 196 (Martin)')).toBe('Cumpleaños de Martin');
    expect(nombreSugerido('cumpleanos', 'Rocio 177 (ruben)')).toBe('Cumpleaños de Ruben');
    expect(nombreSugerido('cumpleanos', 'Venado 2 Lote 149 Guille')).toBe('Cumpleaños de Guille');
    expect(nombreSugerido('cumpleanos', 'Valeria Guerrero St Thomas Este 194')).toBe('Cumpleaños de Valeria');
    expect(nombreSugerido('otro', 'Romina Evento 13.12 St Thomas Este')).toBe('Festejo de Romina');
    // sin nombre de pila: solo el tipo, nunca "Cumpleaños de St"
    expect(nombreSugerido('cumpleanos', 'Campos 51')).toBe('Cumpleaños');
    expect(nombreSugerido('cumpleanos', 'Lauquen Fr 18 Lote 10')).toBe('Cumpleaños');
    expect(nombreSugerido('casamiento', 'Cliente Trivento')).toBe('Casamiento');
    expect(nombreSugerido('cumpleanos', 'Santa Ines 201 Ex Horqueta 194')).toBe('Cumpleaños');
    expect(nombreSugerido('cumpleanos', '💪🏿 Alameda 95')).toBe('Cumpleaños');
    expect(nombreDePila('St Thomas 02')).toBeNull();
    // las empresas van con el nombre entero
    expect(nombreSugerido('fin_de_ano', 'St Thomas 02')).toBe('Fin de año de St Thomas 02');
  });

  it('teléfono: los diez dígitos de un número con característica', () => {
    expect(telefonoLimpio('11 2281-2200')).toBe('1122812200');
    expect(telefonoLimpio('+54 9 11 2281 2200')).toBe('1122812200');
    expect(telefonoLimpio('011 15 2281-2200')).toBe('1122812200');
    expect(telefonoLimpio('11 15 2281 2200')).toBe('1122812200');
    expect(telefonoLimpio('2224 47-1234')).toBe('2224471234');
    expect(telefonoLimpio('+598 99 123 456')).toBe('59899123456'); // de otro país, tal cual
    expect(telefonoLimpio('123')).toBeNull();
    expect(telefonoLimpio('2281-2200')).toBeNull(); // sin característica
    expect(telefonoLimpio(null)).toBeNull();
  });

  it('teléfono: un celular anotado con 15 y sin característica no sirve', () => {
    // tel_diez('1522812200') da '1522812200': no encuentra al cliente 11 2281-2200,
    // daba de alta otro y el wa.me iba a 5491522812200, que no existe
    expect(telDiez('15 2281-2200')).toBe('1522812200');
    expect(telefonoLimpio('15 2281-2200')).toBeNull();
    expect(telefonoLimpio('1522812200')).toBeNull();
    expect(telefonoLimpio('15')).toBeNull();
    expect(motivoTelefono('15 2281-2200')).toMatch(/^Falta la característica: .*11 2281-2200 y no 15 2281-2200/);
    expect(motivoTelefono('123')).toMatch(/con característica/);
  });

  it('telDiez da lo mismo que tel_diez() de la base', () => {
    expect(telDiez('+54 9 11 2281-2200')).toBe('1122812200');
    expect(telDiez('541122812200')).toBe('1122812200');
    expect(telDiez('5401122812200')).toBe('1122812200');
    expect(telDiez('0011 2281 2200')).toBe('1122812200');
    expect(telDiez('111522812200')).toBe('1122812200');
    expect(telDiez('2281-2200')).toBeNull();
    expect(telDiez(null)).toBeNull();
  });
});

describe('limpiarDatosEvento', () => {
  it('pasa a nombres de columna y limpia lo vacío', () => {
    expect(
      limpiarDatosEvento({ tipo: 'casamiento', nombre: '  Casamiento  de Ana ', fecha: '2026-12-12', invitados: '120', clienteId: '', lugar: '  ', contacto_telefono: '11 2281-2200' }),
    ).toEqual({ tipo: 'casamiento', nombre: 'Casamiento de Ana', fecha: '2026-12-12', invitados: 120, cliente_id: null, lugar: null, contacto_telefono: '1122812200' });
  });

  it('solo devuelve lo que vino (cambio parcial)', () => {
    expect(limpiarDatosEvento({ estado: 'confirmado' })).toEqual({ estado: 'confirmado' });
    expect(limpiarDatosEvento({ fecha: '' })).toEqual({ fecha: null });
  });

  it('rechaza con un motivo claro', () => {
    expect(() => limpiarDatosEvento({ estado: 'ganado' })).toThrow('La etapa del evento no es válida.');
    expect(() => limpiarDatosEvento({ tipo: 'bautismo' })).toThrow('El tipo de evento no es válido.');
    expect(() => limpiarDatosEvento({ fecha: '2026-02-30' })).toThrow('La fecha no es válida.');
    expect(() => limpiarDatosEvento({ invitados: 2.5 })).toThrow('La cantidad de invitados no es válida.');
    expect(() => limpiarDatosEvento({ nombre: '   ' })).toThrow('Falta el nombre del evento.');
    expect(() => limpiarDatosEvento({ contacto_telefono: '12' })).toThrow(/no parece un teléfono/);
    expect(() => limpiarDatosEvento({ contacto_telefono: '15 2281-2200' })).toThrow(/Falta la característica/);
  });

  it('un origen desconocido queda como manual', () => {
    expect(limpiarDatosEvento({ origen: 'inventado' })).toEqual({ origen: 'manual' });
    expect(limpiarDatosEvento({ origen: 'compra_grande' })).toEqual({ origen: 'compra_grande' });
  });
});

describe('renglones de la propuesta', () => {
  it('productos con precio cambiado y renglones libres (servicio de barra, hielo)', () => {
    expect(
      limpiarItems([
        { producto_id: '15d903fb-a239-41d8-afad-e5cda56ad30d', descripcion: ' Espumante  Extra Brut ', cantidad: '24', precio_unitario: '8100.5' },
        { producto_id: null, descripcion: 'Servicio de barra (5 horas)', cantidad: 1, precio_unitario: 250000 },
        { descripcion: 'Hielo', cantidad: 10, precio_unitario: '' },
      ]),
    ).toEqual([
      { producto_id: '15d903fb-a239-41d8-afad-e5cda56ad30d', descripcion: 'Espumante Extra Brut', cantidad: 24, precio_unitario: 8100.5 },
      { producto_id: null, descripcion: 'Servicio de barra (5 horas)', cantidad: 1, precio_unitario: 250000 },
      { producto_id: null, descripcion: 'Hielo', cantidad: 10, precio_unitario: 0 },
    ]);
  });

  it('descarta los renglones a medio cargar y rechaza los números que no sirven', () => {
    expect(limpiarItems([{ descripcion: '', cantidad: 2 }, { descripcion: 'Agua', cantidad: 0 }])).toEqual([]);
    expect(limpiarItems(undefined)).toEqual([]);
    expect(() => limpiarItems([{ descripcion: 'Vino', cantidad: 2, precio_unitario: -100 }])).toThrow('El precio de «Vino» no es válido.');
    expect(() => limpiarItems([{ descripcion: 'Vino', cantidad: 2, precio_unitario: 'mucho' }])).toThrow('El precio de «Vino» no es válido.');
    expect(() => limpiarItems([{ descripcion: 'Vino', cantidad: 'Infinity' }])).toThrow('La cantidad de «Vino» no es válida.');
    expect(() => limpiarItems([{ producto_id: 'x', descripcion: 'Vino', cantidad: 1 }])).toThrow('El producto de «Vino» no es válido.');
    expect(() => limpiarItems('nada')).toThrow('La propuesta no es válida.');
  });
});

describe('sin la migración', () => {
  it('reconoce el error de columna inexistente', () => {
    expect(faltaColumna({ code: 'PGRST204', message: "Could not find the 'lugar' column of 'eventos' in the schema cache" })).toBe(true);
    expect(faltaColumna({ code: '42703', message: 'column eventos.lugar does not exist' })).toBe(true);
    expect(faltaColumna({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(faltaColumna(null)).toBe(false);
  });

  it('el lugar y el contacto pasan a las notas, sin repetirse', () => {
    const fila = { nombre: 'Casamiento de Ana', notas: 'Quiere espumante', lugar: 'Quinta Los Robles', contacto_nombre: 'Ana', contacto_telefono: '1122812200', origen: 'manual' };
    expect(pasarExtrasANotas(fila)).toEqual({
      nombre: 'Casamiento de Ana',
      notas: 'Quiere espumante\nLugar: Quinta Los Robles\nContacto: Ana · 1122812200',
    });
    // en un cambio parcial se suma a las notas que ya tenía, y no se repite
    expect(pasarExtrasANotas({ lugar: 'Quinta Los Robles' }, 'Algo\nLugar: Quinta Los Robles')).toEqual({});
    expect(pasarExtrasANotas({ lugar: 'Salón Canning' }, 'Algo')).toEqual({ notas: 'Algo\nLugar: Salón Canning' });
  });
});

describe('resumenEventos', () => {
  const filas = [
    { estado: 'prospecto', presupuesto: 0, fecha: '2026-10-23' }, // esta semana
    { estado: 'propuesta', presupuesto: '850000', fecha: '2026-11-15' }, // dentro de 30
    { estado: 'propuesta', presupuesto: 150000, fecha: '2026-12-20' }, // fuera de 30
    { estado: 'confirmado', presupuesto: 1200000, fecha: '2026-10-27' }, // esta semana
    { estado: 'confirmado', presupuesto: 300000, fecha: '2026-10-10' }, // ya pasó: hay que cerrarlo
    { estado: 'realizado', presupuesto: 500000, fecha: '2026-09-01' },
    { estado: 'cancelado', presupuesto: 90000, fecha: '2026-10-25' }, // no cuenta como próximo
  ];

  it('próximos 30 días, esta semana y los que quedaron con la fecha pasada', () => {
    const r = resumenEventos(filas, HOY);
    expect(r.proximos30).toEqual({ cantidad: 3, estaSemana: 2 });
    expect(r.fechaPasada).toBe(1);
  });

  it('plata de propuestas abiertas y de confirmados', () => {
    const r = resumenEventos(filas, HOY);
    expect(r.propuestas).toEqual({ cantidad: 2, monto: 1_000_000, prospectos: 1 });
    expect(r.confirmados).toEqual({ cantidad: 2, monto: 1_500_000 });
    expect(r.porEtapa.realizado).toEqual({ cantidad: 1, monto: 500_000 });
  });

  it('tasa de cierre: confirmados y realizados sobre lo decidido', () => {
    expect(resumenEventos(filas, HOY).cierre).toEqual({ tasa: 0.75, ganados: 3, decididos: 4 });
    expect(resumenEventos([{ estado: 'prospecto' }], HOY).cierre.tasa).toBeNull();
  });
});

describe('cumpleaños', () => {
  it('el día del cumpleaños falta 0 días (con age() daba el del año que viene)', () => {
    expect(proximoCumple('1996-10-21', '2026-10-21')).toEqual({ fecha: '2026-10-21', dias: 0 });
    expect(proximoCumple('1996-10-22', '2026-10-21')).toEqual({ fecha: '2026-10-22', dias: 1 });
    expect(proximoCumple('1996-10-20', '2026-10-21')).toEqual({ fecha: '2027-10-20', dias: 364 });
    expect(proximoCumple('1980-01-05', '2026-12-30')).toEqual({ fecha: '2027-01-05', dias: 6 });
  });

  it('a las 23:30 de Buenos Aires (ya 22/10 en Londres) el de mañana sigue siendo mañana', () => {
    const hoy = hoyBA(new Date('2026-10-22T02:30:00Z'));
    expect(proximoCumple('1996-10-22', hoy)).toEqual({ fecha: '2026-10-22', dias: 1 });
    expect(proximoCumple('1996-10-21', hoy)?.dias).toBe(0);
  });

  it('el 29/2 se festeja el 28/2 los años que no son bisiestos', () => {
    expect(proximoCumple('2000-02-29', '2027-02-01')).toEqual({ fecha: '2027-02-28', dias: 27 });
    expect(proximoCumple('2000-02-29', '2027-02-28')).toEqual({ fecha: '2027-02-28', dias: 0 });
    expect(proximoCumple('2000-02-29', '2027-12-01')).toEqual({ fecha: '2028-02-29', dias: 90 });
    expect(proximoCumple(null, HOY)).toBeNull();
    expect(proximoCumple('no-es-fecha', HOY)).toBeNull();
  });

  it('la lista: de hoy a los próximos N días, los más cercanos primero', () => {
    const clientes = [
      { id: 'lejos', nombre: 'Lejos', dni: null, fecha_nacimiento: '1990-12-30' },
      { id: 'hoy', nombre: 'Hoy', dni: '1', fecha_nacimiento: '1996-10-21' },
      { id: 'manana', nombre: 'Mañana', dni: null, fecha_nacimiento: '1996-10-22' },
      { id: 'ayer', nombre: 'Ayer', dni: null, fecha_nacimiento: '1996-10-20' },
      { id: 'sin', nombre: 'Sin', dni: null, fecha_nacimiento: null },
    ];
    expect(cumpleanosProximos(clientes, HOY, 60)).toEqual([
      { cliente_id: 'hoy', nombre: 'Hoy', dni: '1', dias: 0, fecha: '2026-10-21' },
      { cliente_id: 'manana', nombre: 'Mañana', dni: null, dias: 1, fecha: '2026-10-22' },
    ]);
    expect(cumpleanosProximos(clientes, HOY, 70).map((c) => c.cliente_id)).toEqual(['hoy', 'manana', 'lejos']);
  });

  it('encuentra el evento de este cumpleaños del cliente, también si dijo que no', () => {
    const eventos = [
      ev({ id: 'viejo', tipo: 'cumpleanos', fecha: '2025-10-30' }),
      ev({ id: 'otro', tipo: 'casamiento', fecha: '2026-11-02' }),
    ];
    expect(eventoDeCumple('c1', eventos, HOY)).toBeNull();
    expect(eventoDeCumple('c1', [...eventos, ev({ id: 'este', tipo: 'cumpleanos', fecha: '2026-11-02' })], HOY)).toEqual({ id: 'este', estado: 'prospecto' });
    expect(eventoDeCumple('c2', [ev({ id: 'este', tipo: 'cumpleanos', fecha: '2026-11-02' })], HOY)).toBeNull();
    // cancelado: la oportunidad ya se trabajó, no vuelve a "Armar propuesta"
    const caido = ev({ id: 'caido', tipo: 'cumpleanos', fecha: '2026-11-02', estado: 'cancelado' });
    expect(eventoDeCumple('c1', [...eventos, caido], HOY)).toEqual({ id: 'caido', estado: 'cancelado' });
    // si después se armó otro, manda el que sigue vivo
    expect(eventoDeCumple('c1', [caido, ev({ id: 'nuevo', tipo: 'cumpleanos', fecha: null, creado_en: '2026-10-20T10:00:00Z' })], HOY)).toEqual({ id: 'nuevo', estado: 'prospecto' });
  });
});

describe('fin de año', () => {
  it('la temporada va de noviembre a enero; en enero sigue la del año anterior', () => {
    expect(temporadaFinDeAno('2026-10-21')).toEqual({ anio: 2026, desde: '2026-11-01', hasta: '2027-01-31', creadoDesde: '2026-08-01' });
    expect(temporadaFinDeAno('2027-01-10').anio).toBe(2026);
    expect(temporadaFinDeAno('2027-02-01').anio).toBe(2027);
  });

  it('empresa: responsable inscripto, CUIT 30/33/34, razón social o mayorista; no un CUIT 20 de consumidor final', () => {
    expect(esEmpresa({ id: '1', nombre: 'X', condicion_iva: 'RESPONSABLE INSCRIPTO' })).toBe(true);
    expect(esEmpresa({ id: '1', nombre: 'X', condicion_iva: 'responsable_inscripto' })).toBe(true);
    expect(esEmpresa({ id: '1', nombre: 'X', cuit: '30-71234567-8', condicion_iva: 'CONSUMIDOR FINAL' })).toBe(true);
    expect(esEmpresa({ id: '1', nombre: 'X', razon_social: 'Pérez SRL' })).toBe(true);
    expect(esEmpresa({ id: '1', nombre: 'X', tipo: 'mayorista' })).toBe(true);
    expect(esEmpresa({ id: '1', nombre: 'X', cuit: '20-30123456-7', condicion_iva: 'CONSUMIDOR FINAL' })).toBe(false);
  });

  const empresas = [
    { id: 'a', nombre: 'Alfa SA', cuit: '30712345678', telefono: '11 4031-5015' },
    { id: 'b', nombre: 'Beta SRL', cuit: '30787654321', telefono: '1154246788' },
    { id: 'c', nombre: 'Gama SA', cuit: '33712345678', telefono: '1137733263' },
    { id: 'd', nombre: 'Delta', razon_social: 'Delta SAS', condicion_iva: 'responsable_inscripto', telefono: '+54 9 11 3310-8319' },
    { id: 'e', nombre: 'Épsilon', cuit: '30701810925', telefono: '15' }, // del sistema viejo: sin compras, teléfono "15"
    { id: 'f', nombre: 'Fi SRL', cuit: '30709006564', telefono: '1158604122' }, // sin compras ni charlas
    { id: 'p', nombre: 'Persona', cuit: '20301234567', telefono: '1162558399' },
  ];
  const compras = [
    { cliente_id: 'b', total: 500000, fecha: '2026-09-01T12:00:00Z' },
    { cliente_id: 'b', total: '250000', fecha: '2026-10-01T12:00:00Z' },
    { cliente_id: 'a', total: 100000, fecha: '2026-06-01T12:00:00Z' },
    { cliente_id: 'f', total: 9_000_000, fecha: '2025-01-01T12:00:00Z' }, // hace más de un año: no cuenta
    { cliente_id: 'c', total: 2_000_000, fecha: '2026-10-01T12:00:00Z' },
  ];

  it('solo las empresas con compras o charlas en el último año, por lo que compraron', () => {
    const eventos = [
      ev({ cliente_id: 'c', tipo: 'fin_de_ano', fecha: '2026-12-18' }), // Gama ya tiene
      ev({ cliente_id: 'a', tipo: 'fin_de_ano', fecha: '2025-12-18' }), // la del año pasado no cuenta
    ];
    // Delta no compró pero escribió por WhatsApp
    const r = empresasFinDeAno(empresas, compras, eventos, HOY, { conCharla: new Set(['1133108319']) });
    expect(r.temporada).toBe(2026);
    expect(r.yaTienen).toBe(1);
    expect(r.dijeronQueNo).toBe(0);
    expect(r.lista.map((e) => [e.cliente_id, e.total, e.compras])).toEqual([
      ['b', 750000, 2],
      ['a', 100000, 1],
      ['d', 0, 0],
    ]);
    expect(r.pendientes).toBe(3);
    // Épsilon (teléfono "15", nada) y Fi (lo único que compró fue hace más de un año) no se ofrecen
    expect(r.sinRelacion).toBe(2);
    expect(r.lista[2].nombre).toBe('Delta SAS');
    expect(r.lista[0].ultima).toBe('2026-10-01T12:00:00Z');
    expect(r.lista.every((e) => e.whatsapp)).toBe(true);
  });

  it('como en la base del 21/10: CUIT de empresa pero ni una compra ni una charla → lista vacía', () => {
    const r = empresasFinDeAno(empresas, [], [], HOY);
    expect(r.lista).toEqual([]);
    expect(r.pendientes).toBe(0);
    expect(r.sinRelacion).toBe(6);
  });

  it('una que compró pero tiene el teléfono "15" sale igual, marcada sin WhatsApp', () => {
    const r = empresasFinDeAno(empresas, [{ cliente_id: 'e', total: 80000, fecha: '2026-10-01T12:00:00Z' }], [], HOY);
    expect(r.lista).toMatchObject([{ cliente_id: 'e', whatsapp: false }]);
  });

  it('la que dijo que no (evento cancelado esta temporada) no vuelve a la lista', () => {
    const eventos = [ev({ cliente_id: 'b', tipo: 'fin_de_ano', fecha: null, creado_en: '2026-10-15T10:00:00Z', estado: 'cancelado' })];
    const r = empresasFinDeAno(empresas, compras, eventos, HOY);
    expect(r.lista.map((e) => e.cliente_id)).toEqual(['c', 'a']);
    expect(r.dijeronQueNo).toBe(1);
    // un "no" de la temporada pasada no la tapa
    const viejo = [ev({ cliente_id: 'b', tipo: 'corporativo', fecha: '2025-12-10', estado: 'cancelado' })];
    expect(empresasFinDeAno(empresas, compras, viejo, HOY).lista.map((e) => e.cliente_id)).toEqual(['c', 'b', 'a']);
  });

  it('devuelve todas (antes se cortaba en 12 y la 13.ª no se podía ver)', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, nombre: `Empresa ${String(i).padStart(2, '0')}`, cuit: '30712345678', telefono: '1140315015' }));
    const suyas = muchas.map((m) => ({ cliente_id: m.id, total: 1000, fecha: '2026-10-01T12:00:00Z' }));
    const r = empresasFinDeAno(muchas, suyas, [], HOY);
    expect(r.lista).toHaveLength(20);
    expect(r.pendientes).toBe(20);
  });
});

describe('compras grandes', () => {
  // las compras de la casa el 21/10/2026: 9 tickets, casi todos pedidos de WhatsApp
  const tickets = [
    { cliente_id: 'joaquin', total: 218000, fecha: '2026-10-17T15:00:00Z', estado: 'entregado' },
    { cliente_id: 'joaquin', total: 96000, fecha: '2026-10-02T15:00:00Z', estado: 'entregado' },
    { cliente_id: 'valeria', total: 78400, fecha: '2026-10-16T15:00:00Z', estado: 'recibido' },
    { cliente_id: null, total: 77000, fecha: '2026-10-14T15:00:00Z' },
    { cliente_id: 'eloy', total: 105600, fecha: '2026-10-10T15:00:00Z', estado: 'recibido' },
    { cliente_id: null, total: 133500, fecha: '2026-10-03T15:00:00Z' },
    { cliente_id: 'st', total: 13650, fecha: '2026-08-21T15:00:00Z' },
    { cliente_id: null, total: 1400, fecha: '2026-09-08T15:00:00Z' },
    { cliente_id: 'viejo', total: 900000, fecha: '2026-05-01T15:00:00Z' }, // fuera de los 90 días
  ];

  it('con menos de 30 compras no hay pedido típico: umbral fijo de $100.000', () => {
    const r = comprasGrandes(tickets, [], HOY);
    expect(r.tickets).toBe(8);
    expect(r.tipico).toBeNull();
    expect(r.regla).toBe('piso');
    expect(r.umbral).toBe(100000);
    // con el promedio de 8 pedidos (que inflaba la misma compra de $218.000) el umbral daba $180.888 y Eloy no salía
    expect(r.lista).toEqual([
      { cliente_id: 'joaquin', total: 218000, fecha: '2026-10-17T15:00:00Z', estado: 'entregado', veces: null },
      { cliente_id: 'eloy', total: 105600, fecha: '2026-10-10T15:00:00Z', estado: 'recibido', veces: null },
    ]);
  });

  it('con 30 compras o más: el doble del pedido típico (la mediana, que una compra enorme no mueve)', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => ({ cliente_id: `c${i}`, total: 60000, fecha: '2026-10-10T12:00:00Z' }));
    const grande = { cliente_id: 'ana', total: 5_000_000, fecha: '2026-10-12T12:00:00Z' };
    const r = comprasGrandes([...muchos, grande], [], HOY);
    expect(umbralCompraGrande([...muchos, grande], HOY)).toEqual({ tipico: 60000, umbral: 120000, regla: 'doble', tickets: 41 });
    expect(r.lista).toEqual([{ cliente_id: 'ana', total: 5_000_000, fecha: '2026-10-12T12:00:00Z', estado: null, veces: 83.3 }]);
  });

  it('con pedidos chicos el piso evita llamar "grande" a una compra común, y lo dice', () => {
    const chicos = Array.from({ length: 30 }, (_, i) => ({ cliente_id: `c${i}`, total: i === 0 ? 60000 : 20000, fecha: '2026-10-10T12:00:00Z' }));
    expect(umbralCompraGrande(chicos, HOY)).toEqual({ tipico: 20000, umbral: 100000, regla: 'piso', tickets: 30 });
    expect(comprasGrandes(chicos, [], HOY).lista).toEqual([]);
  });

  it('las candidatas pueden venir aparte de la muestra del pedido típico', () => {
    const r = comprasGrandes(tickets, [], HOY, { candidatas: [{ cliente_id: 'ana', total: 400000, fecha: '2026-09-01T12:00:00Z', estado: 'listo' }] });
    expect(r.umbral).toBe(100000);
    expect(r.lista.map((x) => [x.cliente_id, x.estado])).toEqual([['ana', 'listo']]);
  });

  it('no lo ofrece si ya tiene un evento abierto o uno armado después de la compra, aunque lo haya cancelado', () => {
    const solo = (eventos: EventoLiviano[]) => comprasGrandes(tickets, eventos, HOY).lista.filter((x) => x.cliente_id === 'joaquin');
    expect(solo([ev({ cliente_id: 'joaquin', estado: 'propuesta' })])).toEqual([]);
    expect(solo([ev({ cliente_id: 'joaquin', estado: 'realizado', creado_en: '2026-10-18T10:00:00Z' })])).toEqual([]);
    // dijo que no: se canceló el evento armado después de la compra
    expect(solo([ev({ cliente_id: 'joaquin', estado: 'cancelado', creado_en: '2026-10-18T10:00:00Z' })])).toEqual([]);
    // un evento viejo, ya realizado o cancelado antes de esta compra, no lo tapa
    expect(solo([ev({ cliente_id: 'joaquin', estado: 'realizado', creado_en: '2026-08-01T10:00:00Z' })])).toHaveLength(1);
    expect(solo([ev({ cliente_id: 'joaquin', estado: 'cancelado', creado_en: '2026-08-01T10:00:00Z' })])).toHaveLength(1);
  });
});
