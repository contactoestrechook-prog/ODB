// Ráfagas de WhatsApp (8/10/2026): el bot espera 60 s desde el último mensaje
// (tope 90 s desde el primero) y contesta UNA vez con todo junto.
import { esperaDeRafaga, msHastaContestar, cierraLaRafaga, juntarRafaga } from './espera-rafaga';
import { BotService } from './bot.service';

describe('espera-rafaga: cuentas', () => {
  it('por defecto espera 60 s con tope de 90 s', () => {
    expect(esperaDeRafaga({})).toEqual({ esperaMs: 60_000, topeMs: 90_000 });
  });
  it('se regula por variables, y 0 vuelve a contestar al instante', () => {
    expect(esperaDeRafaga({ ODB_BOT_ESPERA_SEG: '45', ODB_BOT_ESPERA_MAX_SEG: '120' })).toEqual({ esperaMs: 45_000, topeMs: 120_000 });
    expect(esperaDeRafaga({ ODB_BOT_ESPERA_SEG: '0' }).esperaMs).toBe(0);
    expect(esperaDeRafaga({ ODB_BOT_ESPERA_SEG: 'abc' }).esperaMs).toBe(60_000);
    // el tope nunca es menor que la espera
    expect(esperaDeRafaga({ ODB_BOT_ESPERA_SEG: '100', ODB_BOT_ESPERA_MAX_SEG: '90' }).topeMs).toBe(100_000);
  });
  it('espera desde el último mensaje, sin pasar el tope desde el primero', () => {
    expect(msHastaContestar(0, 0, 60_000, 90_000)).toBe(60_000);
    expect(msHastaContestar(0, 20_000, 60_000, 90_000)).toBe(60_000);
    expect(msHastaContestar(0, 50_000, 60_000, 90_000)).toBe(40_000);
    expect(msHastaContestar(0, 95_000, 60_000, 90_000)).toBe(0);
  });
  it('un segundo archivo cierra la ráfaga', () => {
    expect(cierraLaRafaga([{ telefono: '1', archivoBase64: 'x' }], { telefono: '1', archivoBase64: 'y' })).toBe(true);
    expect(cierraLaRafaga([{ telefono: '1', mensaje: 'hola' }], { telefono: '1', archivoBase64: 'y' })).toBe(false);
  });
  it('Los Talas: los cinco mensajes en un solo turno, en orden y con el id del último', () => {
    const msjs = ['6 BIDONES DE AGUA', '15 PACK DE VILLAVICENCIO DE 500', '1 PACK DE 6 DE LECHE PROTEIN', 'Buen dia les dejo un pedido para el lote 15 de los talas', 'Saludooos'];
    const j = juntarRafaga(msjs.map((m, i) => ({ linea: 'pedidos', telefono: '255477590057085', mensaje: m, mensajeId: `id${i}` })));
    expect(j.mensaje).toBe(msjs.join('\n'));
    expect(j.mensajeId).toBe('id4');
    expect(j.linea).toBe('pedidos');
    expect(j.archivoBase64).toBeUndefined();
  });
  it('una foto con texto antes y después viaja con todos los textos', () => {
    const j = juntarRafaga([
      { telefono: '1', mensaje: 'te paso el comprobante' },
      { telefono: '1', mensaje: '', archivoBase64: 'AAA', mimeType: 'image/jpeg', archivoUrl: 'u' },
      { telefono: '1', mensaje: 'es de ayer', mensajeId: 'z' },
    ]);
    expect(j).toMatchObject({ mensaje: 'te paso el comprobante\nes de ayer', archivoBase64: 'AAA', mimeType: 'image/jpeg', archivoUrl: 'u', mensajeId: 'z' });
  });
  it('un audio en la ráfaga marca el turno como de audio', () => {
    expect(juntarRafaga([{ telefono: '1', mensaje: 'hola' }, { telefono: '1', mensaje: 'quiero 2 cocas', deAudio: true }]).deAudio).toBe(true);
  });
});

