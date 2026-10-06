import { CajaService, textoDiferenciaCaja } from './caja.service';

// Cierre de caja (6/10/2026): sesiones_caja.cerrada_por no se escribía nunca
// (cerrar_sesion_caja no recibe el usuario), así que cuando un supervisor
// cerraba la caja de otro no quedaba rastro de quién. Y un cierre con
// faltante o sobrante no le avisaba a nadie: había que entrar a Cierres a mirar.

type Resp = { data?: any; error?: any };

function dbFalsa(opts: { tablas?: Record<string, Resp>; arqueo?: any; rpcError?: any } = {}) {
  const ops: any[] = [];
  const db: any = {
    from: jest.fn((tabla: string) => {
      const op: any = { tabla, accion: 'select', filtros: [] as any[] };
      ops.push(op);
      const r = (modo: 'uno' | 'lista') => {
        const t = opts.tablas ?? {};
        const v = t[`${tabla}:${op.accion}`] ?? t[`${tabla}:${modo}`] ?? t[tabla];
        return Promise.resolve({ data: v?.data ?? (modo === 'lista' ? [] : null), error: v?.error ?? null });
      };
      const q: any = {
        select: (s?: string) => { if (op.accion === 'select') op.select = s; return q; },
        insert: (v: any) => { op.accion = 'insert'; op.valores = v; return q; },
        update: (v: any) => { op.accion = 'update'; op.valores = v; return q; },
        eq: (c: string, v: any) => { op.filtros.push(['eq', c, v]); return q; },
        is: (c: string, v: any) => { op.filtros.push(['is', c, v]); return q; },
        order: () => q, limit: () => q,
        maybeSingle: () => r('uno'), single: () => r('uno'),
        then: (ok: any, mal: any) => r('lista').then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      ops.push({ rpc: nombre, args });
      return Promise.resolve(opts.rpcError ? { data: null, error: opts.rpcError } : { data: opts.arqueo ?? null, error: null });
    }),
  };
  const avisos = () => ops.filter((o) => o.tabla === 'alertas_internas' && o.accion === 'insert').map((o) => o.valores);
  return { db, ops, avisos };
}

const sesion = { caja: { nombre: 'Caja 1', sucursal: { nombre: 'Saint Thomas' } }, usuario: { nombre: 'Romina' } };

describe('CajaService.cerrar: quién cerró', () => {
  it('guarda cerrada_por con el usuario que cerró (solo si estaba vacío)', async () => {
    const { db, ops } = dbFalsa({ arqueo: { diferencia: 0, esperado: 1000, contado: 1000 } });
    await new CajaService(db).cerrar('ses-1', 1000, 'u-ger', 'gerente');
    const upd = ops.find((o) => o.tabla === 'sesiones_caja' && o.accion === 'update');
    expect(upd.valores).toEqual({ cerrada_por: 'u-ger' });
    expect(upd.filtros).toEqual([['eq', 'id', 'ses-1'], ['is', 'cerrada_por', null]]);
  });

  it('si el cierre falla en la base, no se toca nada más', async () => {
    const { db, ops } = dbFalsa({ rpcError: { message: 'La sesion ya esta cerrada' } });
    await expect(new CajaService(db).cerrar('ses-1', 1000, 'u-ger', 'gerente')).rejects.toThrow(/ya esta cerrada/);
    expect(ops.some((o) => o.accion === 'update' || o.accion === 'insert')).toBe(false);
  });

  it('si no se puede guardar quién cerró, la caja igual figura cerrada (no se le tira error al cajero)', async () => {
    const { db } = dbFalsa({ arqueo: { diferencia: 0 }, tablas: { 'sesiones_caja:update': { error: { message: 'caída' } } } });
    await expect(new CajaService(db).cerrar('ses-1', 1000, 'u-ger', 'gerente')).resolves.toEqual({ diferencia: 0 });
  });
});

describe('CajaService.cerrar: aviso de diferencia', () => {
  it('cierre justo: sin campanita', async () => {
    const { db, avisos } = dbFalsa({ arqueo: { diferencia: 0, esperado: 1000, contado: 1000 } });
    await new CajaService(db).cerrar('ses-1', 1000, 'u-ger', 'gerente');
    expect(avisos()).toEqual([]);
  });

  it('faltante: campanita sin destinatario (dueños) con caja, monto, quién cerró y link a Cierres', async () => {
    const { db, avisos } = dbFalsa({
      arqueo: { diferencia: -3200, esperado: 53200, contado: 50000 },
      tablas: { 'sesiones_caja:uno': { data: sesion }, 'usuarios:uno': { data: { nombre: 'Lucas' } } },
    });
    await new CajaService(db).cerrar('ses-1', 50000, 'u-ger', 'gerente');
    expect(avisos()).toEqual([{
      para_usuario: null,
      tipo: 'caja_diferencia',
      titulo: 'Caja 1 (Saint Thomas) cerró con un faltante de $3.200',
      detalle: 'Cerró Lucas (la caja era de Romina). Tenía que haber $53.200 y se contaron $50.000. El detalle está en Cierres → Diferencias.',
      referencia: { sesionId: 'ses-1', diferencia: -3200, link: '/cierres' },
    }]);
  });

  it('si el aviso falla, el cierre ya hecho se devuelve igual', async () => {
    const { db } = dbFalsa({
      arqueo: { diferencia: 150 },
      tablas: { 'sesiones_caja:uno': { data: sesion }, 'alertas_internas:insert': { error: { message: 'caída' } } },
    });
    await expect(new CajaService(db).cerrar('ses-1', 1150, 'u-caja', 'gerente')).resolves.toEqual({ diferencia: 150 });
  });
});

describe('textoDiferenciaCaja', () => {
  it('sobrante, cerrado por el mismo cajero', () => {
    expect(textoDiferenciaCaja({ caja: 'Caja 2', cerro: 'Romina', cajero: 'Romina', diferencia: 500 })).toEqual({
      titulo: 'Caja 2 cerró con un sobrante de $500',
      detalle: 'Cerró Romina. El detalle está en Cierres → Diferencias.',
    });
  });
});
