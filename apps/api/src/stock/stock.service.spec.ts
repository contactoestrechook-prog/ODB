import { BadRequestException } from '@nestjs/common';
import { StockService } from './stock.service';

// Regresión: registrarAjuste/finalizarConteo tenían el mismo agujero que ya
// se cerró en ventas/caja — un autorizadoPor mandado directo por el cliente,
// sin verificar que viniera de un PIN real. Ahora exigen el token de un solo
// uso emitido por /caja/autorizar, resuelto acá (nunca confiar en el cliente).

function dbFalsa(opts: { costo?: number; rpcError?: any } = {}) {
  const calls: any[] = [];
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: { id: 'prod-1', costo: opts.costo ?? 0 }, error: null }),
    insert: (v: any) => {
      calls.push({ tabla: 'auditoria', v });
      return q;
    },
  };
  const db: any = {
    from: () => q,
    rpc: (name: string, args: any) => {
      calls.push({ rpc: name, args });
      const res = opts.rpcError ? { data: null, error: opts.rpcError } : { data: 'mov-1', error: null };
      return Promise.resolve(res);
    },
  };
  return { db, calls };
}

function cajaFalsa(resuelve: { usuarioId: string; nombre: string; rol: string } | null) {
  return { consumirAutorizacion: jest.fn().mockResolvedValue(resuelve) } as any;
}

describe('StockService.registrarAjuste (tope de autorización con PIN de supervisor)', () => {
  it('un ajuste chico (bajo el tope) no exige autorización', async () => {
    const { db } = dbFalsa({ costo: 100 });
    const svc = new StockService(db, cajaFalsa(null));
    await expect(svc.registrarAjuste({ sku: 'X', sucursalId: 's-1', cantidad: 2, motivo: 'test' }, 'ajuste', 'u-1')).resolves.toBeDefined();
  });

  it('un ajuste grande sin autorizacionToken ni autorizadoPor se rechaza', async () => {
    const { db } = dbFalsa({ costo: 100 });
    const svc = new StockService(db, cajaFalsa(null));
    await expect(
      svc.registrarAjuste({ sku: 'X', sucursalId: 's-1', cantidad: 100, motivo: 'test' }, 'ajuste', 'u-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('un ajuste grande con autorizacionToken resuelve el usuarioId real vía CajaService (no confía en el cliente)', async () => {
    const { db, calls } = dbFalsa({ costo: 100 });
    const caja = cajaFalsa({ usuarioId: 'sup-real', nombre: 'Gerente', rol: 'gerente' });
    const svc = new StockService(db, caja);
    await svc.registrarAjuste(
      { sku: 'X', sucursalId: 's-1', cantidad: 100, motivo: 'test', autorizacionToken: 'tok-1' },
      'ajuste',
      'u-1',
    );
    expect(caja.consumirAutorizacion).toHaveBeenCalledWith('tok-1');
    const auditoria = calls.find((c) => c.tabla === 'auditoria');
    expect(auditoria.v.usuario_id).toBe('sup-real');
  });
});

describe('StockService.finalizarConteo (mismo tope de autorización)', () => {
  it('sin autorizadoPor ni autorizacionToken se rechaza', async () => {
    const { db } = dbFalsa();
    const svc = new StockService(db, cajaFalsa(null));
    await expect(svc.finalizarConteo('c-1', undefined, undefined, 'u-1')).rejects.toThrow(BadRequestException);
  });

  it('con autorizacionToken, resuelve el usuarioId vía CajaService y lo pasa como p_autorizado_por', async () => {
    const { db, calls } = dbFalsa();
    const caja = cajaFalsa({ usuarioId: 'sup-real', nombre: 'Gerente', rol: 'gerente' });
    const svc = new StockService(db, caja);
    await svc.finalizarConteo('c-1', undefined, 'tok-1', 'u-1');
    expect(caja.consumirAutorizacion).toHaveBeenCalledWith('tok-1');
    const rpc = calls.find((c) => c.rpc === 'finalizar_conteo');
    expect(rpc.args.p_autorizado_por).toBe('sup-real');
  });

  it('con autorizadoPor ya resuelto (gerente self-auth), no consulta el token', async () => {
    const { db, calls } = dbFalsa();
    const caja = cajaFalsa(null);
    const svc = new StockService(db, caja);
    await svc.finalizarConteo('c-1', 'gerente-sub', undefined, 'u-1');
    expect(caja.consumirAutorizacion).not.toHaveBeenCalled();
    const rpc = calls.find((c) => c.rpc === 'finalizar_conteo');
    expect(rpc.args.p_autorizado_por).toBe('gerente-sub');
  });
});
