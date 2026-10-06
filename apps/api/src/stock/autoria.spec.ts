import { StockService } from './stock.service';
import { StockController } from './stock.controller';

// Autoría en stock (6/10/2026):
//  - las transferencias entre sucursales quedaban sin autor: la API no le
//    pasaba el usuario a crear_transferencia ni a recibir_transferencia, así
//    que creada_por / recibida_por eran NULL siempre;
//  - al mandar una, le llega la campanita a depósito y gerencia de la
//    sucursal que la tiene que recibir;
//  - la pestaña Movimientos muestra quién hizo cada movimiento.

type Resp = { data?: any; error?: any };

function dbFalsa(opts: { tablas?: Record<string, Resp>; rpc?: Record<string, Resp> } = {}) {
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
        in: (c: string, v: any) => { op.filtros.push(['in', c, v]); return q; },
        is: (c: string, v: any) => { op.filtros.push(['is', c, v]); return q; },
        filter: (c: string, o: string, v: any) => { op.filtros.push(['filter', c, o, v]); return q; },
        gte: () => q, order: () => q, limit: () => q,
        maybeSingle: () => r('uno'), single: () => r('uno'),
        then: (ok: any, mal: any) => r('lista').then(ok, mal),
      };
      return q;
    }),
    rpc: jest.fn((nombre: string, args: any) => {
      ops.push({ rpc: nombre, args });
      const v = opts.rpc?.[nombre];
      return Promise.resolve({ data: v?.data ?? null, error: v?.error ?? null });
    }),
  };
  const avisos = () => ops.filter((o) => o.tabla === 'alertas_internas' && o.accion === 'insert').flatMap((o) => o.valores);
  return { db, ops, avisos };
}

const caja = {} as any;
const dto = { origenId: 's-canning', destinoId: 's-thomas', items: [{ sku: 'FER', cantidad: 6 }, { sku: 'COC', cantidad: 12 }] };

const tablasTransferencia = (gente: any[]) => ({
  'productos:uno': { data: { id: 'prod-1' } },
  'productos:lista': { data: [{ sku: 'FER', nombre: 'Fernet 750' }, { sku: 'COC', nombre: 'Coca 2,25' }] },
  'sucursales:lista': { data: [{ id: 's-canning', nombre: 'Canning' }, { id: 's-thomas', nombre: 'Saint Thomas' }] },
  'usuarios:lista': { data: gente },
  'usuarios:uno': { data: { nombre: 'Lucas' } },
});

