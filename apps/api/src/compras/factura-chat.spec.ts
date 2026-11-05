// El chat de la factura (8/10/2026): lo que devuelve la IA se filtra antes de
// llegar a la pantalla. Solo pasan cambios aplicables.
import { medirLlamada, CAMPOS_RENGLON, fraseDeOtrosComprobantes, motivoParaCorregir, reglaRepetida, validarRespuestaChat, yaRevisada } from './factura-chat.service';

// «No aprendió los cambios ni los razonamientos, tuvimos que poner todo otra
// vez» (La Serenísima, 5/11/2026): la regla se guarda sola y se aplica sola.
describe('lo aprendido de un proveedor', () => {
  const guardadas = ['Los quesos facturados a $0,10 (entregados con confirmación de peso) ingresan igual al stock y su precio real llega en el próximo pedido.'];
  it('la misma regla dicha otra vez no se guarda dos veces', () => {
    expect(reglaRepetida('los quesos facturados a $0,10 (entregados con confirmacion de peso) ingresan igual al stock y su precio real llega en el proximo pedido', guardadas)).toBe(true);
    expect(reglaRepetida('En La Serenísima el P.U. viene sin la oferta transitoria.', guardadas)).toBe(false);
    expect(reglaRepetida('  ', guardadas)).toBe(true);
  });
  it('una factura ya mirada sin cambios no se vuelve a pasar por la IA', () => {
    const reglas = ['2026-11-05T18:39:00+00:00', '2026-11-05T18:42:00+00:00'];
    expect(yaRevisada({ cambios: [], cambios_pie: [], creado_en: '2026-11-06T12:00:00+00:00' }, reglas)).toBe(true);
  });
  it('si hubo cambios, o hay una regla más nueva que la última pasada, se vuelve a aplicar', () => {
    const reglas = ['2026-11-05T18:39:00+00:00', '2026-11-07T10:00:00+00:00'];
    expect(yaRevisada({ cambios: [{ renglon: 11 }], cambios_pie: [], creado_en: '2026-11-08T12:00:00+00:00' }, reglas)).toBe(false);
    expect(yaRevisada({ cambios: [], cambios_pie: [], creado_en: '2026-11-06T12:00:00+00:00' }, reglas)).toBe(false);
    expect(yaRevisada(null, reglas)).toBe(false);
  });
});

describe('validarRespuestaChat', () => {
  it('deja pasar los cambios válidos y descarta el resto', () => {
    const r = validarRespuestaChat({
      respuesta: 'Le puse el 5% al tomate: ahora cierra.',
      cambios: [
        { renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'columna %Des.' },
        { renglon: 0, campo: 'precio', valor: 1, motivo: '' },
        { renglon: 99, campo: 'precio', valor: 1, motivo: '' },
        { renglon: 2, campo: 'color', valor: 'rojo', motivo: '' },
        { renglon: 2.5, campo: 'precio', valor: 1, motivo: '' },
      ],
      cambiosPie: [{ campo: 'percepcionIibb', valor: 16151.75, motivo: 'ARBA' }, { campo: 'otro', valor: 1, motivo: '' }, { campo: 'iva', valor: -3, motivo: '' }],
      reglaProveedor: '  En Distri-Sur el «Descuento» de abajo es el regalo del renglón de arriba. ',
    }, 15);
    expect(r.cambios).toEqual([{ renglon: 1, campo: 'descuentoPct', valor: 5, motivo: 'columna %Des.' }]);
    expect(r.cambiosPie).toEqual([{ campo: 'percepcionIibb', valor: 16151.75, motivo: 'ARBA' }]);
    expect(r.reglaProveedor).toBe('En Distri-Sur el «Descuento» de abajo es el regalo del renglón de arriba.');
    expect(r.respuesta).toContain('5%');
  });
  it('sin nada útil devuelve una respuesta vacía de cambios', () => {
    expect(validarRespuestaChat({}, 3)).toEqual({ respuesta: 'Listo.', cambios: [], cambiosPie: [], reglaProveedor: null, descartados: [], leerOtrosComprobantes: false });
  });
  it('lo que se descarta vuelve con el porqué, para que la pantalla lo diga (22/10/2026)', () => {
    const r = validarRespuestaChat({
      respuesta: 'Listo, le bajé el costo.',
      cambios: [{ renglon: 1, campo: 'costo', valor: 5165, motivo: '' }, { renglon: 40, campo: 'precio', valor: 1, motivo: '' }, { renglon: 4, campo: 'ingresa', valor: false, motivo: 'no llegó' }],
    }, 24);
    expect(r.cambios).toEqual([{ renglon: 4, campo: 'ingresa', valor: false, motivo: 'no llegó' }]);
    expect(r.descartados).toEqual([
      { renglon: 1, campo: 'costo', porque: 'ese dato no se puede cambiar desde el chat' },
      { renglon: 40, campo: 'precio', porque: 'ese renglón no existe en la factura' },
    ]);
  });
});

