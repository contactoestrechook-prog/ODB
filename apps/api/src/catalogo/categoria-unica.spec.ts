import { ProductosAdminService } from './productos-admin.service';

// 1/10/2026: había categorías repetidas que solo cambiaban en mayúsculas
// ("Quesos"/"quesos", "Lacteos"/"lacteos"). Con dos coincidencias, idCategoria
// no encontraba ninguna y creaba una tercera. Ahora usa la que tiene productos.

function dbCon(categorias: any[]) {
  const insertadas: any[] = [];
  const filtros: any[] = [];
  return {
    insertadas, filtros,
    from() {
      const b: any = {
        select: () => b,
        ilike: (_c: string, v: string) => (filtros.push(v), b),
        insert: (fila: any) => (insertadas.push(fila), b),
        single: async () => ({ data: { id: 'nueva' }, error: null }),
        then: (ok: any, err: any) => Promise.resolve({ data: categorias, error: null }).then(ok, err),
      };
      return b;
    },
  } as any;
}

const idCategoria = (db: any, nombre: string) => (new ProductosAdminService(db, {} as any) as any).idCategoria(nombre);

describe('idCategoria: una sola categoría por nombre', () => {
  it('con dos que coinciden sin mayúsculas, usa la que tiene productos y no crea otra', async () => {
    const db = dbCon([
      { id: 'vacia', nombre: 'Quesos', productos: [{ count: 0 }] },
      { id: 'buena', nombre: 'quesos', productos: [{ count: 284 }] },
    ]);
    expect(await idCategoria(db, 'Quesos')).toBe('buena');
    expect(db.insertadas).toHaveLength(0);
  });

  it('a igual cantidad, prefiere la escrita igual', async () => {
    const db = dbCon([
      { id: 'a', nombre: 'yerba', productos: [{ count: 0 }] },
      { id: 'b', nombre: 'Yerba', productos: [{ count: 0 }] },
    ]);
    expect(await idCategoria(db, 'Yerba')).toBe('b');
  });

  it('si no existe, la crea', async () => {
    const db = dbCon([]);
    expect(await idCategoria(db, 'Huevos y mas')).toBe('nueva');
    expect(db.insertadas[0]).toEqual({ nombre: 'Huevos y mas' });
  });

  it('un % o _ en el nombre no funciona como comodín', async () => {
    const db = dbCon([]);
    await idCategoria(db, 'Vinos_100%');
    expect(db.filtros[0]).toBe('Vinos\\_100\\%');
  });
});
