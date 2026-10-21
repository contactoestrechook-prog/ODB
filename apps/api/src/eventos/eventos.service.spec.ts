import { EventosService } from './eventos.service';

// Una base falsa que anota cada consulta (tabla + operaciones encadenadas) y
// contesta lo que diga `responder`. Alcanza para ver qué le pide el servicio a
// Supabase sin tocar la base de verdad.
type Llamada = { tabla: string; ops: [string, any[]][] };
const op = (ll: Llamada, nombre: string) => ll.ops.find(([n]) => n === nombre)?.[1];

function baseFalsa(responder: (ll: Llamada) => any, rpc: (nombre: string, args: any) => any = () => ({ data: null, error: null })) {
  const llamadas: Llamada[] = [];
  const db: any = {
    from(tabla: string) {
      const ll: Llamada = { tabla, ops: [] };
      llamadas.push(ll);
      const b: any = new Proxy(
        {},
        {
          get(_, prop: string) {
            if (prop === 'then') {
              const r = Promise.resolve().then(() => responder(ll));
              return (ok: any, ko: any) => r.then(ok, ko);
            }
            return (...args: any[]) => {
              ll.ops.push([prop, args]);
              return b;
            };
          },
        },
      );
      return b;
    },
    rpc: jest.fn(async (nombre: string, args: any) => rpc(nombre, args)),
  };
  return { db, llamadas };
}

describe('EventosService.crear', () => {
  it('contacto nuevo: lo busca o da de alta por WhatsApp y sugiere el nombre', async () => {
    const { db, llamadas } = baseFalsa(
      (ll) => (ll.tabla === 'eventos' ? { data: { id: 'ev1' }, error: null } : { data: null, error: null }),
      () => ({ data: 'cli-ana', error: null }),
    );
    const s = new EventosService(db, {} as any);
    const r = await s.crear({ tipo: 'casamiento', contacto_nombre: 'Ana Pérez', contacto_telefono: '11 2281-2200', fecha: '2026-12-12', invitados: '120' }, 'usr1');
    expect(r).toEqual({ id: 'ev1' });
    expect(db.rpc).toHaveBeenCalledWith('cliente_de_contacto', { p_telefono: '1122812200', p_nombre: 'Ana Pérez' });
    const alta = op(llamadas.find((l) => l.tabla === 'eventos')!, 'insert')![0];
    expect(alta).toMatchObject({
      cliente_id: 'cli-ana',
      nombre: 'Casamiento de Ana',
      tipo: 'casamiento',
      estado: 'prospecto',
      fecha: '2026-12-12',
      invitados: 120,
      contacto_telefono: '1122812200',
      origen: 'manual',
      creado_por: 'usr1',
    });
  });

  it('sin la migración: reintenta con el lugar y el contacto en las notas', async () => {
    let altas = 0;
    const { db, llamadas } = baseFalsa((ll) => {
      if (ll.tabla !== 'eventos') return { data: null, error: null };
      altas += 1;
      return altas === 1
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'lugar' column of 'eventos' in the schema cache" } }
        : { data: { id: 'ev2' }, error: null };
    });
    const s = new EventosService(db, {} as any);
    await s.crear({ tipo: 'otro', nombre: 'Bautismo de Tomás', lugar: 'Quinta Los Robles', notas: 'Sin alcohol para chicos' });
    const segunda = op(llamadas.filter((l) => l.tabla === 'eventos')[1], 'insert')![0];
    expect(segunda.lugar).toBeUndefined();
    expect(segunda.origen).toBeUndefined();
    expect(segunda.notas).toBe('Sin alcohol para chicos\nLugar: Quinta Los Robles');
    expect(segunda.nombre).toBe('Bautismo de Tomás');
  });

  it('cliente elegido que no existe: error claro', async () => {
    const { db } = baseFalsa(() => ({ data: null, error: null }));
    const s = new EventosService(db, {} as any);
    await expect(s.crear({ tipo: 'cumpleanos', clienteId: '15d903fb-a239-41d8-afad-e5cda56ad30d' })).rejects.toThrow('No encontré ese cliente.');
  });

  it('datos inválidos: no llega a la base', async () => {
    const { db, llamadas } = baseFalsa(() => ({ data: null, error: null }));
    const s = new EventosService(db, {} as any);
    await expect(s.crear({ tipo: 'casamiento', fecha: '31/12/2026' })).rejects.toThrow('La fecha no es válida.');
    expect(llamadas).toHaveLength(0);
  });
});