describe('charlaWhatsapp: una sola respuesta por ráfaga', () => {
  const armar = () => {
    const bot: any = Object.create(BotService.prototype);
    bot.rafagas = new Map();
    bot.log = { log: () => undefined, warn: () => undefined, error: () => undefined };
    bot.charla = jest.fn(async (dto: any) => ({ respuesta: `Te anoto: ${dto.mensaje.replace(/\n/g, ' | ')}` }));
    return bot;
  };
  const antes = { ...process.env };
  beforeEach(() => { jest.useFakeTimers(); delete process.env.ODB_BOT_ESPERA_SEG; delete process.env.ODB_BOT_ESPERA_MAX_SEG; });
  afterEach(() => { jest.useRealTimers(); process.env = { ...antes }; });

  it('Los Talas: 5 mensajes en 14 s → charla una vez, a los 60 s del último, y solo el último lleva la respuesta', async () => {
    const bot = armar();
    const tiempos = [0, 0, 0, 11_000, 14_000];
    const textos = ['6 BIDONES DE AGUA', '15 PACK DE VILLAVICENCIO DE 500', '1 PACK DE 6 DE LECHE PROTEIN', 'les dejo un pedido para el lote 15 de los talas', 'Saludooos'];
    const promesas: Promise<any>[] = [];
    let t = 0;
    for (let i = 0; i < textos.length; i++) {
      jest.advanceTimersByTime(tiempos[i] - t); t = tiempos[i];
      promesas.push(bot.charlaWhatsapp({ linea: 'pedidos', telefono: '255477590057085@lid', mensaje: textos[i], mensajeId: `m${i}` }, true));
    }
    jest.advanceTimersByTime(59_000);
    expect(bot.charla).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(bot.charla).toHaveBeenCalledTimes(1);
    expect(bot.charla.mock.calls[0][0].mensaje).toBe(textos.join('\n'));
    const r = await Promise.all(promesas);
    expect(r.slice(0, 4).every((x) => x.respuesta === null && x.agrupado)).toBe(true);
    expect(r[4].respuesta).toContain('6 BIDONES DE AGUA');
  });

  it('si el cliente sigue escribiendo, contesta a los 90 s del primero', async () => {
    const bot = armar();
    const p: Promise<any>[] = [];
    for (let s = 0; s <= 80; s += 20) {
      p.push(bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: `msj ${s}` }, true));
      jest.advanceTimersByTime(20_000);
    }
    // van 100 s: el tope de 90 s ya disparó
    expect(bot.charla).toHaveBeenCalledTimes(1);
    await Promise.all(p);
  });

  it('dos chats distintos no se mezclan', async () => {
    const bot = armar();
    const a = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'a' }, true);
    const b = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '222', mensaje: 'b' }, true);
    jest.advanceTimersByTime(60_000);
    expect(bot.charla).toHaveBeenCalledTimes(2);
    expect((await a).respuesta).toContain('a');
    expect((await b).respuesta).toContain('b');
  });

  it('sin agrupar (barrido) o con la espera en 0 contesta al instante', async () => {
    const bot = armar();
    await bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'x' }, false);
    expect(bot.charla).toHaveBeenCalledTimes(1);
    process.env.ODB_BOT_ESPERA_SEG = '0';
    await bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'y' }, true);
    expect(bot.charla).toHaveBeenCalledTimes(2);
  });

  it('un segundo archivo contesta la ráfaga anterior y empieza otra', async () => {
    const bot = armar();
    const f1 = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'foto 1', archivoBase64: 'A' }, true);
    const f2 = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'foto 2', archivoBase64: 'B' }, true);
    expect(bot.charla).toHaveBeenCalledTimes(1);
    expect((await f1).respuesta).toContain('foto 1');
    jest.advanceTimersByTime(60_000);
    expect(bot.charla).toHaveBeenCalledTimes(2);
    expect((await f2).respuesta).toContain('foto 2');
  });

  it('si la charla falla, el último recibe el error y los anteriores quedan sin respuesta', async () => {
    const bot = armar();
    bot.charla = jest.fn(async () => { throw new Error('sin crédito'); });
    const a = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'a' }, true);
    const b = bot.charlaWhatsapp({ linea: 'pedidos', telefono: '111', mensaje: 'b' }, true);
    jest.advanceTimersByTime(60_000);
    await expect(b).rejects.toThrow('sin crédito');
    expect((await a).respuesta).toBeNull();
  });
});
