import { EventosService } from './eventos.service';
import { hoyBA } from './eventos.logica';
import { generarPresupuesto } from './presupuesto';

jest.mock('./presupuesto', () => ({ generarPresupuesto: jest.fn(async () => Buffer.from('pdf')) }));

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
  const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('si una fuente falla, las otras salen igual y se avisa cuál', async () => {
    const { db } = baseFalsa((ll) => {
      if (ll.tabla === 'eventos') return { data: [], error: null };
      if (ll.tabla === 'clientes' && op(ll, 'not')) return { data: null, error: { message: 'se cortó' } }; // los de fecha de nacimiento
      if (ll.tabla === 'clientes' && op(ll, 'is')) return { count: 6747, error: null }; // sin fecha de nacimiento
      if (ll.tabla === 'clientes' && op(ll, 'or')) {
        return { data: [{ id: 'a', nombre: 'Alfa', cuit: '30712345678', telefono: '1140315015' }, { id: 'p', nombre: 'Persona', cuit: '20301234567' }], error: null };
      }
      if (ll.tabla === 'clientes') return { data: [{ id: 'j', nombre: 'Joaquín', telefono: '1100000000' }], error: null };
      if (ll.tabla === 'pedidos' && op(ll, 'in')) return { data: [{ cliente_id: 'a', total: 300000, creado_en: haceDias(30) }], error: null };
      if (ll.tabla === 'pedidos' && op(ll, 'not')) return { data: [{ cliente_id: 'j', total: 400000, creado_en: new Date().toISOString(), estado: 'entregado' }], error: null };
      if (ll.tabla === 'pedidos') return { data: [{ cliente_id: 'j', total: 400000, creado_en: new Date().toISOString(), estado: 'entregado' }], error: null };
      return { data: [], error: null };
    });
    const r: any = await new EventosService(db, {} as any).oportunidades(60);
    expect(r.avisos).toEqual(['cumpleaños']);
    expect(r.cumpleanos).toEqual({ dias: 60, lista: [], sinFecha: 6747 });
    expect(r.empresas.lista.map((e: any) => [e.cliente_id, e.total])).toEqual([['a', 300000]]);
    // un solo ticket: umbral fijo de $100.000, y Joaquín lo pasa
    expect(r.comprasGrandes.umbral).toBe(100000);
    expect(r.comprasGrandes.regla).toBe('piso');
    expect(r.comprasGrandes.lista).toMatchObject([{ cliente_id: 'j', total: 400000, estado: 'entregado', nombre: 'Joaquín', telefono: '1100000000' }]);
  });

  it('compras grandes: solo pedidos que avanzaron (un "recibido" que nadie tomó no es una compra)', async () => {
    const { db, llamadas } = baseFalsa(() => ({ data: [], error: null, count: 0 }));
    await new EventosService(db, {} as any).oportunidades(60);
    const pedidos = llamadas.filter((l) => l.tabla === 'pedidos' && !op(l, 'in'));
    expect(pedidos).toHaveLength(2);
    for (const l of pedidos) {
      expect(op(l, 'neq')).toEqual(['estado', 'cancelado']);
      expect(op(l, 'or')![0]).toBe('estado.in.(pagado,en_preparacion,listo,en_camino,entregado),tomado_en.not.is.null');
    }
  });

  it('cumpleaños: el que cumple hoy sale con 0 días (la cuenta es en Buenos Aires, no en la base)', async () => {
    const hoy = hoyBA();
    const { db } = baseFalsa((ll) => {
      if (ll.tabla === 'clientes' && op(ll, 'not')) {
        return { data: [{ id: 'hoy', nombre: 'Ana', dni: '1', fecha_nacimiento: `1996-${hoy.slice(5)}` }], error: null };
      }
      if (ll.tabla === 'eventos') return { data: [{ id: 'ev9', cliente_id: 'hoy', tipo: 'cumpleanos', estado: 'cancelado', fecha: hoy, creado_en: new Date().toISOString() }], error: null };
      return { data: [], error: null, count: 0 };
    });
    const r: any = await new EventosService(db, {} as any).oportunidades(60);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(r.cumpleanos.lista).toEqual([{ cliente_id: 'hoy', nombre: 'Ana', dni: '1', dias: 0, fecha: hoy, evento_id: 'ev9', evento_estado: 'cancelado' }]);
  });

  it('fin de año: entra la empresa que escribió por WhatsApp (con el LID traducido), no la que solo tiene CUIT', async () => {
    const { db, llamadas } = baseFalsa((ll) => {
      if (ll.tabla === 'clientes' && op(ll, 'or')) {
        return {
          data: [
            { id: 'charla', nombre: 'Estudio Charla', cuit: '30712345678', telefono: '11 4031-5015' },
            { id: 'nada', nombre: 'St Thomas 678', cuit: '30701810925', telefono: '15' },
          ],
          error: null,
        };
      }
      if (ll.tabla === 'bot_conversaciones') return { data: [{ linea: 'pedidos', telefono: '105295468564733' }], error: null };
      if (ll.tabla === 'bot_contactos') return { data: [{ telefono: '105295468564733', telefono_real: '5491140315015' }], error: null };
      return { data: [], error: null, count: 0 };
    });
    const r: any = await new EventosService(db, {} as any).oportunidades(60);
    expect(r.empresas.lista.map((e: any) => e.cliente_id)).toEqual(['charla']);
    expect(r.empresas.sinRelacion).toBe(1);
    // los clientes empresa vienen enteros, de a mil
    const clientes = llamadas.find((l) => l.tabla === 'clientes' && op(l, 'or'))!;
    expect(op(clientes, 'range')).toEqual([0, 999]);
    expect(op(clientes, 'limit')).toBeUndefined();
  });
});

