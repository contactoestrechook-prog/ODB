import { limpiarEntradaDeHerramienta, sinRestosDeMarcado, textoONulo, unirLimpio } from './texto-limpio';

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

  // Revisión del 21/10/2026: la regla cortaba cualquier <palabra> y se perdía
  // lo que seguía (probado con la función real). Una persona escribe esto.
  it('una palabra cualquiera entre < > no es marcado: no se corta nada', () => {
    for (const t of [
      'Lote 12 <azul> rejas negras',
      'Tocar timbre <urgente> y dejar en guardia',
      'Casa <A> timbre 2',
      'Lote 12 <portón> rejas',
      'Sin cebolla <importante> · SIN MATCHEAR: cebolla morada',
      '<3 gracias',
      'lote 95 > portón azul',
    ]) {
      expect(sinRestosDeMarcado(t)).toBe(t);
    }
  });

  it('el marcado de verdad sí se corta: HTML conocido, con atributos o de una letra en minúscula', () => {
    expect(sinRestosDeMarcado('Hola<br/>chau')).toBe('Hola');
    expect(sinRestosDeMarcado('Hola <DIV>x')).toBe('Hola');
    expect(sinRestosDeMarcado('Timbre <span class="x">2</span>')).toBe('Timbre');
    expect(sinRestosDeMarcado('Casa <a> timbre')).toBe('Casa');
    expect(sinRestosDeMarcado('Notas del pedido </notas> otro campo')).toBe('Notas del pedido');
  });

  it('con tildes da lo mismo que la base: «<portón>» no se corta ni acá ni allá', () => {
    // la base usaba [[:alnum:]] (con tildes) y la API \w (sin): ahora las dos [a-z0-9_:.-]
    expect(sinRestosDeMarcado('Lote 12 <portón> rejas')).toBe('Lote 12 <portón> rejas');
    expect(sinRestosDeMarcado('Lote 12 <portón class="a"> rejas')).toBe('Lote 12 <portón class="a"> rejas');
    expect(sinRestosDeMarcado('Lote 12 <porton class="a"> rejas')).toBe('Lote 12');
  });

  it('en un renglón (nombre, dirección) un aparte entre < > pierde los signos y no quedan saltos', () => {
    expect(sinRestosDeMarcado('Lote 95 <casa con portón negro>', { unaLinea: true })).toBe('Lote 95 casa con portón negro');
    expect(sinRestosDeMarcado('Juli <3', { unaLinea: true })).toBe('Juli <3');
    expect(sinRestosDeMarcado('lote 95 > portón azul', { unaLinea: true })).toBe('lote 95 > portón azul');
    expect(sinRestosDeMarcado('  Barrio Saint Thomas\n lote 194 ', { unaLinea: true })).toBe('Barrio Saint Thomas lote 194');
  });

  // Revisión del 21/10/2026: la regla les sacaba los signos a cualquier tramo
  // entre un < y un > posterior (probado con la función de la base).
  it('en un renglón, lo que no empieza con letra queda entero aunque haya < y > en el mismo renglón', () => {
    expect(sinRestosDeMarcado('Juli <3, lote 95 > portón', { unaLinea: true })).toBe('Juli <3, lote 95 > portón');
    expect(sinRestosDeMarcado('Entrar <- portón negro -> no el blanco', { unaLinea: true })).toBe('Entrar <- portón negro -> no el blanco');
    expect(sinRestosDeMarcado('Casa <A> timbre 2', { unaLinea: true })).toBe('Casa A timbre 2');
    expect(sinRestosDeMarcado('<Árbol grande> lote 3', { unaLinea: true })).toBe('Árbol grande lote 3');
  });

  it('limpiar dos veces da lo mismo que una (el disparador limpia en cada guardado)', () => {
    expect(sinRestosDeMarcado('x <y <z> w> v', { unaLinea: true })).toBe('x y z w v');
    for (const t of [
      'x <y <z> w> v', 'Juli <3, lote 95 > portón', 'Entrar <- portón negro -> no el blanco', 'Lote 95 <casa con portón negro>',
      'a <<b c>> d', '<<<x>>>', 'Timbre 2 <b>urgente</b>', 'WhatsApp: </antml name diretipo">domicilio', 'Barrio <El Venado> II · lote 312 ·',
    ]) {
      for (const unaLinea of [true, false]) {
        const una = sinRestosDeMarcado(t, { unaLinea });
        expect(sinRestosDeMarcado(una, { unaLinea })).toBe(una);
      }
    }
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

describe('unirLimpio: cada pedazo de una nota se limpia por separado', () => {
  it('una etiqueta en la nota del cliente no se lleva el aviso del sistema que va detrás', () => {
    const notas = unirLimpio(['Ana', 'Tocar timbre<br>Depto 3', 'SIN MATCHEAR: Vino X']);
    expect(notas).toBe('Ana · Tocar timbre · SIN MATCHEAR: Vino X');
    // y la limpieza del total (la API al guardar, el disparador de la base) ya no corta nada
    expect(sinRestosDeMarcado(notas)).toBe(notas);
  });

  it('la forma de pago que agrega el bot sobrevive a una nota vieja con basura', () => {
    expect(unirLimpio(['WhatsApp: </antml name diretipo">domicilio', 'Paga con efectivo'])).toBe('Paga con efectivo');
  });

  it('saltea lo vacío y el relleno', () => {
    expect(unirLimpio([null, '', 'null', 'Ana', undefined])).toBe('Ana');
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
