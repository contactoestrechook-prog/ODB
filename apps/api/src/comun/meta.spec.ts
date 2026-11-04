import { createHmac } from 'crypto';
import { enviarPorMeta, esMeta, eventosDeMeta, firmaMetaValida, phoneIdDe, sesionDePhoneId } from './meta';
import { enviarWhatsapp } from './whatsapp';
import { hayWhatsapp, wahaUrlDe } from './lineas';

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, META_SESIONES: 'odb', META_PHONE_ID_ODB: '111', META_TOKEN: 'tok', META_APP_SECRET: 'secreto', WAHA_URL: 'http://waha:3000', WAHA_API_KEY: 'k', WAHA_SESSION: 'odb' };
});
afterEach(() => { process.env = ENV; jest.restoreAllMocks(); });

// el webhook real de Meta, recortado (un texto, una nota de voz y un eco del teléfono)
const webhook = (cambios: any[]) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: cambios }] });
const meta = { display_phone_number: '5491122812200', phone_number_id: '111' };

describe('API oficial: qué sesión va por Meta', () => {
  it('solo las de META_SESIONES y con token', () => {
    expect(esMeta('odb')).toBe(true);
    expect(esMeta('odb-local')).toBe(false);
    delete process.env.META_TOKEN;
    expect(esMeta('odb')).toBe(false);
  });
  it('la sesión de Meta no tiene WAHA, pero sí tiene WhatsApp', () => {
    expect(wahaUrlDe('odb')).toBeUndefined();
    expect(wahaUrlDe('odb-local')).toBe('http://waha:3000');
    expect(hayWhatsapp('odb')).toBe(true);
  });
  it('phone_number_id de ida y de vuelta', () => {
    expect(phoneIdDe('odb')).toBe('111');
    expect(sesionDePhoneId('111')).toBe('odb');
    expect(sesionDePhoneId('999')).toBeNull();
  });
});

describe('API oficial: la firma del webhook', () => {
  const cuerpo = Buffer.from('{"a":1}');
  const firma = 'sha256=' + createHmac('sha256', 'secreto').update(cuerpo).digest('hex');
  it('acepta la firma buena y rechaza el resto', () => {
    expect(firmaMetaValida(cuerpo, firma)).toBe(true);
    expect(firmaMetaValida(Buffer.from('{"a":2}'), firma)).toBe(false);
    expect(firmaMetaValida(cuerpo, undefined)).toBe(false);
  });
  it('sin la clave secreta no entra nada', () => {
    delete process.env.META_APP_SECRET;
    expect(firmaMetaValida(cuerpo, firma)).toBe(false);
  });
});

