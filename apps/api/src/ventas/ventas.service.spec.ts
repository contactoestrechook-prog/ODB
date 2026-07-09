import { BadRequestException } from '@nestjs/common';
import { VentasService } from './ventas.service';

// Mock mínimo del cliente de Supabase: cada test declara qué devuelve cada
// tabla/RPC. El objetivo es fijar el CONTRATO del servicio de ventas:
// - la cta cte se valida ANTES de registrar la venta
// - el comprobante A/B/R se emite y corrige la cola ARCA
// - un fallo del comprobante NO tira la venta ya registrada
// - el descuento autorizado viaja a la RPC

type Respuestas = {
  rpc?: Record<string, any | ((args: any) => any)>;
  tablas?: Record<string, any>;
};

function dbFalsa(r: Respuestas) {
  const llamadas: { rpc: [string, any][]; updates: [string, any][]; deletes: string[] } = {
    rpc: [],
    updates: [],
    deletes: [],
  };
  const db: any = {
    rpc: jest.fn((fn: string, args: any) => {
      llamadas.rpc.push([fn, args]);
      const def = r.rpc?.[fn];
      // clon por llamada: el servicio muta el resultado (le cuelga .comprobante)
      // y un objeto compartido contaminaría a los demás tests
      const crudo = typeof def === 'function' ? def(args) : def;
      const data = crudo && typeof crudo === 'object' ? JSON.parse(JSON.stringify(crudo)) : crudo;
      const res = { data: data ?? null, error: data === undefined ? { message: `rpc ${fn} sin mock` } : null };
      return Object.assign(Promise.resolve(res), { maybeSingle: () => Promise.resolve(res) });
    }),
    from: jest.fn((tabla: string) => {
      const data = r.tablas?.[tabla];
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: () => Promise.resolve({ data: data ?? null, error: null }),
        single: () => Promise.resolve({ data: data ?? null, error: data == null ? { message: `sin ${tabla}` } : null }),
        update: (v: any) => { llamadas.updates.push([tabla, v]); return q; },
        delete: () => { llamadas.deletes.push(tabla); return q; },
        insert: () => q,
        then: (res: any) => Promise.resolve({ data: data ?? [], error: null }).then(res),
      };
      return q;
    }),
  };
  return { db, llamadas };
}

const facturacionFalsa = () => ({
  emitir: jest.fn().mockResolvedValue({ id: 'comp-1', tipo: 'FB', punto_venta: 1, numero: 7, total: 100 }),
});

function servicio(r: Respuestas, fact = facturacionFalsa()) {
  const { db, llamadas } = dbFalsa(r);
  const svc = new VentasService(db, fact as any);
  return { svc, llamadas, fact, db };
}

const dtoBase = {
  sucursalId: 'suc-1',
  items: [{ sku: 'CER-1', cantidad: 2 }],
  pagos: [{ medio: 'efectivo', monto: 100 }],
};

const rpcVentaOk = {
  registrar_venta: { venta_id: 'v-1', subtotal: 100, descuento: 0, total: 100 },
};

// productoIdPorSku consulta productos y codigos_barras; devolvemos un producto
const tablasBase = {
  productos: { id: 'p-1' },
  ventas_items: [],
  ventas: { cliente_id: null },
};

describe('VentasService.registrar', () => {
  it('registra la venta y devuelve los datos de la RPC', async () => {
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase });
    const r = await svc.registrar(dtoBase as any);
    expect(r.venta_id).toBe('v-1');
    expect(r.total).toBe(100);
  });

  it('cta cte: rechaza ANTES de registrar si el cliente no existe', async () => {
    const { svc, llamadas } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, clientes: null },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/no está registrado/);
    // la venta NUNCA llegó a la base
    expect(llamadas.rpc.find(([fn]) => fn === 'registrar_venta')).toBeUndefined();
  });

  it('cta cte: rechaza si no está habilitada', async () => {
    const { svc } = servicio({
      rpc: rpcVentaOk,
      tablas: { ...tablasBase, clientes: { id: 'c-1', nombre: 'Juan', cta_cte_habilitada: false } },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/cuenta corriente habilitada/);
  });

  it('cta cte: rechaza si supera el límite de crédito', async () => {
    const { svc } = servicio({
      rpc: { ...rpcVentaOk, saldo_cuenta: 900 },
      tablas: { ...tablasBase, clientes: { id: 'c-1', cta_cte_habilitada: true, limite_credito: 950 } },
    });
    await expect(
      svc.registrar({ ...dtoBase, pagos: [{ medio: 'cta_cte', monto: 100 }], clienteDni: '123' } as any),
    ).rejects.toThrow(/límite de crédito/);
  });

  it('comprobante B: emite FB ligada a la venta', async () => {
    const fact = facturacionFalsa();
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B' } as any);
    expect(fact.emitir).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'FB', ventaId: 'v-1', condicionPago: 'contado', moverStock: false }),
      undefined,
    );
    expect(r.comprobante.tipo).toBe('FB');
  });

  it('comprobante A: emite FA y corrige la cola ARCA (que nace como FB)', async () => {
    const fact = facturacionFalsa();
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    await svc.registrar({ ...dtoBase, comprobante: 'A', receptor: { docNumero: '20-1-9' } } as any);
    expect(fact.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'FA' }), undefined);
    expect(llamadas.updates).toContainEqual(['comprobantes_arca', { tipo: 'FA' }]);
  });

  it('comprobante R: emite remito y saca la venta de la cola ARCA (no es fiscal)', async () => {
    const fact = facturacionFalsa();
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    await svc.registrar({ ...dtoBase, comprobante: 'R' } as any);
    expect(fact.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'REM' }), undefined);
    expect(llamadas.deletes).toContain('comprobantes_arca');
  });

  it('si el comprobante falla, la venta NO se pierde (vuelve con comprobanteError)', async () => {
    const fact = facturacionFalsa();
    fact.emitir.mockRejectedValue(new BadRequestException('numerador roto'));
    const { svc } = servicio({ rpc: rpcVentaOk, tablas: tablasBase }, fact);
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B' } as any);
    expect(r.venta_id).toBe('v-1');
    expect(r.comprobante).toBeUndefined();
    expect(r.comprobanteError).toMatch(/numerador/);
  });

  it('reintento offline (duplicada): no vuelve a emitir comprobante', async () => {
    const fact = facturacionFalsa();
    const { svc } = servicio(
      { rpc: { registrar_venta: { venta_id: 'v-1', duplicada: true } }, tablas: tablasBase },
      fact,
    );
    const r = await svc.registrar({ ...dtoBase, comprobante: 'B', ventaId: 'v-1' } as any);
    expect(r.duplicada).toBe(true);
    expect(fact.emitir).not.toHaveBeenCalled();
  });

  it('descuento autorizado: viaja a la RPC con el autorizante', async () => {
    const { svc, llamadas } = servicio({ rpc: rpcVentaOk, tablas: tablasBase });
    await svc.registrar({ ...dtoBase, descuentoExtra: 10, autorizadoPor: 'sup-1' } as any);
    const [, args] = llamadas.rpc.find(([fn]) => fn === 'registrar_venta')!;
    expect(args.p_descuento_extra).toBe(10);
    expect(args.p_autorizado_por).toBe('sup-1');
  });
});
