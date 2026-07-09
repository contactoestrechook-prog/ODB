import { BadRequestException } from '@nestjs/common';
import { CompraFacilService } from './comprafacil.service';

// Regresión del P0 encontrado en la auditoría (Codex, 2026-07-09): dos
// webhooks de Mercado Pago para el mismo pago podían generar dos ventas
// (sin atomicidad en el "estado === pagado" check), no había venta_id
// estable, y un fallo (p.ej. sin stock) se tragaba después de que MP ya
// había cobrado, dejando el pendiente colgado sin venta ni código de salida.

function dbFalsa(opts: { claim?: any; registrarVenta?: { data?: any; error?: any } } = {}) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: opts.claim ?? null, error: null }),
    update: (v: any) => {
      calls.push({ table: current, op: 'update', payload: v });
      return q;
    },
    insert: (v: any) => {
      calls.push({ table: current, op: 'insert', payload: v });
      return q;
    },
    then: (resolve: any) => resolve({ data: null, error: null }),
  };
  let current = '';
  const db: any = {
    from: (tabla: string) => {
      current = tabla;
      return q;
    },
    rpc: (name: string, args: any) => {
      calls.push({ table: `rpc:${name}`, op: 'rpc', payload: args });
      const res = name === 'registrar_venta' ? (opts.registrarVenta ?? { data: { venta_id: 'v-1' }, error: null }) : { data: null, error: null };
      return Object.assign(Promise.resolve(res), { maybeSingle: () => Promise.resolve(res) });
    },
  };
  return { db, calls };
}

const pendienteBase = (overrides: Partial<any> = {}) => ({
  id: 'p-1',
  sucursal_id: 's-1',
  items: [{ producto_id: 'prod-1', cantidad: 2 }],
  total: 500,
  cliente_dni: '111',
  venta_id: null,
  ...overrides,
});

describe('CompraFacilService.confirmarPago (idempotencia y atomicidad ante webhooks concurrentes)', () => {
  it('si no gana el claim (ya pagado, en proceso, o no existe) no reprocesa nada', async () => {
    const { db, calls } = dbFalsa({ claim: null });
    const svc = new CompraFacilService(db);
    const r = await svc.confirmarPago('p-1');
    expect(r).toEqual({ ok: true });
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  it('claim exitoso: registra la venta con un venta_id estable y persiste el estado pagado', async () => {
    const { db, calls } = dbFalsa({ claim: pendienteBase() });
    const svc = new CompraFacilService(db);
    await svc.confirmarPago('p-1', 'mp-123');
    const rpcVenta = calls.find((c) => c.table === 'rpc:registrar_venta');
    expect(rpcVenta?.payload.p_venta_id).toEqual(expect.any(String));
    const reservaVentaId = calls.find((c) => c.table === 'compra_facil_pendientes' && c.payload?.venta_id === rpcVenta?.payload.p_venta_id);
    expect(reservaVentaId).toBeDefined();
    const finalPagado = calls.find((c) => c.table === 'compra_facil_pendientes' && c.payload?.estado === 'pagado');
    expect(finalPagado).toBeDefined();
  });

  it('si el pendiente ya tenía venta_id (reintento), lo reusa en vez de generar uno nuevo', async () => {
    const { db, calls } = dbFalsa({ claim: pendienteBase({ venta_id: 'ya-reservado' }) });
    const svc = new CompraFacilService(db);
    await svc.confirmarPago('p-1');
    const rpcVenta = calls.find((c) => c.table === 'rpc:registrar_venta');
    expect(rpcVenta?.payload.p_venta_id).toBe('ya-reservado');
    // no debe haber una reserva nueva de venta_id (ya estaba seteado)
    const reservas = calls.filter((c) => c.table === 'compra_facil_pendientes' && c.op === 'update' && 'venta_id' in (c.payload ?? {}) && c.payload.estado !== 'pagado');
    expect(reservas).toHaveLength(0);
  });

  it('si falla registrar_venta (p.ej. sin stock), NO se traga: vuelve a pendiente con el motivo y no queda "procesando" colgado', async () => {
    const { db, calls } = dbFalsa({
      claim: pendienteBase(),
      registrarVenta: { data: null, error: { message: 'Stock insuficiente: la operación dejaría -1 unidades' } },
    });
    const svc = new CompraFacilService(db);
    await expect(svc.confirmarPago('p-1')).rejects.toThrow(BadRequestException);
    const revertido = calls.find(
      (c) => c.table === 'compra_facil_pendientes' && c.op === 'update' && c.payload?.estado === 'pendiente' && c.payload?.error_detalle,
    );
    expect(revertido).toBeDefined();
    expect(revertido?.payload.error_detalle).toMatch(/Stock insuficiente/);
    // no debe haber quedado marcado como pagado
    expect(calls.find((c) => c.payload?.estado === 'pagado')).toBeUndefined();
  });
});
