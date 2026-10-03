import { anulaElCierre, cambiaElContenido, cierraLaLista, coincideConLoAnotado, cuandoLegible, esConfirmacionDePedido, listaCerrada, loAnotado, nombreDeQuienRetira, ultimaListaAnotada } from './cierre';

const PREGUNTA = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';

describe('cierraLaLista (el "nada más" confirma, 3/10/2026)', () => {
  it.each(['Solo eso…', 'solo eso', 'nada más', 'No, nada más', 'no nada mas gracias', 'es todo', 'Eso es todo gracias', 'ya está', 'con eso estamos',
    'eso nada más', 'está bien así', 'por ahora nada más', 'con eso estoy', 'nop, nada más', 'nada más, gracias!', 'Solo eso 👍'])(
    '"%s" cierra la lista', (t) => expect(cierraLaLista(t, PREGUNTA)).toBe(true));

  it.each(['sí', 'Si si genial', 'sisi', 'sii', 'Perfecto', 'Perfecto, gracias', 'dale', '👍'])('"%s" cierra si contesta "¿Está completo?" con la lista a la vista', (t) => {
    expect(cierraLaLista(t, PREGUNTA)).toBe(true);
    expect(cierraLaLista(t, '¿Lo retirás por la sucursal o te lo enviamos?')).toBe(false);
    // "¿Te ayudo con algo más?" no es la lista: un 👍 ahí no es un pedido
    expect(cierraLaLista(t, 'Listo, quedó anotado. ¿Te ayudo con algo más?')).toBe(false);
  });

  it('contestando "¿Lo confirmo?" nada cierra la lista ("no, nada más" ahí es NO)', () => {
    const resumen = '• Combo Picada Box — 3 × $44.500 = $133.500\nTotal: $133.500\n¿Lo confirmo?';
    for (const t of ['no, nada más', 'nada más', 'es todo', 'sí']) expect(cierraLaLista(t, resumen)).toBe(false);
  });

  it('después de un pedido confirmado, "ya está, gracias" no es otra lista', () => {
    const conf = 'Pedido PICKUP-5F2451C6C111 confirmado. Total: $133.500.\nRetiro en la sucursal Saint Thomas.';
    for (const t of ['Ya está, gracias!', 'es todo, gracias', 'nada más']) expect(cierraLaLista(t, conf)).toBe(false);
    expect(cierraLaLista('ya está', `El envío es sin cargo. ${conf}`)).toBe(false);
  });

  it.each([
    'no está completo, falta el hielo',
    'es todo? cuánto sale?',
    'solo eso pero en vez de 3 que sean 4',
    'no, nada más por ahora, después te confirmo',
    'ya está, mañana te confirmo',
    'no gracias, lo pienso',
    'nada más que eso no, también quiero hielo',
    'sí, sumale 2 cocas',
    'listo, y agregale un hielo',
    'no',
    'no gracias',
    'solo eso, aunque capaz después agrego algo más para el sábado a la noche',
    'nada más quería saber el precio',
    'solo eso quería consultar',
    'ya está la transferencia',
    'si, y una coca',
    'dale, poneme 3',
    'ok, 2 cocas',
  ])('"%s" NO cierra', (t) => expect(cierraLaLista(t, PREGUNTA)).toBe(false));
});

describe('listaCerrada (la vigencia del cierre en la charla)', () => {
  const h = (...pares: [string, string][]) => pares.map(([role, content]) => ({ role, content }));

  it('el mensaje actual cierra', () => {
    expect(listaCerrada(h(['user', 'Te encargo 3 picadas'], ['assistant', PREGUNTA]), 'Solo eso…')).toBe('Solo eso…');
  });

  it('sigue vigente si después solo dice cómo lo recibe o el día', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', '¿Lo retirás por la sucursal Saint Thomas o te lo enviamos?']);
    expect(listaCerrada(historial, 'lo retiro mañana a la tarde')).toBe('nada más');
  });

  it('se anula si después suma algo', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', '¿Lo retirás o te lo enviamos?']);
    expect(listaCerrada(historial, 'sumale 2 cocas')).toBeNull();
    expect(listaCerrada(historial, '2 fernet también')).toBeNull();
  });

  it('se anula cuando el pedido ya quedó confirmado (aunque la confirmación venga con algo antepuesto)', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', 'Pedido PICKUP-5F2451C6C111 confirmado. Total: $133.500.']);
    expect(listaCerrada(historial, 'Juan Pérez')).toBeNull();
    expect(listaCerrada(historial, 'Ya está, gracias!')).toBeNull();
    const antepuesto = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', 'El envío es sin cargo. Pedido DOM-5F2451C6C111 confirmado. Total: $133.500.']);
    expect(listaCerrada(antepuesto, 'gracias')).toBeNull();
  });

  it.each(['no', 'no por ahora', 'no, esperá', 'cancelalo', 'lo pienso', 'te aviso', 'después te confirmo', 'retiro, pero esperá que lo confirmo con mi señora'])(
    'una negativa o una espera después del cierre lo anula: "%s"', (t) => {
      const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', '¿Lo retirás o te lo enviamos?']);
      expect(listaCerrada([...historial, { role: 'user', content: t }, { role: 'assistant', content: 'Dale.' }], 'lo retiro')).toBeNull();
    });

  it('si se mostró el resumen con "¿Lo confirmo?", rige el "sí" de siempre', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'sisi'], ['assistant', '• Combo Picada Box — 3 × $44.500\nTotal: $133.500\n¿Lo confirmo?']);
    expect(listaCerrada(historial, 'no')).toBeNull();
    expect(listaCerrada(historial, 'efectivo')).toBeNull();
  });

  it('las fechas y "otro día" no anulan el cierre', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', '¿Para qué día?']);
    expect(listaCerrada(historial, 'el 15 de octubre a la mañana')).toBe('nada más');
    expect(listaCerrada(historial, 'el sábado 4/10, a las 11 hs')).toBe('nada más');
  });

  it('con la charla quieta horas, solo cuenta un cierre en el mensaje actual', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', '¿Lo retirás o te lo enviamos?']);
    expect(listaCerrada(historial, 'lo retiro', { soloEsteMensaje: true })).toBeNull();
    expect(listaCerrada(h(['user', '3 picadas'], ['assistant', PREGUNTA]), 'nada más', { soloEsteMensaje: true })).toBe('nada más');
  });

  it('sin cierre no hay lista cerrada', () => {
    expect(listaCerrada(h(['user', '3 picadas'], ['assistant', PREGUNTA]), '¿cuánto sale cada una?')).toBeNull();
  });
});

