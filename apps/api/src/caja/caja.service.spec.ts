import { BadRequestException } from '@nestjs/common';
import { CajaService } from './caja.service';

// Contratos de la caja: el PIN de supervisor y los movimientos de efectivo
// (que entran al arqueo) no pueden aflojarse sin que estos tests lo griten.

function dbFalsa(opts: { pinResultado?: any; sesion?: any; autorizacion?: any }) {
  const inserts: any[] = [];
  const db: any = {
    rpc: jest.fn(() => {
      const res = { data: opts.pinResultado ?? null, error: null };
      return Object.assign(Promise.resolve(res), { maybeSingle: () => Promise.resolve(res) });
    }),
    from: jest.fn((tabla: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        gt: () => q,
        maybeSingle: () =>
          Promise.resolve(
            tabla === 'autorizaciones_caja' && opts.autorizacion !== undefined
              ? { data: opts.autorizacion, error: null }
              : { data: opts.sesion ?? null, error: null },
          ),
        single: () => Promise.resolve({ data: { id: 'mov-1' }, error: null }),
        insert: (v: any) => { inserts.push([tabla, v]); return q; },
        update: (v: any) => { inserts.push([`${tabla}:update`, v]); return q; },
        order: () => q,
      };
      return q;
    }),
  };
  return { db, inserts };
}

describe('CajaService.autorizar (PIN de supervisor)', () => {
  it('devuelve un token de un solo uso si el PIN es correcto (nunca el usuarioId directo)', async () => {
    const { db } = dbFalsa({ pinResultado: { id: 'sup-1', nombre: 'Gerente', rol: 'gerente' } });
    const svc = new CajaService(db);
    const r = await svc.autorizar('4321');
    expect(r).toEqual({ token: 'mov-1', nombre: 'Gerente', rol: 'gerente' });
  });

  it('rechaza un PIN incorrecto', async () => {
    const { db } = dbFalsa({ pinResultado: null });
    const svc = new CajaService(db);
    await expect(svc.autorizar('0000')).rejects.toThrow(/PIN incorrecto/);
  });
});

describe('CajaService.consumirAutorizacion (token de PIN de un solo uso)', () => {
  it('sin token devuelve null (no exige autorización si no aplica)', async () => {
    const { db } = dbFalsa({});
    const svc = new CajaService(db);
    expect(await svc.consumirAutorizacion(undefined)).toBeNull();
  });

  it('resuelve el usuarioId real a partir de un token vigente y no usado', async () => {
    const { db, inserts } = dbFalsa({
      autorizacion: { usuario_id: 'sup-1', usuario: { nombre: 'Gerente', rol: 'gerente' } },
    });
    const svc = new CajaService(db);
    const r = await svc.consumirAutorizacion('tok-1');
    expect(r).toEqual({ usuarioId: 'sup-1', nombre: 'Gerente', rol: 'gerente' });
    expect(inserts[0][0]).toBe('autorizaciones_caja:update');
  });

  it('rechaza un token vencido, ya usado o inexistente', async () => {
    const { db } = dbFalsa({ autorizacion: null });
    const svc = new CajaService(db);
    await expect(svc.consumirAutorizacion('tok-viejo')).rejects.toThrow(/inválida, vencida o ya utilizada/);
  });
});

describe('CajaService.registrarMovimiento', () => {
  const sesionAbierta = { id: 's-1', cerrada_en: null };

  it('registra un egreso válido', async () => {
    const { db, inserts } = dbFalsa({ sesion: sesionAbierta });
    const svc = new CajaService(db);
    const r = await svc.registrarMovimiento({ sesionId: 's-1', tipo: 'egreso', monto: 500, motivo: 'Retiro' }, 'u-1');
    expect(r.id).toBe('mov-1');
    expect(inserts[0][0]).toBe('caja_movimientos');
    expect(inserts[0][1]).toMatchObject({ tipo: 'egreso', monto: 500, usuario_id: 'u-1' });
  });

  it('rechaza montos inválidos, motivo vacío y tipos desconocidos', async () => {
    const { db } = dbFalsa({ sesion: sesionAbierta });
    const svc = new CajaService(db);
    await expect(svc.registrarMovimiento({ sesionId: 's-1', tipo: 'egreso', monto: 0, motivo: 'x' })).rejects.toThrow(BadRequestException);
    await expect(svc.registrarMovimiento({ sesionId: 's-1', tipo: 'egreso', monto: 100, motivo: '  ' })).rejects.toThrow(/motivo/);
    await expect(svc.registrarMovimiento({ sesionId: 's-1', tipo: 'robo' as any, monto: 100, motivo: 'x' })).rejects.toThrow(/Tipo/);
  });

  it('rechaza movimientos sobre una sesión cerrada', async () => {
    const { db } = dbFalsa({ sesion: { id: 's-1', cerrada_en: '2026-07-01' } });
    const svc = new CajaService(db);
    await expect(svc.registrarMovimiento({ sesionId: 's-1', tipo: 'ingreso', monto: 100, motivo: 'x' })).rejects.toThrow(/cerrada/);
  });
});
