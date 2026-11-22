// «Que en el proceso se marque cuando se le comunicó al cliente que no está ese
// producto, ej. la Cindor» (Leandro, 22/11/2026). El caso real: DOM-1284BEF14D1D.
import {
  anotarAvisoDelTelefono, avisaQueFalta, AVISOS_DESDE, diceQueFalta, EVENTO_AVISO, lineaDeAviso, lineaDePregunta,
  lineaSinAviso, palabrasDe, productosQueNombra, sacadosSinAviso,
} from './aviso-faltante';
import { PedidosService } from './pedidos.service';

const CINDOR = 'Leche Cindor x 200 cc';
const CITRIC = 'Jugo Citric de naranja x 3 LT';
const ILOLAY = 'Leche Ilolay chocolatada x 200cc';

describe('qué mensaje avisa que falta un producto', () => {
  it('las palabras que nombran al producto (sin medidas ni genéricas)', () => {
    expect(palabrasDe(CINDOR)).toEqual(['leche', 'cindor']);
    expect(palabrasDe('Galletitas Oreo x 118 g pack')).toEqual(['galletitas', 'oreo']);
  });

  it('el mensaje de la Cindor que se mandó desde el teléfono del local', () => {
    expect(avisaQueFalta('Cindor no hay , te puedo ofrecer ilolay x 200cc', [CITRIC, CINDOR])).toEqual([CINDOR]);
  });

  it('lo demás que se le escribió ese día no es un aviso de faltante', () => {
    for (const t of ['No no vienen sin pulpa ese citric', 'no todo con pulta', 'pulpa', 'Hola cómo estás', 'A q alias te transfiero??', 'Gracias y disculpa']) {
      expect(avisaQueFalta(t, [CITRIC, CINDOR])).toEqual([]);
    }
  });

  it('otras formas de decirlo', () => {
    for (const t of ['No tenemos Cindor', 'se nos terminó la cindor', 'la Cindor está agotada', 'Faltó la Cindor', 'De Cindor no queda, en su lugar va Ilolay', 'Cindor sin stock']) {
      expect(diceQueFalta(t)).toBe(true);
      expect(avisaQueFalta(t, [CITRIC, CINDOR])).toEqual([CINDOR]);
    }
  });

  it('lo que no distingue (leche) no alcanza para decir cuál; lo propio, sí', () => {
    expect(productosQueNombra('no hay leche', [CINDOR, ILOLAY])).toEqual([]);
    expect(productosQueNombra('no tenemos ilolay', [CINDOR, ILOLAY])).toEqual([ILOLAY]);
    expect(productosQueNombra('no hay cindor ni citric', [CINDOR, CITRIC])).toEqual([CINDOR, CITRIC]);
  });

  it('singular y plural', () => {
    expect(avisaQueFalta('no quedan oreos', ['Galletitas Oreo x 118 g'])).toEqual(['Galletitas Oreo x 118 g']);
    expect(avisaQueFalta('no hay galletita oreo', ['Galletitas Oreo x 118 g'])).toEqual(['Galletitas Oreo x 118 g']);
  });
});

describe('las líneas de «Quién hizo cada cosa»', () => {
  it('desde el teléfono, con lo que se le escribió', () => {
    expect(lineaDeAviso({ por: 'telefono', productos: [CINDOR], texto: 'Cindor no hay , te puedo ofrecer ilolay x 200cc' })).toEqual({
      que: 'Se le avisó al cliente que no hay Leche Cindor x 200 cc: se lo escribieron desde el teléfono del local («Cindor no hay , te puedo ofrecer ilolay x 200cc»)',
      tono: 'info',
    });
  });

  it('el «No hay: avisarle» del armado, y cuando no salió', () => {
    expect(lineaDeAviso({ por: 'whatsapp', productos: [CINDOR], avisado: true }).que).toBe('Se le avisó al cliente por WhatsApp que no hay Leche Cindor x 200 cc y que no va en el pedido');
    expect(lineaDeAviso({ por: 'whatsapp', productos: [CINDOR], avisado: false, motivo: 'No tengo el WhatsApp del cliente: avisale vos (llamalo).' })).toEqual({
      que: 'No se le pudo avisar al cliente que no hay Leche Cindor x 200 cc: No tengo el WhatsApp del cliente: avisale vos (llamalo).',
      tono: 'error',
    });
  });

  it('la pregunta por un parecido o por otra variedad', () => {
    expect(lineaDePregunta({ tipo: 'parecido', nombre_falta: CINDOR, nombre_reemplazo: ILOLAY, cantidad: 3 }))
      .toBe('Se le avisó al cliente por WhatsApp que no hay Leche Cindor x 200 cc y se le preguntó si le sirve 3 × Leche Ilolay chocolatada x 200cc');
    expect(lineaDePregunta({ tipo: 'variedad', nombre_falta: 'Alfajor Havanna', pedida: 'dulce de leche', variedades: ['chocolate', 'merengue'] }))
      .toBe('Se le avisó al cliente por WhatsApp que no hay Alfajor Havanna de dulce de leche y se le preguntó cuál quiere: chocolate, merengue');
  });
});

