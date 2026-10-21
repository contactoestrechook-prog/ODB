import { BadRequestException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';

// Envíos a domicilio (Leandro, 21/10/2026): quién lo lleva, cómo se cobra y el
// cierre de los envíos viejos. Una base de mentira que recuerda lo que se
// escribió (el pedido cambia con cada update, como en la de verdad).

type Usuario = { id: string; nombre: string; rol: string; activo?: boolean | null; telefono?: string | null };

function armar({ pedido, usuarios = [], rpcs = {}, cajasAbiertas = 0 }: { pedido: any; usuarios?: Usuario[]; rpcs?: Record<string, any>; cajasAbiertas?: number }) {
  const updates: { tabla: string; valores: any }[] = [];
  const llamadas: { name: string; args: any }[] = [];
  const inserts: { tabla: string; valores: any }[] = [];
  const db: any = {
    from: (tabla: string) => {
      const filtros: Record<string, any> = {};
      let valores: any = null;
      const datos = () => {
        if (tabla === 'pedidos') return pedido;
        if (tabla === 'usuarios') return filtros.id ? usuarios.find((u) => u.id === filtros.id) ?? null : usuarios;
        if (tabla === 'sesiones_caja') return Array.from({ length: cajasAbiertas }, (_, i) => ({ id: `ses-${i}` }));
        return null;
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filtros[c] = v; return q; },
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        update: (v: any) => { valores = v; updates.push({ tabla, valores: v }); return q; },
        insert: (v: any) => { inserts.push({ tabla, valores: v }); return Promise.resolve({ data: null, error: null }); },
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
  return { svc, updates, llamadas, inserts, pedido };
}

const envio = (extra: any = {}) => ({
  id: 'p-1', canal: 'domicilio', estado: 'listo', sucursal_id: 'suc-1', qr_retiro: 'DOM-1', repartidor_id: null, forma_pago: null,
  pagado_en: null, items: [], cliente: { telefono: null }, ...extra,
});
const RUBEN: Usuario = { id: 'u-rep', nombre: 'Rubén', rol: 'repartidor', activo: true };
const ANA: Usuario = { id: 'u-caj', nombre: 'Ana', rol: 'cajero', activo: true };
const VIEJO: Usuario = { id: 'u-baja', nombre: 'Carlos', rol: 'repartidor', activo: false };
const MARTA: Usuario = { id: 'u-adm', nombre: 'Marta', rol: 'administrativo', activo: true };

// un envío del bot que entró hace 11 días y nadie movió (DOM-EFB1F49E3E30)
const HACE_11_DIAS = new Date(Date.now() - 11 * 86_400_000).toISOString();
const atrasado = (extra: any = {}) => envio({ estado: 'recibido', creado_en: HACE_11_DIAS, ...extra });

// el servicio crea su cliente de Anthropic al nacer: sin clave, el SDK la sale a buscar
process.env.ANTHROPIC_API_KEY ??= 'test';

describe('quién lleva el envío', () => {
  it('la lista separa repartidores activos y gente del local; los dados de baja no aparecen', async () => {
    const { svc } = armar({ pedido: envio(), usuarios: [RUBEN, ANA, VIEJO, { id: 'u-d', nombre: 'Leandro', rol: 'dueno', activo: null }] });
    const r = await svc.quienLleva();
    expect(r.repartidores).toEqual([{ id: 'u-rep', nombre: 'Rubén', telefono: null }]);
    expect(r.delLocal.map((u) => u.nombre)).toEqual(['Ana', 'Leandro']);
  });

  it('del local solo aparece quien después tiene «Mis entregas» y lo puede cerrar (no administración)', async () => {
    const { svc } = armar({ pedido: envio(), usuarios: [ANA, MARTA] });
    expect((await svc.quienLleva()).delLocal.map((u) => u.nombre)).toEqual(['Ana']);
    await expect(svc.asignarRepartidor('p-1', 'u-adm')).rejects.toThrow(/Mis entregas/);
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

  it('un retiro en el local no pide repartidor y, listo, se entrega directo', async () => {
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

describe('entregar un envío: después de salir', () => {
  it('un envío «listo» no se entrega desde Depósito o Pedidos: tiene que salir con alguien', async () => {
    const { svc, llamadas } = armar({ pedido: envio({ estado: 'listo', forma_pago: 'efectivo' }) });
    const error = await svc.avanzar('p-1', 'entregado', 'u-quien').catch((e) => e);
    expect((error as BadRequestException).getResponse()).toMatchObject({ codigo: 'ENVIO_SIN_SALIR' });
    expect(llamadas.find((l) => l.name === 'entregar_pedido')).toBeUndefined();
  });

  it('en la calle se entrega como siempre', async () => {
    const { svc } = armar({ pedido: envio({ estado: 'en_camino', repartidor_id: 'u-rep', forma_pago: 'tarjeta' }) });
    await expect(svc.avanzar('p-1', 'entregado', 'u-quien')).resolves.toMatchObject({ estado: 'entregado' });
  });
});

describe('«¿Se entregó o se cancela?» → se entregó', () => {
  it('un envío viejo en «Recibido» queda listo y se entrega, sin WhatsApp al cliente', async () => {
    const { svc, pedido, llamadas, updates } = armar({ pedido: atrasado({ forma_pago: 'transferencia', cliente: { telefono: '5491122223333' } }) });
    const avisar = jest.spyOn(svc as any, 'notificarWhatsApp');
    await svc.seEntrego('p-1', 'u-quien', 'transferencia');
    expect(updates[0].valores).toMatchObject({ estado: 'listo', preparado_por: 'u-quien', cambio_por: 'u-quien' });
    expect(pedido.estado).toBe('listo'); // el «entregado» lo pone la base (entregar_pedido)
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args).toMatchObject({ p_pedido: 'p-1', p_usuario: 'u-quien', p_medio: 'transferencia' });
    expect(avisar).not.toHaveBeenCalled();
  });

  it('si estaba en la calle hace más de 12 h, se entrega directo', async () => {
    const { svc, updates, llamadas } = armar({ pedido: envio({ estado: 'en_camino', en_camino_en: HACE_11_DIAS, creado_en: HACE_11_DIAS }) });
    await svc.seEntrego('p-1', 'u-quien', 'tarjeta');
    expect(updates).toHaveLength(0);
    expect(llamadas.find((l) => l.name === 'entregar_pedido')?.args.p_medio).toBe('tarjeta');
  });

  it('solo para los atrasados viejos: uno recién entrado no se cierra salteando todo (lo mira el servidor)', async () => {
    const { svc, updates, llamadas } = armar({ pedido: envio({ estado: 'recibido', creado_en: new Date(Date.now() - 60_000).toISOString() }) });
    await expect(svc.seEntrego('p-1', 'u-quien', 'transferencia')).rejects.toThrow(/sigue su curso/);
    expect(updates).toHaveLength(0);
    expect(llamadas.find((l) => l.name === 'entregar_pedido')).toBeUndefined();
  });

  it('el cobro hay que elegirlo; pagado con Mercado Pago no se pregunta', async () => {
    await expect(armar({ pedido: atrasado({ forma_pago: 'transferencia' }) }).svc.seEntrego('p-1', 'u-quien')).rejects.toThrow(/Elegí cómo se cobró/);
    const pagado = armar({ pedido: atrasado({ pagado_en: HACE_11_DIAS }) });
    await pagado.svc.seEntrego('p-1', 'u-quien');
    expect(pagado.llamadas.find((l) => l.name === 'entregar_pedido')?.args.p_medio).toBeNull();
  });

  it('efectivo: pide confirmar que la plata está hoy en el cajón (entra en la caja de hoy)', async () => {
    const { svc, updates } = armar({ pedido: atrasado({ forma_pago: 'efectivo' }), cajasAbiertas: 1 });
    const error = await svc.seEntrego('p-1', 'u-quien', 'efectivo').catch((e) => e);
    expect((error as BadRequestException).getResponse()).toMatchObject({ codigo: 'CONFIRMAR_EFECTIVO' });
    expect(updates).toHaveLength(0);
    await expect(svc.seEntrego('p-1', 'u-quien', 'efectivo', { efectivoEnCaja: true })).resolves.toMatchObject({ estado: 'entregado' });
  });

  it('efectivo con la caja cerrada: frena ANTES de tocar el estado (sigue en «Recibido» y en Atrasados)', async () => {
    // producción hoy: ninguna caja abierta desde el 21/8 (DOM-EFB1F49E3E30, efectivo)
    const { svc, pedido, updates, llamadas } = armar({ pedido: atrasado({ forma_pago: 'efectivo' }), cajasAbiertas: 0 });
    await expect(svc.seEntrego('p-1', 'u-quien', 'efectivo', { efectivoEnCaja: true })).rejects.toThrow(/Abrí la caja/);
    expect(updates).toHaveLength(0);
    expect(pedido.estado).toBe('recibido');
    expect(llamadas.find((l) => l.name === 'entregar_pedido')).toBeUndefined();
  });

  it('si falta stock, frena antes de tocar el estado (la ventana de faltantes; si se cierra, sigue igual)', async () => {
    const { svc, pedido, updates } = armar({
      pedido: atrasado({ forma_pago: 'transferencia' }),
      rpcs: { faltantes_pedido: { data: [{ producto_id: 'x', sku: 'S', nombre: 'Agua', pide: 3, hay: 0 }], error: null } },
    });
    await expect(svc.seEntrego('p-1', 'u-quien', 'transferencia')).rejects.toMatchObject({ status: 409 });
    expect(updates).toHaveLength(0);
    expect(pedido.estado).toBe('recibido');
  });

  it('si la entrega igual falla, vuelve al estado y las fechas que tenía', async () => {
    const { svc, pedido, updates } = armar({
      pedido: atrasado({ forma_pago: 'transferencia', listo_en: null, preparacion_en: null, preparado_por: null }),
      rpcs: { entregar_pedido: { data: null, error: { message: 'Algo falló en la base' } } },
    });
    await expect(svc.seEntrego('p-1', 'u-quien', 'transferencia')).rejects.toThrow(/Algo falló/);
    expect(updates).toHaveLength(2);
    expect(pedido).toMatchObject({ estado: 'recibido', listo_en: null, preparacion_en: null, preparado_por: null });
  });

  it('solo para envíos a domicilio y abiertos', async () => {
    await expect(armar({ pedido: atrasado({ canal: 'pickup' }) }).svc.seEntrego('p-1')).rejects.toThrow(/domicilio/);
    await expect(armar({ pedido: atrasado({ estado: 'cancelado' }) }).svc.seEntrego('p-1')).rejects.toThrow(/cerrado/);
  });
});

describe('cambiar cuándo o a dónde va un envío', () => {
  const MANANA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + 86_400_000));

  it('el cliente lo pide para otro día: cambia la fecha y la franja y queda en el historial', async () => {
    const { svc, pedido, inserts } = armar({ pedido: atrasado({ entrega_fecha: '2026-10-14', entrega_franja: null }) });
    await expect(svc.cambiarEnvio('p-1', { entregaFecha: MANANA, entregaFranja: 'tarde' }, 'u-quien')).resolves.toEqual({ ok: true, cambios: 2 });
    expect(pedido).toMatchObject({ entrega_fecha: MANANA, entrega_franja: 'tarde', cambio_por: 'u-quien' });
    expect(inserts[0]).toMatchObject({ tabla: 'pedidos_historial', valores: { evento: 'envio', usuario_id: 'u-quien', detalle: { entrega: { fecha: MANANA, franja: 'tarde' } } } });
  });

  it('corregir la dirección la limpia y borra las coordenadas viejas', async () => {
    const { svc, pedido } = armar({ pedido: atrasado({ destino_direccion: 'Castex 100', destino_lat: -34.8, destino_lng: -58.5 }) });
    await svc.cambiarEnvio('p-1', { direccion: '  St Thomas Norte,\n lote 118 <div class="x">basura' }, 'u-quien');
    expect(pedido).toMatchObject({ destino_direccion: 'St Thomas Norte, lote 118', destino_lat: null, destino_lng: null });
  });

  it('no acepta una fecha pasada, una franja inventada ni una dirección vacía', async () => {
    const { svc, updates } = armar({ pedido: atrasado() });
    await expect(svc.cambiarEnvio('p-1', { entregaFecha: '2020-01-01' })).rejects.toThrow(/anterior a hoy/);
    await expect(svc.cambiarEnvio('p-1', { entregaFranja: 'noche' })).rejects.toThrow(/franja/);
    await expect(svc.cambiarEnvio('p-1', { direccion: '   ' })).rejects.toThrow(/Falta la dirección/);
    expect(updates).toHaveLength(0);
  });

  it('sin cambios no escribe nada; un pedido cerrado o de retiro no se toca', async () => {
    const igual = armar({ pedido: atrasado({ entrega_fecha: null, entrega_franja: 'tarde' }) });
    await expect(igual.svc.cambiarEnvio('p-1', { entregaFecha: '', entregaFranja: 'tarde' })).resolves.toEqual({ ok: true, cambios: 0 });
    expect(igual.updates).toHaveLength(0);
    await expect(armar({ pedido: atrasado({ estado: 'entregado' }) }).svc.cambiarEnvio('p-1', { entregaFranja: 'tarde' })).rejects.toThrow(/cerrado/);
    await expect(armar({ pedido: atrasado({ canal: 'pickup' }) }).svc.cambiarEnvio('p-1', { entregaFranja: 'tarde' })).rejects.toThrow(/domicilio/);
  });
});