describe('API oficial: lo que entra se traduce a la forma de WAHA', () => {
  it('un texto de un cliente', () => {
    const [e] = eventosDeMeta(webhook([{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: meta,
      contacts: [{ profile: { name: 'Marta' }, wa_id: '5491155550000' }],
      messages: [{ from: '5491155550000', id: 'wamid.A', timestamp: '1793790000', type: 'text', text: { body: 'Hola, ¿tienen Malbec?' } }] } }]));
    expect(e.numeroLinea).toBe('5491122812200');
    expect(e.evento).toMatchObject({ event: 'message', session: 'odb', me: { id: '5491122812200@c.us' } });
    expect(e.evento.payload).toMatchObject({ id: 'wamid.A', from: '5491155550000@c.us', fromMe: false, body: 'Hola, ¿tienen Malbec?', type: 'chat', notifyName: 'Marta', timestamp: 1793790000 });
  });
  it('una nota de voz y una foto con epígrafe llevan el id de Meta para bajarlas', () => {
    const ev = eventosDeMeta(webhook([{ field: 'messages', value: { metadata: meta, contacts: [], messages: [
      { from: '5491155550000', id: 'wamid.B', timestamp: '1', type: 'audio', audio: { id: 'M1', mime_type: 'audio/ogg; codecs=opus', voice: true } },
      { from: '5491155550000', id: 'wamid.C', timestamp: '1', type: 'image', image: { id: 'M2', mime_type: 'image/jpeg', caption: 'esta lista' }, context: { id: 'wamid.X' } },
    ] } }]));
    expect(ev[0].evento.payload).toMatchObject({ type: 'ptt', hasMedia: true, media: { metaId: 'M1', mimetype: 'audio/ogg; codecs=opus' } });
    expect(ev[1].evento.payload).toMatchObject({ type: 'image', body: 'esta lista', caption: 'esta lista', media: { metaId: 'M2' }, replyTo: { id: 'wamid.X' } });
  });
  it('un botón o una ubicación', () => {
    const ev = eventosDeMeta(webhook([{ field: 'messages', value: { metadata: meta, messages: [
      { from: '549', id: 'b', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'si', title: 'Sí, confirmo' } } },
      { from: '549', id: 'l', timestamp: '1', type: 'location', location: { latitude: -34.8, longitude: -58.5, name: 'Casa' } },
      { from: '549', id: 'r', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } },
    ] } }]));
    expect(ev).toHaveLength(2); // la reacción no es un mensaje para contestar
    expect(ev[0].evento.payload.body).toBe('Sí, confirmo');
    expect(ev[1].evento.payload.location).toMatchObject({ latitude: -34.8, longitude: -58.5, description: 'Casa' });
  });
  it('lo que alguien manda desde el teléfono (coexistencia) entra como fromMe, para que el bot se pause', () => {
    const [e] = eventosDeMeta(webhook([{ field: 'smb_message_echoes', value: { metadata: meta,
      message_echoes: [{ from: '5491122812200', to: '5491155550000', id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'Te lo preparo' } }] } }]));
    expect(e.evento.event).toBe('message.any');
    expect(e.evento.payload).toMatchObject({ fromMe: true, to: '5491155550000@c.us', body: 'Te lo preparo' });
  });
  it('los estados de entrega y los números de otra sesión no son mensajes', () => {
    expect(eventosDeMeta(webhook([{ field: 'messages', value: { metadata: meta, statuses: [{ id: 'x', status: 'delivered' }] } }]))).toEqual([]);
    expect(eventosDeMeta(webhook([{ field: 'messages', value: { metadata: { ...meta, phone_number_id: '999' }, messages: [{ from: '1', id: 'z', type: 'text', text: { body: 'a' } }] } }]))).toEqual([]);
  });
});

describe('API oficial: lo que sale', () => {
  const db: any = { from: () => ({ insert: () => Promise.resolve({}), select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) };

  it('un texto va a /messages con el phone_number_id y el token', async () => {
    const f = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) } as any);
    const r = await enviarWhatsapp(db, { to: '11 5555-0000', text: 'Hola', sesion: 'odb' });
    expect(r).toMatchObject({ enviado: true, id: 'wamid.OK' });
    const [url, init] = (f.mock.calls[0] as any);
    expect(url).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/111\/messages$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({ messaging_product: 'whatsapp', to: '5491155550000', type: 'text', text: { body: 'Hola' } });
  });

  it('fuera de las 24 h sale por la línea de respaldo (WAHA)', async () => {
    process.env.META_RESPALDO_SESION = 'odb-local';
    const f = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 131047, message: 'Re-engagement message' } }) } as any)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'true_549@c.us_3EB0' }) } as any);
    const r = await enviarWhatsapp(db, { to: '5491155550000', text: 'Pedido nuevo', sesion: 'odb' });
    expect(r.enviado).toBe(true);
    const [url2, init2] = (f.mock.calls[1] as any);
    expect(url2).toBe('http://waha:3000/api/sendText');
    expect(JSON.parse(init2.body)).toMatchObject({ session: 'odb-local', chatId: '5491155550000@c.us' });
  });

  it('sin respaldo, fuera de las 24 h no sale y lo dice claro', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 131047 } }) } as any);
    const r = await enviarWhatsapp(db, { to: '5491155550000', text: 'x', sesion: 'odb' });
    expect(r).toMatchObject({ enviado: false, incierto: false });
    expect(r.motivo).toMatch(/24 h/);
  });

  it('a un grupo no se manda por la API oficial', async () => {
    const r = await enviarWhatsapp(db, { to: '120363@g.us', text: 'x', sesion: 'odb' });
    expect(r).toMatchObject({ enviado: false, reintentable: false });
  });

  it('una foto y un PDF van con su link', async () => {
    const f = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'w' }] }) } as any);
    await enviarPorMeta('odb', '549', { imagenUrl: 'https://x/a.jpg', text: 'mirá' });
    await enviarPorMeta('odb', '549', { documentoUrl: 'https://x/remito.pdf', nombreArchivo: 'Remito.pdf' });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toMatchObject({ type: 'image', image: { link: 'https://x/a.jpg', caption: 'mirá' } });
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toMatchObject({ type: 'document', document: { link: 'https://x/remito.pdf', filename: 'Remito.pdf' } });
  });
});
