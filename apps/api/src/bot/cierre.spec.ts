import { cambiaElContenido, cierraLaLista, coincideConLoAnotado, cuandoLegible, listaCerrada, loAnotado, nombreDeQuienRetira } from './cierre';

const PREGUNTA = 'Te anoto:\n• 3 × Combo Picada Box\n\n¿Está completo el pedido o querés sumar algo?';

describe('cierraLaLista (el "nada más" confirma, 3/10/2026)', () => {
  it.each(['Solo eso…', 'solo eso', 'nada más', 'No, nada más', 'no nada mas gracias', 'es todo', 'Eso es todo gracias', 'ya está', 'con eso estamos'])(
    '"%s" cierra la lista', (t) => expect(cierraLaLista(t, PREGUNTA)).toBe(true));

  it.each(['sí', 'Si si genial', 'Perfecto', 'dale', '👍'])('"%s" cierra si contesta "¿Está completo?"', (t) => {
    expect(cierraLaLista(t, PREGUNTA)).toBe(true);
    expect(cierraLaLista(t, '¿Lo retirás por la sucursal o te lo enviamos?')).toBe(false);
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

  it('se anula cuando el pedido ya quedó confirmado', () => {
    const historial = h(['user', '3 picadas'], ['assistant', PREGUNTA], ['user', 'nada más'], ['assistant', 'Pedido PICKUP-5F2451C6C111 confirmado. Total: $133.500.']);
    expect(listaCerrada(historial, 'Juan Pérez')).toBeNull();
  });

  it('sin cierre no hay lista cerrada', () => {
    expect(listaCerrada(h(['user', '3 picadas'], ['assistant', PREGUNTA]), '¿cuánto sale cada una?')).toBeNull();
  });
});

describe('cambiaElContenido', () => {
  it.each(['sumale 2 cocas', 'cambiá el fernet por uno de 1 litro', '2 hielos', 'mejor que sean 4'])('"%s" cambia', (t) => expect(cambiaElContenido(t)).toBe(true));
  it.each(['lo retiro', 'Los Talas 15, Canning', 'mañana a la tarde', 'Juan Pérez', 'efectivo'])('"%s" no cambia', (t) => expect(cambiaElContenido(t)).toBe(false));
});

describe('loAnotado y coincideConLoAnotado', () => {
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

  it.each(['yo', 'mañana', 'efectivo', '¿a qué hora abren?', 'sumale 2 cocas', 'gracias'])('"%s" no es un nombre', (t) => expect(nombreDeQuienRetira(t)).toBeNull());
});

describe('cuandoLegible', () => {
  it('fecha y franja en palabras', () => {
    expect(cuandoLegible('2026-10-04', 'mañana')).toBe('el domingo 4/10 por la mañana');
    expect(cuandoLegible('2026-10-05', null)).toBe('el lunes 5/10');
    expect(cuandoLegible(null, 'tarde')).toBe('por la tarde');
    expect(cuandoLegible(null, null)).toBeNull();
  });
});
