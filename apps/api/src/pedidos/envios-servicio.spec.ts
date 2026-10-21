import { BadRequestException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';

// Envíos a domicilio (Leandro, 21/10/2026): quién lo lleva, cómo se cobra y el
// cierre de los envíos viejos. Una base de mentira que recuerda lo que se
// escribió (el pedido cambia con cada update, como en la de verdad).

type Usuario = { id: string; nombre: string; rol: string; activo?: boolean | null; telefono?: string | null };

function armar({ pedido, usuarios = [], rpcs = {} }: { pedido: any; usuarios?: Usuario[]; rpcs?: Record<string, any> }) {
  const updates: { tabla: string; valores: any }[] = [];
  const llamadas: { name: string; args: any }[] = [];
  const db: any = {
    from: (tabla: string) => {
      const filtros: Record<string, any> = {};
      let valores: any = null;
      const datos = () => {
        if (tabla === 'pedidos') return pedido;
        if (tabla === 'usuarios') return filtros.id ? usuarios.find((u) => u.id === filtros.id) ?? null : usuarios;
        return null;
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filtros[c] = v; return q; },
        in: () => q,
        order: () => q,
        limit: () => q,
        update: (v: any) => { valores = v; updates.push({ tabla, valores: v }); return q; },
        maybeSingle: () => Promise.resolve({ data: datos(), error: null }),
        single: () => Promise.resolve({ data: datos(), error: null }),
        then: (ok: any, mal: any) => {
          if (valores) {
            // el update condicionado al estado leído: si no coincide, no toca nada
            const coincide = !('estado' in filtros) || pedido.estado === filtros.estado;
            if (tabla === 'pedidos' && coincide) Object.assign(pedido, valores);
            return Promise.resolve({ data: coincide ? [{ id: pedido.id }] : [], error: null }).then(ok, mal);
          }
          const d = datos();
          return Promise.resolve({ data: Array.isArray(d) ? d : d ? [d] : [], error: null }).then(ok, mal);
        },
      };
      return q;
    },
    rpc: (name: string, args: any) => {
      llamadas.push({ name, args });
      const r = rpcs[name] ?? (name === 'faltantes_pedido' ? { data: [], error: null } : name === 'entregar_pedido' ? { data: { venta: { venta_id: 'v-1' } }, error: null } : { data: null, error: null });
      return Object.assign(Promise.resolve(r), { maybeSingle: () => Promise.resolve(r) });
    },
  };
  const svc = new PedidosService(db, { aCliente: jest.fn() } as any);
  return { svc, updates, llamadas, pedido };
}

const envio = (extra: any = {}) => ({
  id: 'p-1', canal: 'domicilio', estado: 'listo', sucursal_id: 'suc-1', qr_retiro: 'DOM-1', repartidor_id: null, forma_pago: null,
  pagado_en: null, items: [], cliente: { telefono: null }, ...extra,
});
const RUBEN: Usuario = { id: 'u-rep', nombre: 'Rubén', rol: 'repartidor', activo: true };
const ANA: Usuario = { id: 'u-caj', nombre: 'Ana', rol: 'cajero', activo: true };
const VIEJO: Usuario = { id: 'u-baja', nombre: 'Carlos', rol: 'repartidor', activo: false };

// el servicio crea su cliente de Anthropic al nacer: sin clave, el SDK la sale a buscar
process.env.ANTHROPIC_API_KEY ??= 'test';

describe('quién lleva el envío', () => {
  it('la lista separa repartidores activos y gente del local; los dados de baja no aparecen', async () => {
    const { svc } = armar({ pedido: envio(), usuarios: [RUBEN, ANA, VIEJO, { id: 'u-d', nombre: 'Leandro', rol: 'dueno', activo: null }] });
    const r = await svc.quienLleva();
    expect(r.repartidores).toEqual([{ id: 'u-rep', nombre: 'Rubén', telefono: null }]);
    expect(r.delLocal.map((u) => u.nombre)).toEqual(['Ana', 'Leandro']);
  });

  it('asignar a alguien activo del equipo guarda quién y devuelve su nombre', async () => {
    const { svc, updates } = armar({ pedido: envio({ estado: 'recibido' }), usuarios: [ANA] });
    await expect(svc.asignarRepartidor('p-1', 'u-caj', 'u-quien')).resolves.toEqual({ ok: true, repartidor: { id: 'u-caj', nombre: 'Ana' } });
    expect(updates[0].valores).toMatchObject({ repartidor_id: 'u-caj', cambio_por: 'u-quien' });
  });

  it('no se asigna a alguien dado de baja ni a quien no es del equipo', async () => {
    const { svc } = armar({ pedido: envio(), usuarios: [VIEJO] });
    await expect(svc.asignarRepartidor('p-1', 'u-baja')).rejects.toThrow(/dada de baja/);
    await expect(svc.asignarRepartidor('p-1', 'u-nadie')).rejects.toThrow(/no es del equipo/);
  });

  it('no se cambia el repartidor de un pedido cerrado ni de uno que no es a domicilio', async () => {
    await expect(armar({ pedido: envio({ estado: 'entregado' }), usuarios: [RUBEN] }).svc.asignarRepartidor('p-1', 'u-rep')).rejects.toThrow(/cerrado/);
    await expect(armar({ pedido: envio({ canal: 'pickup' }), usuarios: [RUBEN] }).svc.asignarRepartidor('p-1', 'u-rep')).rejects.toThrow(/domicilio/);
  });

  it('se le puede sacar el repartidor, salvo que ya esté en la calle', async () => {
    const { svc, updates } = armar({ pedido: envio({ repartidor_id: 'u-rep' }) });
    await expect(svc.asignarRepartidor('p-1', null)).resolves.toEqual({ ok: true, repartidor: null });
    expect(updates[0].valores.repartidor_id).toBeNull();
    await expect(armar({ pedido: envio({ estado: 'en_camino', repartidor_id: 'u-rep' }) }).svc.asignarRepartidor('p-1', '')).rejects.toThrow(/en la calle/);
  });
});

