const mockTranscribir = jest.fn(async (_bin: Buffer, _mime: string, _voc?: string): Promise<string | null> => 'el cliente vuelve a buscar el cambio');
jest.mock('../comun/transcribir', () => ({
  ...jest.requireActual('../comun/transcribir'),
  transcribirAudio: (bin: Buffer, mime: string, voc?: string) => mockTranscribir(bin, mime, voc),
}));

import { BadRequestException } from '@nestjs/common';
import { NotasVentaService, contarNotasYReimpresiones, faltaLaTabla, prepararNota, NOTA_MAX_CARACTERES } from './notas-venta.service';

// Notas (texto o audio) y reimpresiones de un ticket de caja (5/11/2026).
// Se fija el contrato: qué se valida, qué se guarda, quién queda como autor,
// y que la caja no se cae si la migración todavía no está aplicada.

const AUDIO = Buffer.alloc(4000, 7).toString('base64');
const SIN_TABLA = { code: 'PGRST205', message: "Could not find the table 'public.ventas_notas' in the schema cache" };

function dbFalsa(o: { venta?: any; tablas?: Record<string, { data?: any; error?: any }>; insertError?: Record<string, any>; subirError?: any } = {}) {
  const inserts: [string, any][] = [];
  const subidas: [string, Buffer, any][] = [];
  const borrados: string[][] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        maybeSingle: () => Promise.resolve({ data: tabla === 'ventas' ? (o.venta === undefined ? { id: 'v1', sesion_caja_id: 's1' } : o.venta) : null, error: null }),
        insert: (fila: any) => {
          inserts.push([tabla, fila]);
          return Promise.resolve({ data: null, error: o.insertError?.[tabla] ?? null });
        },
        then: (res: any) => Promise.resolve({ data: o.tablas?.[tabla]?.data ?? [], error: o.tablas?.[tabla]?.error ?? null }).then(res),
      };
      return q;
    }),
    storage: {
      from: () => ({
        upload: (ruta: string, bin: Buffer, opts: any) => { subidas.push([ruta, bin, opts]); return Promise.resolve({ error: o.subirError ?? null }); },
        remove: (rutas: string[]) => { borrados.push(rutas); return Promise.resolve({ error: null }); },
        createSignedUrls: (rutas: string[]) => Promise.resolve({ data: rutas.map((p) => ({ path: p, signedUrl: `https://firmado/${p}` })), error: null }),
      }),
    },
  };
  return { db, inserts, subidas, borrados };
}

beforeEach(() => mockTranscribir.mockClear());

describe('prepararNota', () => {
  it('acepta texto solo y lo recorta', () => {
    expect(prepararNota({ texto: '  le faltó el vuelto  ' })).toEqual({ texto: 'le faltó el vuelto', audio: null });
  });

  it('pide algo: ni texto ni audio no se guarda', () => {
    expect(() => prepararNota({ texto: '   ' })).toThrow(BadRequestException);
    expect(() => prepararNota(undefined)).toThrow('Escribí algo o grabá un audio');
  });

  it('limita el largo del texto', () => {
    expect(() => prepararNota({ texto: 'x'.repeat(NOTA_MAX_CARACTERES + 1) })).toThrow(/muy larga/);
  });

  it('acepta un audio del navegador (webm con codecs) y redondea los segundos', () => {
    const r = prepararNota({ audioBase64: AUDIO, audioMime: 'audio/webm;codecs=opus', audioSegundos: 12.6 });
    expect(r.texto).toBeNull();
    expect(r.audio?.mime).toBe('audio/webm');
    expect(r.audio?.segundos).toBe(13);
    expect(r.audio?.bin.length).toBe(4000);
  });

  it('acepta el audio con el prefijo data: que arma FileReader', () => {
    const r = prepararNota({ audioBase64: `data:audio/webm;base64,${AUDIO}`, audioMime: 'audio/webm' });
    expect(r.audio?.bin.length).toBe(4000);
  });

  it('rechaza lo que no es audio, el audio vacío y el demasiado largo', () => {
    expect(() => prepararNota({ audioBase64: AUDIO, audioMime: 'image/png' })).toThrow('El archivo no es un audio');
    expect(() => prepararNota({ audioBase64: 'AAAA', audioMime: 'audio/webm' })).toThrow(/vacío/);
    const enorme = Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64');
    expect(() => prepararNota({ audioBase64: enorme, audioMime: 'audio/webm' })).toThrow(/muy largo/);
  });
});

