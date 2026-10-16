// La pausa del teléfono vence sola (Leandro, 16/10/2026): «cuando le escribimos desde el
// teléfono, el bot se pause durante 25 o 30 minutos y después se vuelva a iniciar».
import { BotService } from './bot.service';
import { MOTIVO_TELEFONO, minutosPausaTelefono, vencePausaTelefono } from './pausa';

process.env.ANTHROPIC_API_KEY ??= 'test';

describe('cuánto dura la pausa del teléfono', () => {
  it('30 minutos por defecto; se puede cambiar con ODB_BOT_PAUSA_TELEFONO_MIN', () => {
    expect(minutosPausaTelefono({})).toBe(30);
    expect(minutosPausaTelefono({ ODB_BOT_PAUSA_TELEFONO_MIN: '25' })).toBe(25);
    // un valor roto no deja al bot pausado para siempre ni lo despierta enseguida
    expect(minutosPausaTelefono({ ODB_BOT_PAUSA_TELEFONO_MIN: 'x' })).toBe(30);
    expect(minutosPausaTelefono({ ODB_BOT_PAUSA_TELEFONO_MIN: '1' })).toBe(30);
  });
  it('vence 30 minutos después del último mensaje desde el teléfono', () => {
    const t = Date.parse('2026-10-16T15:00:00Z');
    expect(vencePausaTelefono(t, {})).toBe('2026-10-16T15:30:00.000Z');
  });
});

// base falsa: guarda lo que se le pide a cada tabla y contesta lo que se le cargue
function base(conversaciones: any[], actualizadas = 1) {
  const llamadas: { tabla: string; op: string; filtros: [string, string, any][]; datos?: any }[] = [];
  const db: any = {
    from: (tabla: string) => {
      const ll: any = { tabla, op: 'select', filtros: [] as any[] };
      llamadas.push(ll);
      const q: any = {
        select: () => q,
        update: (datos: any) => { ll.op = 'update'; ll.datos = datos; return q; },
        upsert: (datos: any) => { ll.op = 'upsert'; ll.datos = datos; return Promise.resolve({ error: null }); },
        eq: (c: string, v: any) => { ll.filtros.push(['eq', c, v]); return q; },
        not: (c: string, o: string, v: any) => { ll.filtros.push(['not', c, `${o} ${v}`]); return q; },
        lte: (c: string, v: any) => { ll.filtros.push(['lte', c, v]); return q; },
        limit: () => q,
        then: (ok: any, mal: any) => Promise.resolve(
          ll.op === 'update' ? { data: Array.from({ length: actualizadas }, () => ({ telefono: 'x' })), error: null } : { data: conversaciones, error: null },
        ).then(ok, mal),
      };
      return q;
    },
    rpc: jest.fn(),
  };
  return { db, llamadas };
}

function servicio(db: any, { manda = true, responde = true }: { manda?: boolean; responde?: boolean | null } = {}) {
  const s: any = new BotService(db, {} as any, {} as any, {} as any, {} as any);
  s.respondeMandaEn = jest.fn(async () => manda);
  s.respondeCfg = jest.fn(() => (responde === null ? null : { url: 'u', key: 'k', clave: 'c' }));
  s.respondeRpc = jest.fn(async () => (responde ? { ok: true } : null));
  s.respondePausar = jest.fn(async () => undefined);
  return s;
}

describe('el barrido que despierta al bot', () => {
  const vencida = { linea: 'pedidos', telefono: '104570256634038', derivacion_vence_en: '2026-10-16T15:30:00+00:00' };

  it('busca solo las pausas del teléfono ya vencidas (las de RESPONDE y las derivaciones no)', async () => {
    const { db, llamadas } = base([]);
    await servicio(db).reanudarPausasDelTelefono();
    const busca = llamadas.find((l) => l.op === 'select')!;
    expect(busca.filtros).toEqual(expect.arrayContaining([
      ['eq', 'bot_activo', false], ['eq', 'derivada_motivo', MOTIVO_TELEFONO], ['not', 'derivacion_vence_en', 'is null'],
    ]));
    expect(busca.filtros.find((f) => f[0] === 'lte')?.[1]).toBe('derivacion_vence_en');
  });

  it('vencida: reactiva en RESPONDE y después en ODB, sin tocar el silencio del contacto', async () => {
    const { db, llamadas } = base([vencida]);
    const s = servicio(db);
    await s.reanudarPausasDelTelefono();
    expect(s.respondeRpc).toHaveBeenCalledWith('odb_reactivar_contacto', { p_whatsapp_id: '104570256634038@lid' });
    const upd = llamadas.find((l) => l.op === 'update')!;
    expect(upd.tabla).toBe('bot_conversaciones');
    expect(upd.datos).toMatchObject({ bot_activo: true, derivacion_vence_en: null });
    // solo si el plazo no se corrió mientras tanto
    expect(upd.filtros).toEqual(expect.arrayContaining([['eq', 'derivacion_vence_en', vencida.derivacion_vence_en], ['eq', 'bot_activo', false]]));
    expect(llamadas.some((l) => l.tabla === 'bot_contactos')).toBe(false);
    expect(s.respondePausar).not.toHaveBeenCalled();
  });

  it('si RESPONDE no contesta, no se reactiva acá (lo volvería a pausar): se reintenta al minuto', async () => {
    const { db, llamadas } = base([vencida]);
    await servicio(db, { responde: false }).reanudarPausasDelTelefono();
    expect(llamadas.some((l) => l.op === 'update')).toBe(false);
  });

  it('si alguien volvió a escribir desde el teléfono en el medio, queda pausada también en RESPONDE', async () => {
    const { db } = base([vencida], 0);
    const s = servicio(db);
    await s.reanudarPausasDelTelefono();
    expect(s.respondePausar).toHaveBeenCalledWith('104570256634038@lid', null, 'pedidos');
  });

  it('en otra línea RESPONDE no manda: se reactiva solo en ODB', async () => {
    const { db, llamadas } = base([{ ...vencida, linea: 'local' }]);
    const s = servicio(db, { manda: false });
    await s.reanudarPausasDelTelefono();
    expect(s.respondeRpc).not.toHaveBeenCalled();
    expect(llamadas.some((l) => l.op === 'update')).toBe(true);
  });
});