describe('EventosService.listar', () => {
  it('todos los abiertos y los cerrados del último año, por fecha y los sin fecha al final', async () => {
    const { db, llamadas } = baseFalsa((ll) => {
      const estados = op(ll, 'in')?.[1] as string[];
      if (estados?.includes('prospecto')) {
        return {
          data: [
            { id: 'sin-fecha', estado: 'prospecto', fecha: null, cliente: { nombre: 'Ana', expo_push_token: 'ExponentPushToken[x]' } },
            { id: 'pronto', estado: 'confirmado', fecha: '2026-11-02', cliente: null },
          ],
          error: null,
        };
      }
      return { data: [{ id: 'hecho', estado: 'realizado', fecha: '2026-09-01', cliente: { nombre: 'Leo', expo_push_token: null } }], error: null };
    });
    const r: any[] = await new EventosService(db, {} as any).listar({});
    expect(r.map((e) => e.id)).toEqual(['hecho', 'pronto', 'sin-fecha']);
    // el token del celular no sale del API: solo si tiene la app
    expect(r[2].cliente).toEqual({ nombre: 'Ana', tiene_app: true });
    expect(r[0].cliente).toEqual({ nombre: 'Leo', tiene_app: false });
    const cerrados = llamadas.find((l) => (op(l, 'in')?.[1] as string[])?.includes('realizado'))!;
    expect(op(cerrados, 'or')![0]).toMatch(/^fecha\.gte\.\d{4}-\d{2}-\d{2},creado_en\.gte\.\d{4}-\d{2}-\d{2}$/);
    expect(llamadas.every((l) => !op(l, 'limit'))).toBe(true);
  });
});

