import { SalonService } from './salon.service';

// CADA PEDIDO, AL CELULAR DE QUIEN LO ARMA (Leandro, 16/11/2026): al asignarlo se
// encola el aviso pedido_asignado; uno por pedido, rearmado si se reasigna.

function base(previo: any) {
  const escrituras: { op: string; fila: any }[] = [];
  const q: any = {
    select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: previo, error: null }),
    insert: (fila: any) => { escrituras.push({ op: 'insert', fila }); return Promise.resolve({ error: null }); },
    update: (fila: any) => { escrituras.push({ op: 'update', fila }); return { eq: async () => ({ error: null }) }; },
  };
  return { db: { from: () => q } as any, escrituras };
}
const salon = (db: any) => new SalonService(db, {} as any, {} as any);

describe('el aviso a quien arma el pedido', () => {
  it('la primera vez se encola con quién es', async () => {
    const { db, escrituras } = base(null);
    await salon(db).encolarAvisoAsignado('p-1', 'u-alexis', 'Alexis luna');
    expect(escrituras).toEqual([{ op: 'insert', fila: { pedido_id: 'p-1', tipo: 'pedido_asignado', detalle: { usuario_id: 'u-alexis', nombre: 'Alexis luna' } } }]);
  });

  it('a la misma persona no se le repite', async () => {
    const { db, escrituras } = base({ id: 'a-1', detalle: { usuario_id: 'u-alexis' } });
    await salon(db).encolarAvisoAsignado('p-1', 'u-alexis', 'Alexis luna');
    expect(escrituras).toEqual([]);
  });

  it('si se reasigna, el mismo aviso vuelve a salir para la persona nueva', async () => {
    const { db, escrituras } = base({ id: 'a-1', detalle: { usuario_id: 'u-alexis' } });
    await salon(db).encolarAvisoAsignado('p-1', 'u-milagros', 'Milagros Ayelen Gonzalez');
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].fila).toMatchObject({ estado: 'pendiente', intentos: 0, enviado_en: null, waha_ids: [], detalle: { usuario_id: 'u-milagros', nombre: 'Milagros Ayelen Gonzalez' } });
  });
});