describe('lo que se sacó sin avisarle al cliente queda a la vista', () => {
  const hoy = (hhmm: string) => `2026-11-22T${hhmm}:00.000Z`;
  const sacoCindor = (cuando: string, cantidad = 17) => ({ evento: 'productos', creado_en: cuando, detalle: { saco: { nombre: CINDOR, cantidad } } });

  it('sin ningún aviso: una línea por producto', () => {
    expect(sacadosSinAviso([sacoCindor(hoy('18:01')), sacoCindor(hoy('18:19'), 3)], [])).toEqual([{ cuando: hoy('18:01'), nombre: CINDOR }]);
    expect(lineaSinAviso(CINDOR)).toBe('No figura ningún aviso al cliente de que falta Leche Cindor x 200 cc');
  });

  it('con el mensaje del teléfono (aunque haya sido después), no', () => {
    const aviso = { evento: EVENTO_AVISO, creado_en: hoy('18:12'), detalle: { por: 'telefono', productos: [CINDOR] } };
    expect(sacadosSinAviso([sacoCindor(hoy('18:01')), aviso], [])).toEqual([]);
  });

  it('con la pregunta por un parecido, o con lo que anotó quien arma después de llamarlo, no', () => {
    expect(sacadosSinAviso([sacoCindor(hoy('18:19'), 3)], [{ nombre_falta: CINDOR, preguntado_en: hoy('18:16') }])).toEqual([]);
    expect(sacadosSinAviso([sacoCindor(hoy('18:19'), 3), { evento: 'reemplazo', creado_en: hoy('18:19'), detalle: { falta: CINDOR, acepta: false } }], [])).toEqual([]);
  });

  it('un aviso que no salió no cuenta como aviso', () => {
    const fallido = { evento: EVENTO_AVISO, creado_en: hoy('18:02'), detalle: { por: 'whatsapp', productos: [CINDOR], avisado: false } };
    expect(sacadosSinAviso([sacoCindor(hoy('18:01')), fallido], [])).toHaveLength(1);
  });

  it('lo de antes del 22/11 no se marca (antes no se anotaban los del teléfono)', () => {
    expect(sacadosSinAviso([sacoCindor('2026-11-21T18:01:19Z')], [])).toEqual([]);
    expect(Date.parse(AVISOS_DESDE)).toBeGreaterThan(Date.parse('2026-11-21T23:59:59-03:00') - 1);
  });
});

// ---------------------------------------------------------------------------
// Una base de mentira que contesta por tabla y anota lo que se escribe
// ---------------------------------------------------------------------------
function baseFalsa(datos: Record<string, any>) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const db: any = {
    from(tabla: string) {
      let op = 'select';
      const res = () => (op === 'select' ? { data: datos[tabla] ?? null, error: null } : { data: null, error: null });
      const b: any = new Proxy({}, {
        get(_t, k) {
          if (k === 'then') return (ok: any, mal: any) => Promise.resolve(res()).then(ok, mal);
          if (k === 'maybeSingle' || k === 'single') return async () => res();
          if (['insert', 'update', 'upsert', 'delete'].includes(String(k))) return (fila: any) => { op = String(k); escrituras.push({ tabla, op, fila }); return b; };
          return () => b;
        },
      });
      return b;
    },
  };
  return { db, escrituras };
}

describe('lo que se escribe desde el teléfono del local queda en el pedido', () => {
  const PEDIDO = { id: 'p-st', estado: 'en_preparacion', items: [{ producto: { nombre: CITRIC } }, { producto: { nombre: CINDOR } }] };

  it('el aviso de la Cindor queda en el historial de su pedido abierto', async () => {
    const { db, escrituras } = baseFalsa({ bot_cotizaciones: [{ pedido_id: 'p-st' }], pedidos: [PEDIDO], pedidos_historial: [], pedidos_reemplazos: [] });
    const en = '2026-11-21T18:12:17.113Z';
    expect(await anotarAvisoDelTelefono(db, { linea: 'local', chat: '209117880799232', texto: 'Cindor no hay , te puedo ofrecer ilolay x 200cc', en })).toEqual(['p-st']);
    expect(escrituras).toEqual([{
      tabla: 'pedidos_historial', op: 'insert',
      fila: { pedido_id: 'p-st', evento: EVENTO_AVISO, estado_despues: 'en_preparacion', usuario_id: null, detalle: { por: 'telefono', productos: [CINDOR], texto: 'Cindor no hay , te puedo ofrecer ilolay x 200cc' }, creado_en: en },
    }]);
  });

  it('un producto que ya se sacó del pedido también cuenta', async () => {
    const { db, escrituras } = baseFalsa({
      bot_cotizaciones: [{ pedido_id: 'p-st' }], pedidos: [{ ...PEDIDO, items: [{ producto: { nombre: CITRIC } }] }],
      pedidos_historial: [{ pedido_id: 'p-st', detalle: { saco: { nombre: CINDOR } } }], pedidos_reemplazos: [],
    });
    await anotarAvisoDelTelefono(db, { linea: 'local', chat: '209117880799232', texto: 'perdón, la cindor no la tenemos' });
    expect(escrituras[0].fila.detalle.productos).toEqual([CINDOR]);
  });

  it('un saludo, o sin pedido abierto, no anota nada', async () => {
    const con = baseFalsa({ bot_cotizaciones: [{ pedido_id: 'p-st' }], pedidos: [PEDIDO], pedidos_historial: [], pedidos_reemplazos: [] });
    expect(await anotarAvisoDelTelefono(con.db, { linea: 'local', chat: '209117880799232', texto: 'Hola cómo estás' })).toEqual([]);
    const sin = baseFalsa({ bot_cotizaciones: [{ pedido_id: 'p-st' }], pedidos: [], pedidos_historial: [], pedidos_reemplazos: [] });
    expect(await anotarAvisoDelTelefono(sin.db, { linea: 'local', chat: '209117880799232', texto: 'Cindor no hay' })).toEqual([]);
    expect([...con.escrituras, ...sin.escrituras]).toEqual([]);
  });
});

