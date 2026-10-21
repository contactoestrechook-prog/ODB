import {
  comprasGrandes,
  umbralCompraGrande,
  diasEntre,
  empresasFinDeAno,
  esEmpresa,
  eventoDeCumple,
  faltaColumna,
  hoyBA,
  limpiarDatosEvento,
  nombreSugerido,
  pasarExtrasANotas,
  resumenEventos,
  siguienteEtapa,
  sumarDias,
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

  it('teléfono: solo dígitos y con largo de teléfono', () => {
    expect(telefonoLimpio('11 2281-2200')).toBe('1122812200');
    expect(telefonoLimpio('+54 9 11 2281 2200')).toBe('5491122812200');
    expect(telefonoLimpio('123')).toBeNull();
    expect(telefonoLimpio('2281-2200')).toBeNull(); // sin característica
    expect(telefonoLimpio(null)).toBeNull();
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
  });

  it('un origen desconocido queda como manual', () => {
    expect(limpiarDatosEvento({ origen: 'inventado' })).toEqual({ origen: 'manual' });
    expect(limpiarDatosEvento({ origen: 'compra_grande' })).toEqual({ origen: 'compra_grande' });
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
  it('encuentra el evento de cumpleaños vigente del cliente', () => {
    const eventos = [
      ev({ id: 'viejo', tipo: 'cumpleanos', fecha: '2025-10-30' }),
      ev({ id: 'caido', tipo: 'cumpleanos', fecha: '2026-11-02', estado: 'cancelado' }),
      ev({ id: 'otro', tipo: 'casamiento', fecha: '2026-11-02' }),
    ];
    expect(eventoDeCumple('c1', eventos, HOY)).toBeNull();
    expect(eventoDeCumple('c1', [...eventos, ev({ id: 'este', tipo: 'cumpleanos', fecha: '2026-11-02' })], HOY)).toBe('este');
    expect(eventoDeCumple('c2', [ev({ id: 'este', tipo: 'cumpleanos', fecha: '2026-11-02' })], HOY)).toBeNull();
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

  it('ordena por lo que compraron en 12 meses y saca las que ya tienen fiesta esta temporada', () => {
    const empresas = [
      { id: 'a', nombre: 'Alfa SA', cuit: '30712345678' },
      { id: 'b', nombre: 'Beta SRL', cuit: '30787654321' },
      { id: 'c', nombre: 'Gama SA', cuit: '33712345678' },
      { id: 'd', nombre: 'Delta', razon_social: 'Delta SAS', condicion_iva: 'responsable_inscripto' },
      { id: 'p', nombre: 'Persona', cuit: '20301234567' },
    ];
    const compras = [
      { cliente_id: 'b', total: 500000, fecha: '2026-09-01T12:00:00Z' },
      { cliente_id: 'b', total: '250000', fecha: '2026-10-01T12:00:00Z' },
      { cliente_id: 'a', total: 100000, fecha: '2026-06-01T12:00:00Z' },
      { cliente_id: 'a', total: 9_000_000, fecha: '2025-01-01T12:00:00Z' }, // hace más de un año: no cuenta
      { cliente_id: 'c', total: 2_000_000, fecha: '2026-10-01T12:00:00Z' },
    ];
    const eventos = [
      ev({ cliente_id: 'c', tipo: 'fin_de_ano', fecha: '2026-12-18' }), // Gama ya tiene
      ev({ cliente_id: 'a', tipo: 'fin_de_ano', fecha: '2025-12-18' }), // la del año pasado no cuenta
      ev({ cliente_id: 'd', tipo: 'corporativo', fecha: null, creado_en: '2026-10-15T10:00:00Z', estado: 'cancelado' }), // cancelada no cuenta
    ];
    const r = empresasFinDeAno(empresas, compras, eventos, HOY);
    expect(r.temporada).toBe(2026);
    expect(r.yaTienen).toBe(1);
    expect(r.pendientes).toBe(3);
    expect(r.lista.map((e) => [e.cliente_id, e.total, e.compras])).toEqual([
      ['b', 750000, 2],
      ['a', 100000, 1],
      ['d', 0, 0],
    ]);
    expect(r.lista[2].nombre).toBe('Delta SAS');
    expect(r.lista[0].ultima).toBe('2026-10-01T12:00:00Z');
  });
});

describe('compras grandes', () => {
  // los tickets de la casa de los últimos 90 días (promedio ~ $86.000, como en la base el 21/10/2026)
  const tickets = [
    { cliente_id: 'joaquin', total: 218000, fecha: '2026-10-17T15:00:00Z' },
    { cliente_id: 'joaquin', total: 96000, fecha: '2026-10-02T15:00:00Z' },
    { cliente_id: 'valeria', total: 78400, fecha: '2026-10-16T15:00:00Z' },
    { cliente_id: null, total: 77000, fecha: '2026-10-14T15:00:00Z' },
    { cliente_id: 'eloy', total: 105600, fecha: '2026-10-10T15:00:00Z' },
    { cliente_id: null, total: 133500, fecha: '2026-10-03T15:00:00Z' },
    { cliente_id: 'st', total: 13650, fecha: '2026-08-21T15:00:00Z' },
    { cliente_id: null, total: 1400, fecha: '2026-09-08T15:00:00Z' },
    { cliente_id: 'viejo', total: 900000, fecha: '2026-05-01T15:00:00Z' }, // fuera de los 90 días
  ];

  it('el umbral es el doble del promedio (con piso) y queda una fila por cliente', () => {
    const r = comprasGrandes(tickets, [], HOY);
    expect(r.tickets).toBe(8);
    expect(r.promedio).toBe(90444);
    expect(r.umbral).toBe(180888);
    expect(r.lista).toEqual([{ cliente_id: 'joaquin', total: 218000, fecha: '2026-10-17T15:00:00Z', veces: 2.4 }]);
  });

  it('el umbral solo, para la consulta de candidatas', () => {
    expect(umbralCompraGrande(tickets, HOY)).toEqual({ promedio: 90443.75, umbral: 180888, tickets: 8 });
  });

  it('con pocos tickets usa un umbral fijo', () => {
    const r = comprasGrandes(tickets.slice(0, 3), [], HOY);
    expect(r.umbral).toBe(150000);
    expect(r.lista.map((x) => x.cliente_id)).toEqual(['joaquin']);
  });

  it('con tickets chicos el piso evita llamar "grande" a una compra común', () => {
    const chicos = Array.from({ length: 10 }, (_, i) => ({ cliente_id: `c${i}`, total: i === 0 ? 60000 : 20000, fecha: '2026-10-10T12:00:00Z' }));
    expect(comprasGrandes(chicos, [], HOY).umbral).toBe(100000);
    expect(comprasGrandes(chicos, [], HOY).lista).toEqual([]);
  });

  it('las candidatas pueden venir aparte de la muestra del promedio', () => {
    const r = comprasGrandes(tickets, [], HOY, { candidatas: [{ cliente_id: 'ana', total: 400000, fecha: '2026-09-01T12:00:00Z' }] });
    expect(r.umbral).toBe(180888);
    expect(r.lista.map((x) => [x.cliente_id, x.veces])).toEqual([['ana', 4.4]]);
  });

  it('no lo ofrece si ya tiene un evento abierto o uno armado después de la compra', () => {
    expect(comprasGrandes(tickets, [ev({ cliente_id: 'joaquin', estado: 'propuesta' })], HOY).lista).toEqual([]);
    expect(comprasGrandes(tickets, [ev({ cliente_id: 'joaquin', estado: 'realizado', creado_en: '2026-10-18T10:00:00Z' })], HOY).lista).toEqual([]);
    // un evento viejo, ya realizado antes de esta compra, no lo tapa
    expect(comprasGrandes(tickets, [ev({ cliente_id: 'joaquin', estado: 'realizado', creado_en: '2026-08-01T10:00:00Z' })], HOY).lista).toHaveLength(1);
  });
});
