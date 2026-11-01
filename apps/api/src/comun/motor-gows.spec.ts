import { wahaUrlDe } from './lineas';
import { enviarTextoWhatsapp, existeEnWhatsapp } from './whatsapp';
import { BotService } from '../bot/bot.service';

// LA LÍNEA GENERAL EN UN WAHA CON EL MOTOR GOWS (1/11/2026). Con NOWEB se
// cortaba ~54 veces por día y cada tanto quedaba conectada pero sin poder leer
// los mensajes. El motor se elige por contenedor: la general va a un WAHA
// aparte y la del local sigue en el de siempre. Lo que se prueba:
//   1. cada sesión va al WAHA que le toca, y sin las variables nuevas todo
//      sigue yendo a WAHA_URL;
//   2. lo que se manda por la general sale por el WAHA de GOWS;
//   3. el teléfono real de un @lid se lee también donde lo pone GOWS.

const ENTORNO = ['WAHA_URL', 'WAHA_API_KEY', 'WAHA_SESSION', 'WAHA_GOWS_URL', 'WAHA_GOWS_SESIONES'] as const;
const antes: Record<string, string | undefined> = {};
const fetchOriginal = global.fetch;

beforeEach(() => {
  for (const k of ENTORNO) antes[k] = process.env[k];
  process.env.WAHA_URL = 'http://waha:3000/';
  process.env.WAHA_API_KEY = 'k';
  process.env.WAHA_SESSION = 'odb';
  process.env.WAHA_GOWS_URL = 'http://waha-gows:3000';
  process.env.WAHA_GOWS_SESIONES = 'odb';
});
afterEach(() => {
  for (const k of ENTORNO) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
  global.fetch = fetchOriginal;
});

describe('a qué WAHA va cada sesión', () => {
  it('la general (y la principal sin nombre) van al de GOWS; la del local, al de siempre', () => {
    expect(wahaUrlDe('odb')).toBe('http://waha-gows:3000');
    expect(wahaUrlDe(undefined)).toBe('http://waha-gows:3000');
    expect(wahaUrlDe('odb-local')).toBe('http://waha:3000');
  });

  it('sin las variables nuevas, todo va a WAHA_URL como antes', () => {
    delete process.env.WAHA_GOWS_URL;
    delete process.env.WAHA_GOWS_SESIONES;
    expect(wahaUrlDe('odb')).toBe('http://waha:3000');
    expect(wahaUrlDe('odb-local')).toBe('http://waha:3000');
  });

  it('acepta varias sesiones separadas por coma, con espacios', () => {
    process.env.WAHA_GOWS_SESIONES = ' otra , odb-local ';
    expect(wahaUrlDe('odb-local')).toBe('http://waha-gows:3000');
    expect(wahaUrlDe('odb')).toBe('http://waha:3000');
  });
});

describe('lo que sale por WhatsApp', () => {
  function fetchFalso() {
    const pedidos: { url: string; cuerpo: any }[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      pedidos.push({ url: String(url), cuerpo: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ id: 'true_5491100000000@c.us_X', numberExists: true, chatId: '5491100000000@c.us' }) } as any;
    }) as any;
    return pedidos;
  }
  const db: any = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };

  it('un aviso por la general sale por el WAHA de GOWS; uno por el local, por el de siempre', async () => {
    const pedidos = fetchFalso();
    await enviarTextoWhatsapp(db, '1100000000', 'hola');
    await enviarTextoWhatsapp(db, '1100000000', 'hola', 'aviso_interno', 'odb-local');
    expect(pedidos.map((p) => [p.url, p.cuerpo.session])).toEqual([
      ['http://waha-gows:3000/api/sendText', 'odb'],
      ['http://waha:3000/api/sendText', 'odb-local'],
    ]);
  });

  it('la consulta de si un número tiene WhatsApp también va al WAHA de la sesión', async () => {
    const pedidos = fetchFalso();
    await existeEnWhatsapp('1100000000', 'odb');
    expect(pedidos[0].url.startsWith('http://waha-gows:3000/api/contacts/check-exists?')).toBe(true);
  });
});

describe('el teléfono real de un @lid con GOWS', () => {
  const telefonoDeLaCarga = (p: any) => (BotService.prototype as any).telefonoDeLaCarga.call({}, p);

  it('lo lee de Info.SenderAlt', () => {
    const p = { from: '149585506861130@lid', _data: { Info: { Chat: '149585506861130@lid', Sender: '149585506861130@lid', SenderAlt: '5491135031294@s.whatsapp.net', IsFromMe: false, PushName: 'Richard' } } };
    expect(telefonoDeLaCarga(p)).toEqual({ numero: '5491135031294', campo: '_data.Info.SenderAlt' });
  });

  it('en lo que sale del teléfono, de Info.RecipientAlt', () => {
    const p = { fromMe: true, from: '149585506861130@lid', _data: { Info: { Chat: '149585506861130@lid', RecipientAlt: '5491135031294@s.whatsapp.net', IsFromMe: true } } };
    expect(telefonoDeLaCarga(p)).toEqual({ numero: '5491135031294', campo: '_data.Info.RecipientAlt' });
  });

  it('con NOWEB sigue leyendo donde leía', () => {
    const p = { from: '149585506861130@lid', _data: { key: { remoteJid: '149585506861130@lid', remoteJidAlt: '5491135031294@s.whatsapp.net' } } };
    expect(telefonoDeLaCarga(p)).toEqual({ numero: '5491135031294', campo: '_data.key.remoteJidAlt' });
  });
});
