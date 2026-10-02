import { audioDeclarado, estadoOgg } from './ogg';
import { BotService } from './bot.service';

// 2/10/2026: las notas de voz de WhatsApp no traen la marca de fin del OGG y el
// chequeo viejo las daba a todas por "a medio escribir" (7 s de espera por
// audio y un log de "puede estar cortado" falso). Ver ogg.ts.

// Página OGG con carga: 'OggS' + versión + header_type + granule(8) + serial(4)
// + seq(4) + crc(4) + nsegs(1) + tabla de segmentos + carga
function pagina(headerType: number, carga = 10, granule = 0n) {
  const cab = Buffer.alloc(27);
  cab.write('OggS', 0, 'ascii');
  cab[5] = headerType;
  cab.writeBigInt64LE(granule, 6);
  cab[26] = 1;
  return Buffer.concat([cab, Buffer.from([carga]), Buffer.alloc(carga, 7)]);
}

describe('estadoOgg', () => {
  it('nota de WhatsApp entera: páginas enteras sin marca de fin, con su duración', () => {
    const b = Buffer.concat([pagina(0x02), pagina(0x00), pagina(0x00, 10, 48000n * 15n)]);
    expect(estadoOgg(b)).toEqual({ paginasEnteras: true, eos: false, segundos: 15 });
  });

  it('archivo cortado en el medio de una página: no está entero', () => {
    const b = Buffer.concat([pagina(0x02), pagina(0x00)]);
    expect(estadoOgg(b.subarray(0, b.length - 4)).paginasEnteras).toBe(false);
  });

  it('marca de fin de stream', () => {
    expect(estadoOgg(Buffer.concat([pagina(0x02), pagina(0x04)])).eos).toBe(true);
  });

  it('lo que no es un OGG', () => {
    expect(estadoOgg(Buffer.from('no soy un ogg'))).toEqual({ paginasEnteras: false, eos: false, segundos: null });
  });
});

describe('audioDeclarado (payload de WAHA NOWEB)', () => {
  it('lee fileLength y seconds como número, texto o Long', () => {
    expect(audioDeclarado({ _data: { message: { audioMessage: { fileLength: 161838, seconds: 70 } } } })).toEqual({ bytes: 161838, segundos: 70 });
    expect(audioDeclarado({ _data: { message: { audioMessage: { fileLength: '79327', seconds: '33' } } } })).toEqual({ bytes: 79327, segundos: 33 });
    expect(audioDeclarado({ _data: { message: { audioMessage: { fileLength: { low: 71893, high: 0 } } } } }).bytes).toBe(71893);
    expect(audioDeclarado({})).toEqual({ bytes: null, segundos: null });
  });
});

describe('bajarMediaWaha: no espera de más con un audio entero', () => {
  const falso = { log: { log: () => undefined, warn: () => undefined } };
  const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const bajar = async (respuestas: Buffer[], extra: any = {}) => {
    const fetchViejo = global.fetch;
    let llamadas = 0;
    global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => ab(respuestas[Math.min(llamadas++, respuestas.length - 1)]) })) as any;
    process.env.WAHA_URL = 'https://waha';
    const t0 = Date.now();
    try {
      const r = await (BotService.prototype as any).bajarMediaWaha.call(falso, {
        media: { url: 'https://waha/api/files/x.oga', mimetype: 'audio/ogg; codecs=opus' }, ...extra,
      });
      return { r, llamadas, ms: Date.now() - t0 };
    } finally {
      global.fetch = fetchViejo;
    }
  };
  const entero = Buffer.concat([pagina(0x02), pagina(0x00), pagina(0x00, 10, 48000n * 20n)]);

  it('si mide lo que WhatsApp declaró, se acepta en la primera bajada (sin esperar)', async () => {
    const { r, llamadas, ms } = await bajar([entero], { _data: { message: { audioMessage: { fileLength: entero.length, seconds: 20 } } } });
    expect(llamadas).toBe(1);
    expect(ms).toBeLessThan(1000);
    expect(Buffer.from(r.base64, 'base64').length).toBe(entero.length);
  });

  it('sin tamaño declarado: páginas enteras y tamaño estable en la segunda bajada', async () => {
    const { llamadas } = await bajar([entero, entero]);
    expect(llamadas).toBe(2);
  }, 10000);

  it('si de verdad estaba a medio escribir, reintenta y se queda con la versión completa', async () => {
    const cortado = entero.subarray(0, entero.length - 5);
    const { r, llamadas } = await bajar([cortado, entero], { _data: { message: { audioMessage: { fileLength: entero.length } } } });
    expect(llamadas).toBe(2);
    expect(Buffer.from(r.base64, 'base64').length).toBe(entero.length);
  }, 10000);
});