describe('EventosService.guardarPropuesta', () => {
  it('guarda productos con el precio cambiado y renglones libres, y pasa a Propuesta', async () => {
    const { db, llamadas } = baseFalsa((ll) => {
      if (op(ll, 'maybeSingle')) return { data: { estado: 'prospecto' }, error: null };
      return { error: null };
    });
    const r = await new EventosService(db, {} as any).guardarPropuesta('ev1', [
      { producto_id: '15d903fb-a239-41d8-afad-e5cda56ad30d', descripcion: 'Espumante', cantidad: 10, precio_unitario: 9000 },
      { producto_id: null, descripcion: 'Servicio de barra', cantidad: 1, precio_unitario: 200000 },
      { descripcion: '', cantidad: 3, precio_unitario: 100 },
    ]);
    expect(r).toEqual({ total: 290000, items: 2 });
    const alta = op(llamadas.find((l) => l.tabla === 'eventos_items' && op(l, 'insert'))!, 'insert')![0];
    expect(alta).toEqual([
      { evento_id: 'ev1', producto_id: '15d903fb-a239-41d8-afad-e5cda56ad30d', descripcion: 'Espumante', cantidad: 10, precio_unitario: 9000 },
      { evento_id: 'ev1', producto_id: null, descripcion: 'Servicio de barra', cantidad: 1, precio_unitario: 200000 },
    ]);
    expect(op(llamadas.find((l) => l.tabla === 'eventos' && op(l, 'update'))!, 'update')![0]).toMatchObject({ presupuesto: 290000, estado: 'propuesta' });
  });

  it('un precio negativo no llega a la base (ni borra lo que había)', async () => {
    const { db, llamadas } = baseFalsa(() => ({ data: null, error: null }));
    await expect(new EventosService(db, {} as any).guardarPropuesta('ev1', [{ descripcion: 'Vino', cantidad: 1, precio_unitario: -5 }])).rejects.toThrow('El precio de «Vino» no es válido.');
    expect(llamadas).toHaveLength(0);
  });
});

describe('EventosService.enviarPropuesta', () => {
  const conEvento = (cliente_id: string | null, items: any[]) =>
    baseFalsa((ll) => {
      if (ll.tabla === 'eventos_items') return { data: items, error: null };
      if (op(ll, 'update')) return { error: null };
      return { data: { id: 'ev1', cliente_id, nombre: 'Cumpleaños de Ana', estado: 'propuesta', cliente: null }, error: null };
    });

  it('dice si le llegó al celular o si quedó solo como aviso en la app', async () => {
    const { db } = conEvento('cli1', [{ cantidad: 2, precio_unitario: 1000 }]);
    const notificar = { aCliente: jest.fn(async () => ({ push: false })) };
    expect(await new EventosService(db, notificar as any).enviarPropuesta('ev1')).toEqual({ ok: true, total: 2000, push: false });
    expect(notificar.aCliente).toHaveBeenCalledWith('cli1', expect.any(String), expect.stringContaining('$2.000'), 'evento');
  });

  it('sin productos guardados no avisa nada', async () => {
    const { db } = conEvento('cli1', []);
    const notificar = { aCliente: jest.fn() };
    await expect(new EventosService(db, notificar as any).enviarPropuesta('ev1')).rejects.toThrow(/no tiene productos/);
    expect(notificar.aCliente).not.toHaveBeenCalled();
  });
});

describe('EventosService.eliminar', () => {
  it('borra el evento (los renglones se van en cascada)', async () => {
    const { db, llamadas } = baseFalsa(() => ({ data: [{ id: 'ev1' }], error: null }));
    expect(await new EventosService(db, {} as any).eliminar('ev1')).toEqual({ ok: true });
    expect(op(llamadas[0], 'delete')).toEqual([]);
    expect(op(llamadas[0], 'eq')).toEqual(['id', 'ev1']);
  });

  it('si no existe, lo dice', async () => {
    const { db } = baseFalsa(() => ({ data: [], error: null }));
    await expect(new EventosService(db, {} as any).eliminar('ev1')).rejects.toThrow('No existe el evento');
  });
});

describe('EventosService.presupuestoPdf', () => {
  afterEach(() => jest.useRealTimers());

  it('la fecha del presupuesto es la de Buenos Aires (a las 22:30 del 21/10 en Londres ya es 22)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T01:30:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const { db } = baseFalsa((ll) =>
      ll.tabla === 'eventos_items' ? { data: [], error: null } : { data: { id: 'ev1', nombre: 'X', tipo: 'otro', cliente: null }, error: null },
    );
    await new EventosService(db, {} as any).presupuestoPdf('ev1');
    expect((generarPresupuesto as jest.Mock).mock.calls[0][0].fecha).toBe('21 de octubre de 2026');
  });
});