describe('faltaLaTabla', () => {
  it('reconoce la migración sin aplicar (PostgREST y Postgres)', () => {
    expect(faltaLaTabla(SIN_TABLA)).toBe(true);
    expect(faltaLaTabla({ code: '42P01', message: 'relation "ventas_notas" does not exist' })).toBe(true);
    expect(faltaLaTabla({ message: 'permission denied' })).toBe(false);
    expect(faltaLaTabla(null)).toBe(false);
  });
});

describe('NotasVentaService.agregar', () => {
  it('guarda una nota escrita a nombre de quien está logueado, con la sesión de la venta', async () => {
    const { db, inserts, subidas } = dbFalsa();
    await new NotasVentaService(db).agregar('v1', { texto: 'pagó con dos billetes rotos' }, 'u-cajera');
    expect(subidas).toHaveLength(0);
    expect(mockTranscribir).not.toHaveBeenCalled();
    expect(inserts).toEqual([
      ['ventas_notas', expect.objectContaining({ venta_id: 'v1', sesion_caja_id: 's1', usuario_id: 'u-cajera', texto: 'pagó con dos billetes rotos', audio_ruta: null, transcripcion: null })],
    ]);
  });

  it('sube el audio al depósito privado y guarda la transcripción', async () => {
    const { db, inserts, subidas } = dbFalsa();
    await new NotasVentaService(db).agregar('v1', { audioBase64: AUDIO, audioMime: 'audio/webm;codecs=opus', audioSegundos: 9 }, 'u-cajera');
    expect(subidas).toHaveLength(1);
    expect(subidas[0][0]).toMatch(/^caja-notas\/v1\/[0-9a-f-]{36}\.webm$/);
    expect(subidas[0][2]).toEqual(expect.objectContaining({ contentType: 'audio/webm', upsert: false }));
    expect(mockTranscribir).toHaveBeenCalledTimes(1);
    const fila = inserts[0][1];
    expect(fila.audio_ruta).toBe(subidas[0][0]);
    expect(fila.audio_mime).toBe('audio/webm');
    expect(fila.audio_segundos).toBe(9);
    expect(fila.transcripcion).toBe('el cliente vuelve a buscar el cambio');
  });

  it('sin transcripción (sin clave o falló) el audio se guarda igual', async () => {
    mockTranscribir.mockResolvedValueOnce(null);
    const { db, inserts } = dbFalsa();
    await new NotasVentaService(db).agregar('v1', { audioBase64: AUDIO, audioMime: 'audio/ogg' }, 'u1');
    expect(inserts[0][1].transcripcion).toBeNull();
    expect(inserts[0][1].audio_ruta).toMatch(/\.ogg$/);
  });

  it('si no pudo guardar la fila, borra el audio subido (no deja huérfanos)', async () => {
    const { db, borrados } = dbFalsa({ insertError: { ventas_notas: { message: 'algo falló' } } });
    await expect(new NotasVentaService(db).agregar('v1', { audioBase64: AUDIO, audioMime: 'audio/webm' }, 'u1')).rejects.toThrow('algo falló');
    expect(borrados).toHaveLength(1);
    expect(borrados[0][0]).toMatch(/^caja-notas\/v1\//);
  });

  it('sin la migración avisa claro', async () => {
    const { db } = dbFalsa({ insertError: { ventas_notas: SIN_TABLA } });
    await expect(new NotasVentaService(db).agregar('v1', { texto: 'hola' }, 'u1')).rejects.toThrow(/todavía no están habilitadas/);
  });

  it('una venta que no existe no lleva nota', async () => {
    const { db, inserts } = dbFalsa({ venta: null });
    await expect(new NotasVentaService(db).agregar('nada', { texto: 'hola' }, 'u1')).rejects.toThrow('Esa venta no existe');
    expect(inserts).toHaveLength(0);
  });
});

describe('NotasVentaService.listar', () => {
  it('devuelve autor, hora, texto y un enlace firmado para escuchar el audio', async () => {
    const { db } = dbFalsa({
      tablas: {
        ventas_notas: {
          data: [
            { id: 'n1', texto: 'faltó cambio', audio_ruta: null, audio_segundos: null, transcripcion: null, creado_en: '2026-11-05T13:00:00Z', usuario: { nombre: 'Melina' } },
            { id: 'n2', texto: null, audio_ruta: 'caja-notas/v1/n2.webm', audio_segundos: 7, transcripcion: 'vuelve mañana', creado_en: '2026-11-05T13:05:00Z', usuario: { nombre: 'Melina' } },
          ],
        },
      },
    });
    const notas = await new NotasVentaService(db).listar('v1');
    expect(notas).toEqual([
      { id: 'n1', texto: 'faltó cambio', audioUrl: null, audioSegundos: null, transcripcion: null, creadoEn: '2026-11-05T13:00:00Z', usuario: 'Melina' },
      { id: 'n2', texto: null, audioUrl: 'https://firmado/caja-notas/v1/n2.webm', audioSegundos: 7, transcripcion: 'vuelve mañana', creadoEn: '2026-11-05T13:05:00Z', usuario: 'Melina' },
    ]);
  });

  it('sin la migración devuelve vacío: el detalle del ticket se sigue abriendo', async () => {
    const { db } = dbFalsa({ tablas: { ventas_notas: { error: SIN_TABLA }, ventas_reimpresiones: { error: SIN_TABLA } } });
    const s = new NotasVentaService(db);
    await expect(s.listar('v1')).resolves.toEqual([]);
    await expect(s.reimpresiones('v1')).resolves.toEqual([]);
  });
});

describe('NotasVentaService.reimpresion', () => {
  it('registra quién reimprimió y devuelve cuántas van', async () => {
    const { db, inserts } = dbFalsa({
      tablas: { ventas_reimpresiones: { data: [{ creado_en: '2026-11-05T13:10:00Z', usuario: { nombre: 'Melina' } }] } },
    });
    const r = await new NotasVentaService(db).reimpresion('v1', 'u-cajera');
    expect(inserts).toEqual([['ventas_reimpresiones', { venta_id: 'v1', sesion_caja_id: 's1', usuario_id: 'u-cajera' }]]);
    expect(r).toEqual({ veces: 1, reimpresiones: [{ creadoEn: '2026-11-05T13:10:00Z', usuario: 'Melina' }] });
  });
});

describe('contarNotasYReimpresiones', () => {
  it('cuenta por ticket', async () => {
    const { db } = dbFalsa({
      tablas: {
        ventas_notas: { data: [{ venta_id: 'a' }, { venta_id: 'a' }, { venta_id: 'b' }] },
        ventas_reimpresiones: { data: [{ venta_id: 'b' }] },
      },
    });
    await expect(contarNotasYReimpresiones(db, ['a', 'b', 'c'])).resolves.toEqual({
      a: { notas: 2, reimpresiones: 0 },
      b: { notas: 1, reimpresiones: 1 },
    });
  });

  it('sin la migración, todo en cero', async () => {
    const { db } = dbFalsa({ tablas: { ventas_notas: { error: SIN_TABLA }, ventas_reimpresiones: { error: SIN_TABLA } } });
    await expect(contarNotasYReimpresiones(db, ['a'])).resolves.toEqual({});
  });
});