describe('EventosService.actualizar', () => {
  it('cancelar con motivo lo deja en las notas', async () => {
    const { db, llamadas } = baseFalsa((ll) => {
      if (ll.tabla === 'eventos_items') return { data: [], error: null };
      if (op(ll, 'update')) return { error: null };
      if (op(ll, 'maybeSingle')) return { data: { notas: 'Quiere espumante' }, error: null };
      return { data: { id: 'ev1', estado: 'cancelado' }, error: null };
    });
    const s = new EventosService(db, {} as any);
    const r = await s.actualizar('ev1', { estado: 'cancelado', motivo: 'eligió otro proveedor' });
    expect(r).toEqual({ id: 'ev1', estado: 'cancelado', items: [] });
    const cambio = op(llamadas.find((l) => op(l, 'update'))!, 'update')![0];
    expect(cambio.estado).toBe('cancelado');
    expect(cambio.notas).toMatch(/^Quiere espumante\nCancelado el \d{2}\/\d{2}\/\d{4}: eligió otro proveedor$/);
  });

  it('una etapa inventada se rechaza', async () => {
    const { db } = baseFalsa(() => ({ data: null, error: null }));
    await expect(new EventosService(db, {} as any).actualizar('ev1', { estado: 'ganado' })).rejects.toThrow('La etapa del evento no es válida.');
  });
});

describe('EventosService.oportunidades', () => {
  it('si una fuente falla, las otras salen igual y se avisa cuál', async () => {
    const { db } = baseFalsa(
      (ll) => {
        if (ll.tabla === 'eventos') return { data: [], error: null };
        if (ll.tabla === 'clientes' && op(ll, 'is')) return { count: 6747, error: null }; // sin fecha de nacimiento
        if (ll.tabla === 'clientes' && op(ll, 'or')) {
          return { data: [{ id: 'a', nombre: 'Alfa', cuit: '30712345678' }, { id: 'p', nombre: 'Persona', cuit: '20301234567' }], error: null };
        }
        if (ll.tabla === 'clientes') return { data: [{ id: 'j', nombre: 'Joaquín', telefono: '1100000000' }], error: null };
        if (ll.tabla === 'pedidos' && op(ll, 'in')) return { data: [{ cliente_id: 'a', total: 300000, creado_en: new Date(Date.now() - 30 * 86_400_000).toISOString() }], error: null };
        if (ll.tabla === 'pedidos' && op(ll, 'not')) return { data: [{ cliente_id: 'j', total: 400000, creado_en: new Date().toISOString() }], error: null };
        if (ll.tabla === 'pedidos') return { data: [{ cliente_id: 'j', total: 400000, creado_en: new Date().toISOString() }], error: null };
        return { data: [], error: null };
      },
      () => ({ data: null, error: { message: 'función caída' } }),
    );
    const r: any = await new EventosService(db, {} as any).oportunidades(60);
    expect(r.avisos).toEqual(['cumpleaños']);
    expect(r.cumpleanos).toEqual({ dias: 60, lista: [], sinFecha: 6747 });
    expect(r.empresas.lista.map((e: any) => [e.cliente_id, e.total])).toEqual([['a', 300000]]);
    // un solo ticket: umbral fijo de $150.000, y Joaquín lo pasa
    expect(r.comprasGrandes.umbral).toBe(150000);
    expect(r.comprasGrandes.lista).toMatchObject([{ cliente_id: 'j', total: 400000, nombre: 'Joaquín', telefono: '1100000000' }]);
  });
});