// «Resuelve bien en la conversación pero no después en el cambio» (22/10/2026):
// cuándo el servidor le pide a la IA que mande el cambio de forma aplicable.
describe('motivoParaCorregir', () => {
  const salida = (o: any) => ({ respuesta: '', cambios: [], cambiosPie: [], reglaProveedor: null, descartados: [], ...o });
  it('dice que cambió algo y no mandó cambios → se le pide de nuevo', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Listo, le saqué el 18% al Oreo y ahora cierra.' }))).toMatch(/no mandaste ninguno/);
  });
  it('mandó un cambio que no se puede aplicar → se le pide de nuevo, con el porqué', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Puse el costo en 5165.', descartados: [{ renglon: 1, campo: 'costo', porque: 'ese dato no se puede cambiar desde el chat' }] }))).toMatch(/renglón 1 «costo»/);
  });
  it('dice lo que cambió y lo mandó → está bien', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'Le saqué el 18%: ahora cierra.', cambios: [{ renglon: 1, campo: 'descuentoPct', valor: null, motivo: '' }] }))).toBeNull();
  });
  it('solo explica, sin decir que cambió nada → está bien', () => {
    expect(motivoParaCorregir(salida({ respuesta: 'El 5165 sale de 4004,07 más IVA 21% y percepciones 8%.' }))).toBeNull();
  });
});

// «Volvimos a pasar la nota de crédito y otra vez tiró una duda… otra vez que la
// cargue aparte» (5/11/2026): el chat la lee del mismo archivo y lo dice el
// servidor, con lo que pasó de verdad.
describe('el otro comprobante del mismo archivo', () => {
  it('el pedido viaja como una marca, y pedirla no es «decir que cambió algo sin mandar cambios»', () => {
    const r = validarRespuestaChat({ respuesta: 'Dejé el flan con 2 recibidas.', cambios: [], cambiosPie: [], reglaProveedor: null, leerOtrosComprobantes: true }, 5);
    expect(r.leerOtrosComprobantes).toBe(true);
    expect(motivoParaCorregir(r)).toBeNull();
    expect(validarRespuestaChat({ respuesta: 'x', leerOtrosComprobantes: 'sí' }, 5).leerOtrosComprobantes).toBe(false);
  });
  it('dice lo que se está leyendo, sin mandar a subir nada', () => {
    const f = fraseDeOtrosComprobantes({ leidos: ['Nota de crédito 0001-00003945'], yaEstaban: [] });
    expect(f).toContain('Nota de crédito 0001-00003945');
    expect(f).toContain('en la bandeja');
    expect(f).not.toMatch(/aparte como|subila|cargala/i);
    expect(fraseDeOtrosComprobantes({ leidos: ['Factura 0005-00843293', 'Remito 12'], yaEstaban: [] })).toContain('Factura 0005-00843293 y Remito 12, que vinieron');
  });
  it('si ya estaba leída, lo dice; si el archivo trae uno solo o algo falló, también', () => {
    expect(fraseDeOtrosComprobantes({ leidos: [], yaEstaban: ['Nota de crédito 0001-00003945'] })).toBe('Nota de crédito 0001-00003945 ya está en la bandeja: se abre desde ahí para registrar.');
    expect(fraseDeOtrosComprobantes({ leidos: [], yaEstaban: [], motivo: 'uno-solo' })).toContain('un solo comprobante');
    expect(fraseDeOtrosComprobantes({ leidos: [], yaEstaban: [], motivo: 'error' })).toContain('Probá de nuevo');
    expect(fraseDeOtrosComprobantes(null)).toContain('avisame');
  });
  it('el chat tiene campo para lo que el 5/11 contestó «no puedo»: internos y costo', () => {
    expect(CAMPOS_RENGLON).toEqual(expect.arrayContaining(['impuestoInternoUnitario', 'llevaInternos', 'costoFinal']));
    const r = validarRespuestaChat({ respuesta: 'Listo.', cambios: [{ renglon: 1, campo: 'impuestoInternoUnitario', valor: 2517.91, motivo: 'Imp Int Uni' }, { renglon: 1, campo: 'costoFinal', valor: 3545.24, motivo: 'lo dijo la persona' }] }, 3);
    expect(r.cambios.map((c: any) => c.campo)).toEqual(['impuestoInternoUnitario', 'costoFinal']);
    expect(r.descartados).toEqual([]);
  });
});


describe('medirLlamada: cuánto razonó la IA en una llamada', () => {
  it('cuenta los bloques de razonamiento y separa lo pensado de la respuesta', () => {
    const m = medirLlamada({
      model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: 'a'.repeat(900) }, { type: 'text', text: 'x'.repeat(300) }],
      usage: { input_tokens: 1200, output_tokens: 700, cache_read_input_tokens: 5000 },
    }, 'high', 12340);
    expect(m).toMatchObject({ modelo: 'claude-opus-5-5', esfuerzo: 'high', termino: 'end_turn', segundos: 12.3, entrada: 1200, cacheLeida: 5000, salida: 700, bloquesDeRazonamiento: 1, caracteresDeRazonamiento: 900, caracteresDeRespuesta: 300, salidaSinRespuesta: 600 });
  });
  it('sin razonamiento queda en cero', () => {
    const m = medirLlamada({ content: [{ type: 'text', text: 'x'.repeat(300) }], usage: { output_tokens: 100 } }, 'high', 1000);
    expect(m).toMatchObject({ bloquesDeRazonamiento: 0, salidaSinRespuesta: 0 });
  });
});