describe('cambiaElContenido', () => {
  it.each(['sumale 2 cocas', 'cambiá el fernet por uno de 1 litro', '2 hielos', 'mejor que sean 4'])('"%s" cambia', (t) => expect(cambiaElContenido(t)).toBe(true));
  it.each(['lo retiro', 'Los Talas 15, Canning', 'mañana a la tarde', 'Juan Pérez', 'efectivo', '15 de octubre', 'lo paso a buscar otro día', 'a las 11 hs'])('"%s" no cambia', (t) => expect(cambiaElContenido(t)).toBe(false));
  it.each(['lo retiro', 'Los Talas 15, Canning', 'el sábado', 'efectivo', 'Juan Pérez'])('"%s" no anula el cierre', (t) => expect(anulaElCierre(t)).toBe(false));
});

describe('loAnotado y coincideConLoAnotado', () => {
  it('la última lista anotada, si no hubo un pedido confirmado después', () => {
    const lista = { role: 'assistant', content: PREGUNTA };
    expect(ultimaListaAnotada([lista])).toEqual([{ cantidad: 3, nombre: 'Combo Picada Box' }]);
    expect(ultimaListaAnotada([lista, { role: 'assistant', content: 'Pedido PICKUP-ABCD1234 confirmado. Total: $1.' }])).toEqual([]);
    expect(esConfirmacionDePedido('Tu pedido DOM-ABCD1234 quedó cancelado, estaba confirmado')).toBe(false);
  });

  it('lee la lista sin precios, aunque la frase quedó pegada al renglón', () => {
    expect(loAnotado('Te anoto:\n• 3 × Combo Picada Box Si algo no es lo que buscás, decime y lo cambio.\n\n¿Está completo?')).toEqual([{ cantidad: 3, nombre: 'Combo Picada Box' }]);
    expect(loAnotado('• 2 × Fernet — $20.500')).toEqual([]);
  });

  it('coincide si son las mismas cantidades y nombres', () => {
    const anotado = [{ cantidad: 3, nombre: 'Combo Picada Box' }, { cantidad: 2, nombre: 'Fernet Branca 750 cc' }];
    expect(coincideConLoAnotado(anotado, [{ cantidad: 2, nombre: 'Fernet Branca x750cc' }, { cantidad: 3, nombre: 'Combo Picada Box' }])).toBe(true); // "750" está en "x750cc"
    expect(coincideConLoAnotado(anotado, [{ cantidad: 2, nombre: 'Fernet Branca 750 cc' }, { cantidad: 3, nombre: 'Combo Picada Box' }])).toBe(true);
  });

  it('no coincide si el modelo cambió una cantidad, un producto o sumó un renglón', () => {
    const anotado = [{ cantidad: 3, nombre: 'Combo Picada Box' }];
    expect(coincideConLoAnotado(anotado, [{ cantidad: 4, nombre: 'Combo Picada Box' }])).toBe(false);
    expect(coincideConLoAnotado(anotado, [{ cantidad: 3, nombre: 'Picada ODB XL' }])).toBe(false);
    expect(coincideConLoAnotado(anotado, [{ cantidad: 3, nombre: 'Combo Picada Box' }, { cantidad: 1, nombre: 'Hielo' }])).toBe(false);
    expect(coincideConLoAnotado([], [{ cantidad: 3, nombre: 'Combo Picada Box' }])).toBe(false);
  });
});

describe('nombreDeQuienRetira', () => {
  it.each([
    ['Juan Pérez', 'Juan Pérez'],
    ['a nombre de ana gomez', 'Ana Gomez'],
    ['Lo retira Carlos', 'Carlos'],
    ['soy Marta.', 'Marta'],
    ['Catalina', 'Catalina'],
  ])('"%s" → %s', (t, n) => expect(nombreDeQuienRetira(t)).toBe(n));

  it.each(['yo', 'mañana', 'efectivo', '¿a qué hora abren?', 'sumale 2 cocas', 'gracias', 'a mi nombre', 'yo mismo', 'Castex', 'con tarjeta', 'a la tarde', 'el sabado', 'no se todavia', 'Pago con transferencia', 'a las 11', 'mi hijo'])('"%s" no es un nombre', (t) => expect(nombreDeQuienRetira(t)).toBeNull());
  it.each([['Inés', 'Inés'], ["María O'Connor", "María O'Connor"], ['juan josé', 'Juan José']])('"%s" → %s', (t, n) => expect(nombreDeQuienRetira(t)).toBe(n));
});

describe('cuandoLegible', () => {
  it('fecha y franja en palabras', () => {
    expect(cuandoLegible('2026-10-04', 'mañana')).toBe('el domingo 4/10 por la mañana');
    expect(cuandoLegible('2026-10-05', null)).toBe('el lunes 5/10');
    expect(cuandoLegible(null, 'tarde')).toBe('por la tarde');
    expect(cuandoLegible(null, null)).toBeNull();
  });
});