describe('«Quién hizo cada cosa» de DOM-1284BEF14D1D', () => {
  it('se ve cuándo se le avisó al cliente que no había Cindor', async () => {
    const { db } = baseFalsa({
      usuarios: [{ id: 'jp', nombre: 'Juan Pablo Fernandez' }, { id: 'arma', nombre: 'Jaqui' }],
      pedidos: { origen: 'bot', qr_retiro: 'DOM-1284BEF14D1D', canal: 'domicilio' },
      avisos_pedidos: [], pedidos_mensajes: [],
      pedidos_historial: [
        { evento: 'productos', usuario_id: 'arma', creado_en: '2026-11-21T18:01:19.909Z', detalle: { saco: { nombre: CINDOR, cantidad: 17 }, total_antes: 118200, total: 50200 } },
        { evento: EVENTO_AVISO, usuario_id: null, creado_en: '2026-11-21T18:12:17.113Z', detalle: { por: 'telefono', productos: [CINDOR], texto: 'Cindor no hay , te puedo ofrecer ilolay x 200cc' } },
        { evento: 'reemplazo', usuario_id: null, creado_en: '2026-11-21T18:19:20.717Z', detalle: { falta: CINDOR, reemplazo: ILOLAY, acepta: false, por_whatsapp: true } },
      ],
      pedidos_reemplazos: [{ tipo: 'parecido', nombre_falta: CINDOR, nombre_reemplazo: ILOLAY, cantidad: 3, preguntado_en: '2026-11-21T18:16:09.919Z' }],
    });
    const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
    const lineas = (await svc.historial('p-st')).map((l) => [l.cuando.slice(11, 16), l.que, l.quien]);
    expect(lineas).toEqual([
      ['18:01', 'Faltaba stock: sacó 17 × Leche Cindor x 200 cc ($118.200 → $50.200)', 'Jaqui'],
      ['18:12', 'Se le avisó al cliente que no hay Leche Cindor x 200 cc: se lo escribieron desde el teléfono del local («Cindor no hay , te puedo ofrecer ilolay x 200cc»)', null],
      ['18:16', 'Se le avisó al cliente por WhatsApp que no hay Leche Cindor x 200 cc y se le preguntó si le sirve 3 × Leche Ilolay chocolatada x 200cc', null],
      ['18:19', 'No quiso Leche Ilolay chocolatada x 200cc en lugar de Leche Cindor x 200 cc (lo contestó el cliente por WhatsApp)', null],
    ]);
  });

  it('si nadie le avisa (desde el 22/11), lo dice en rojo debajo de lo que se sacó', async () => {
    const { db } = baseFalsa({
      usuarios: [{ id: 'arma', nombre: 'Jaqui' }], pedidos: { origen: 'bot', qr_retiro: 'DOM-X', canal: 'domicilio' },
      avisos_pedidos: [], pedidos_mensajes: [], pedidos_reemplazos: [],
      pedidos_historial: [{ evento: 'productos', usuario_id: 'arma', creado_en: '2026-11-22T15:01:00.000Z', detalle: { saco: { nombre: CINDOR, cantidad: 17 } } }],
    });
    const lineas = await new PedidosService(db, { aCliente: jest.fn() } as any).historial('p-x');
    expect(lineas.map((l) => [l.que, l.tono])).toEqual([
      ['Faltaba stock: sacó 17 × Leche Cindor x 200 cc', 'atencion'],
      ['No figura ningún aviso al cliente de que falta Leche Cindor x 200 cc', 'error'],
    ]);
  });
});