describe('transferencias entre sucursales', () => {
  it('crear: la base recibe quién la manda (p_usuario_id)', async () => {
    const { db, ops } = dbFalsa({ tablas: tablasTransferencia([]), rpc: { crear_transferencia: { data: 't-1' } } });
    const r = await new StockService(db, caja).crearTransferencia(dto, 'u-lucas');
    expect(r).toEqual({ transferenciaId: 't-1' });
    expect(ops.find((o) => o.rpc === 'crear_transferencia').args).toMatchObject({ p_origen: 's-canning', p_destino: 's-thomas', p_usuario_id: 'u-lucas' });
  });

  it('crear: campanita a depósito y gerencia activos de la sucursal destino (no al que la mandó)', async () => {
    const { db, ops, avisos } = dbFalsa({
      tablas: tablasTransferencia([{ id: 'u-dep' }, { id: 'u-ger' }, { id: 'u-lucas' }]),
      rpc: { crear_transferencia: { data: 't-1' } },
    });
    await new StockService(db, caja).crearTransferencia(dto, 'u-lucas');
    const busqueda = ops.find((o) => o.tabla === 'usuarios' && o.filtros.some((f: any) => f[1] === 'sucursal_id'));
    expect(busqueda.filtros).toEqual(expect.arrayContaining([['eq', 'activo', true], ['eq', 'sucursal_id', 's-thomas'], ['in', 'rol', ['deposito', 'gerente']]]));
    expect(avisos().map((a: any) => a.para_usuario)).toEqual(['u-dep', 'u-ger']);
    expect(avisos()[0]).toMatchObject({
      tipo: 'transferencia',
      titulo: 'Mercadería en camino a Saint Thomas',
      referencia: { transferenciaId: 't-1', link: '/stock' },
    });
    expect(avisos()[0].detalle).toContain('Canning → Saint Thomas: Fernet 750 × 6, Coca 2,25 × 12. La mandó Lucas.');
  });

  it('crear: si en el destino no hay depósito ni gerente, el aviso va sin destinatario (lo ven los dueños)', async () => {
    const { db, avisos } = dbFalsa({ tablas: tablasTransferencia([]), rpc: { crear_transferencia: { data: 't-1' } } });
    await new StockService(db, caja).crearTransferencia(dto, 'u-lucas');
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].para_usuario).toBeNull();
  });

  it('crear: si el aviso falla, la transferencia ya hecha no se informa como error', async () => {
    const { db } = dbFalsa({
      tablas: { ...tablasTransferencia([]), 'alertas_internas:insert': { error: { message: 'caída' } } },
      rpc: { crear_transferencia: { data: 't-1' } },
    });
    await expect(new StockService(db, caja).crearTransferencia(dto, 'u-lucas')).resolves.toEqual({ transferenciaId: 't-1' });
  });

  it('recibir: la base recibe quién la recibió y el aviso de "en camino" se cierra solo', async () => {
    const { db, ops } = dbFalsa();
    await new StockService(db, caja).recibirTransferencia('t-1', 'u-dep');
    expect(ops).toContainEqual({ rpc: 'recibir_transferencia', args: { p_transferencia: 't-1', p_usuario_id: 'u-dep' } });
    const cierre = ops.find((o) => o.tabla === 'alertas_internas' && o.accion === 'update');
    expect(cierre.valores).toEqual({ leida_en: expect.any(String) });
    expect(cierre.filtros).toEqual([['eq', 'tipo', 'transferencia'], ['filter', 'referencia->>transferenciaId', 'eq', 't-1'], ['is', 'leida_en', null]]);
  });

  it('anular también cierra el aviso', async () => {
    const { db, ops } = dbFalsa();
    await new StockService(db, caja).anularTransferencia('t-1', 'se perdió', 'u-ger');
    expect(ops.some((o) => o.tabla === 'alertas_internas' && o.accion === 'update')).toBe(true);
  });

  it('el controlador pasa el usuario del token en las dos puntas', async () => {
    const stock = { crearTransferencia: jest.fn(), recibirTransferencia: jest.fn() } as any;
    const c = new StockController(stock);
    const req = { usuario: { sub: 'u-token', rol: 'deposito' } };
    c.transferencia(dto, req);
    c.recibir('t-1', req);
    expect(stock.crearTransferencia).toHaveBeenCalledWith(dto, 'u-token');
    expect(stock.recibirTransferencia).toHaveBeenCalledWith('t-1', 'u-token');
  });
});

describe('movimientos de stock', () => {
  it('traen quién hizo cada movimiento', async () => {
    const { db, ops } = dbFalsa({ tablas: { movimientos_stock: { data: [{ id: 1, usuario: { nombre: 'Lucas' } }] } } });
    const r = await new StockService(db, caja).movimientos({ limite: 10 });
    expect(r).toEqual([{ id: 1, usuario: { nombre: 'Lucas' } }]);
    expect(ops.find((o) => o.tabla === 'movimientos_stock').select).toContain('usuario:usuarios!movimientos_stock_usuario_id_fkey(nombre)');
  });

  it('las transferencias en curso dicen quién las mandó', async () => {
    const { db, ops } = dbFalsa();
    await new StockService(db, caja).transferenciasPendientes();
    expect(ops.find((o) => o.tabla === 'transferencias').select).toContain('creador:usuarios!transferencias_creada_por_fkey(nombre)');
  });
});