describe('despachar: un envío no sale sin alguien que lo lleve', () => {
  it('sin repartidor, no sale (y la pantalla sabe por qué)', async () => {
    const { svc, updates } = armar({ pedido: envio() });
    const error = await svc.avanzar('p-1', 'en_camino', 'u-quien').catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ codigo: 'FALTA_REPARTIDOR' });
    expect(updates).toHaveLength(0);
  });

  it('eligiendo quién lo lleva en el momento, sale con esa persona', async () => {
    const { svc, pedido } = armar({ pedido: envio(), usuarios: [ANA] });
    await svc.avanzar('p-1', 'en_camino', 'u-quien', undefined, { repartidorId: 'u-caj' });
    expect(pedido).toMatchObject({ estado: 'en_camino', repartidor_id: 'u-caj' });
  });

  it('con repartidor ya asignado sale como siempre', async () => {
    const { svc, pedido } = armar({ pedido: envio({ repartidor_id: 'u-rep' }) });
    await svc.avanzar('p-1', 'en_camino');
    expect(pedido.estado).toBe('en_camino');
  });

  it('un retiro en el local no pide repartidor', async () => {
    const { svc } = armar({ pedido: envio({ canal: 'pickup', estado: 'listo' }) });
    await expect(svc.avanzar('p-1', 'entregado', undefined, 'efectivo')).resolves.toMatchObject({ estado: 'entregado' });
  });
});

describe('entregar: cómo se cobró', () => {
  it('si nadie eligió el medio, va el que dijo el cliente (antes quedaba efectivo)', async () => {
    const { svc, llamadas } = armar({ pedido: envio({ estado: 'en_camino', repartidor_id: 'u-rep', forma_pago: 'transferencia' }) });
    await svc.avanzar('p-1', 'entregado', 'u-quien');
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args).toMatchObject({ p_medio: 'transferencia' });
  });

  it('lo que se elige en la puerta manda sobre lo que dijo', async () => {
    const { svc, llamadas } = armar({ pedido: envio({ estado: 'en_camino', repartidor_id: 'u-rep', forma_pago: 'transferencia' }) });
    await svc.avanzar('p-1', 'entregado', 'u-quien', 'efectivo');
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args.p_medio).toBe('efectivo');
  });

  it('cuenta corriente o Mercado Pago sin pago no se inventan: la base decide como antes', async () => {
    const { svc, llamadas } = armar({ pedido: envio({ estado: 'en_camino', repartidor_id: 'u-rep', forma_pago: 'cuenta_corriente' }) });
    await svc.avanzar('p-1', 'entregado');
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args.p_medio).toBeNull();
  });
});

describe('«¿Se entregó o se cancela?» → se entregó', () => {
  it('un envío viejo en «Recibido» queda listo y se entrega, sin WhatsApp al cliente', async () => {
    const { svc, pedido, llamadas, updates } = armar({ pedido: envio({ estado: 'recibido', forma_pago: 'efectivo', cliente: { telefono: '5491122223333' } }) });
    const avisar = jest.spyOn(svc as any, 'notificarWhatsApp');
    await svc.seEntrego('p-1', 'u-quien');
    expect(updates[0].valores).toMatchObject({ estado: 'listo', preparado_por: 'u-quien', cambio_por: 'u-quien' });
    expect(pedido.estado).toBe('listo'); // el «entregado» lo pone la base (entregar_pedido)
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args).toMatchObject({ p_pedido: 'p-1', p_usuario: 'u-quien', p_medio: 'efectivo' });
    expect(avisar).not.toHaveBeenCalled();
  });

  it('si estaba en la calle, se entrega directo', async () => {
    const { svc, updates, llamadas } = armar({ pedido: envio({ estado: 'en_camino' }) });
    await svc.seEntrego('p-1', 'u-quien', 'tarjeta');
    expect(updates).toHaveLength(0);
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args.p_medio).toBe('tarjeta');
  });

  it('si falta stock, frena igual que siempre (la ventana de faltantes)', async () => {
    const { svc } = armar({
      pedido: envio({ estado: 'recibido' }),
      rpcs: { faltantes_pedido: { data: [{ producto_id: 'x', sku: 'S', nombre: 'Agua', pide: 3, hay: 0 }], error: null } },
    });
    await expect(svc.seEntrego('p-1')).rejects.toMatchObject({ status: 409 });
  });

  it('solo para envíos a domicilio y abiertos', async () => {
    await expect(armar({ pedido: envio({ canal: 'pickup' }) }).svc.seEntrego('p-1')).rejects.toThrow(/domicilio/);
    await expect(armar({ pedido: envio({ estado: 'cancelado' }) }).svc.seEntrego('p-1')).rejects.toThrow(/cerrado/);
  });
});
