import { limpiarEntradaDeHerramienta, sinRestosDeMarcado, textoONulo } from './texto-limpio';

// La basura de Envíos (Leandro, 21/10/2026: «misma basura»). Los casos son los
// de producción: la nota de DOM-YD5GNY, las notas del equipo del 21/9 y las
// direcciones de las consultas internas.
describe('sinRestosDeMarcado: una sola regla para lo que no escribió una persona', () => {
  it('la nota de DOM-YD5GNY queda vacía: «WhatsApp:» era un rótulo y lo de atrás otro campo', () => {
    expect(sinRestosDeMarcado('WhatsApp: </antml name diretipo">domicilio')).toBe('');
  });

  it('corta desde la etiqueta y conserva lo que estaba antes', () => {
    expect(sinRestosDeMarcado('Cliente necesita jabón blanco 6M · </antml with_this_key/>')).toBe('Cliente necesita jabón blanco 6M');
    expect(sinRestosDeMarcado('Paga con transferencia</parameter>\n<parameter name="tipo">domicilio')).toBe('Paga con transferencia');
    expect(sinRestosDeMarcado('Timbre 2 <b>urgente</b>')).toBe('Timbre 2');
  });

  it('las etiquetas solas, con cualquier variante de la sintaxis, no dejan nada', () => {
    for (const basura of ['</antmlःparameter>', '</antml():parameter>', '<\\/antml：parameter>', '</antml3:parameter>', '<invoke name="x">', '</function_calls>']) {
      expect(sinRestosDeMarcado(basura)).toBe('');
    }
  });

  it('respeta lo legítimo: comillas, mayor que, citas y un aparte entre < >', () => {
    expect(sinRestosDeMarcado('Foodtruck "Rincón"')).toBe('Foodtruck "Rincón"');
    expect(sinRestosDeMarcado('Pedido > $70.000')).toBe('Pedido > $70.000');
    expect(sinRestosDeMarcado('[esperando] > Buen día, ¿hay stock?')).toBe('[esperando] > Buen día, ¿hay stock?');
    expect(sinRestosDeMarcado('Lote 95 <casa con portón negro>')).toBe('Lote 95 <casa con portón negro>');
    expect(sinRestosDeMarcado('Griller. Paga en efectivo al recibir. Sin factura A, con remito.')).toBe('Griller. Paga en efectivo al recibir. Sin factura A, con remito.');
  });

  it('en un renglón (nombre, dirección) los < > sueltos pasan a espacio y no quedan saltos', () => {
    expect(sinRestosDeMarcado('Lote 95 <casa con portón negro>', { unaLinea: true })).toBe('Lote 95 casa con portón negro');
    expect(sinRestosDeMarcado('  Barrio Saint Thomas\n lote 194 ', { unaLinea: true })).toBe('Barrio Saint Thomas lote 194');
  });

  it('saca invisibles y caracteres de control, pero no rompe los emojis compuestos', () => {
    expect(sinRestosDeMarcado('Timbre\u200B 2\u0007')).toBe('Timbre 2');
    expect(sinRestosDeMarcado('\uFEFFValeria')).toBe('Valeria');
    expect(sinRestosDeMarcado('👨\u200D👩\u200D👧 Familia Pérez')).toBe('👨\u200D👩\u200D👧 Familia Pérez');
  });

  it('relleno y rótulos solos no son un dato', () => {
    for (const r of ['null', 'N/A', 'undefined', 'vacío', 'Ninguna', '-', '—', 'WhatsApp', 'Notas:', 'Indicaciones', '  ']) {
      expect(sinRestosDeMarcado(r)).toBe('');
    }
    expect(sinRestosDeMarcado(null)).toBe('');
    expect(sinRestosDeMarcado(undefined)).toBe('');
  });

  it('separadores colgando al final se van; los de adentro quedan', () => {
    expect(sinRestosDeMarcado('Paga en efectivo · ')).toBe('Paga en efectivo');
    expect(sinRestosDeMarcado('Retira: Gastón · Paga con transferencia')).toBe('Retira: Gastón · Paga con transferencia');
  });

  it('en varias líneas conserva los saltos y aprieta los espacios', () => {
    expect(sinRestosDeMarcado('Tocar timbre   2\r\n\r\n\r\n\r\nNo llamar')).toBe('Tocar timbre 2\n\nNo llamar');
  });

  it('textoONulo: null cuando no queda nada (para grabar)', () => {
    expect(textoONulo('WhatsApp: </antml name diretipo">domicilio')).toBeNull();
    expect(textoONulo(' Av Mariano Castex 1148 ', { unaLinea: true })).toBe('Av Mariano Castex 1148');
  });
});

describe('limpiarEntradaDeHerramienta: una pasada a todo lo que manda el bot', () => {
  it('limpia todos los textos, también dentro de listas, y deja números y lógicos', () => {
    const entrada: any = {
      nombre: 'Jimena',
      notas: 'WhatsApp: </antml name diretipo">domicilio',
      direccion: 'St Thomas Norte, lote 118',
      items: [{ sku: 'AGU-0001', cantidad: 3, nota: '</antml3:parameter>' }],
      urgente: true,
    };
    const r = limpiarEntradaDeHerramienta(entrada);
    expect(r).toBe(entrada); // en su lugar: lo que quedó en la charla es lo que se ejecutó
    expect(r).toEqual({ nombre: 'Jimena', notas: '', direccion: 'St Thomas Norte, lote 118', items: [{ sku: 'AGU-0001', cantidad: 3, nota: '' }], urgente: true });
  });

  it('tolera entradas vacías', () => {
    expect(limpiarEntradaDeHerramienta(undefined)).toBeUndefined();
    expect(limpiarEntradaDeHerramienta(null)).toBeNull();
  });
});
