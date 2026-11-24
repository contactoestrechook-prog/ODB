import { ConflictException } from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { cambiosAbiertos, mensajeDeCambiosAbiertos } from './cambio-sin-respuesta';

// «Cuando se cerró no impactó en el pedido el cambio» (Juan Pablo, 23/11/2026):
// DOM-F0CF53FF6465 pasó a listo, salió y se entregó con el cambio del Feta sin
// contestar. Ahora ningún paso que cierra el pedido sale con un cambio abierto.

const FETA = {
  id: '03159e42-c6b6-43c4-a1eb-3f6a1ad8bb9f', tipo: 'parecido', nombre_falta: 'Cabaña Piedras Blancas queso Feta x 200g',
  nombre_reemplazo: 'Cabaña Piedras Blancas Queso Crottin', cantidad: '0.2', pide: '0.200', hay: '0', pedida: null, variedades: null,
  estado: 'preguntado', orden: 1,
};

/** Base falsa: el pedido, sus cambios y las RPC que se llaman. */
function armar(o: { estado: string; canal?: string; cambios?: any[]; reemplazosFalla?: boolean }) {
  const llamadas: string[] = [];
  const updates: any[] = [];
  const pedido = { id: 'd410a70a', estado: o.estado, canal: o.canal ?? 'pickup', sucursal_id: 's-1', qr_retiro: 'DOM-F0CF53FF6465', items: [], cliente: null, origen: 'bot', repartidor_id: 'r-1' };
  const db: any = {
    from: (tabla: string) => {
      const filtros: Record<string, any> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filtros[k] = v; return q; },
        in: (k: string, v: any) => {
          if (tabla === 'pedidos_reemplazos') {
            if (o.reemplazosFalla) return Promise.resolve({ data: null, error: { message: 'se cayó' } });
            return Promise.resolve({ data: (o.cambios ?? []).filter((c) => v.includes(c.estado)), error: null });
          }
          return q;
        },
        single: () => Promise.resolve({ data: pedido, error: null }),
        maybeSingle: () => Promise.resolve({ data: tabla === 'pedidos' ? pedido : null, error: null }),
        update: (u: any) => { updates.push({ tabla, u }); return q; },
        insert: () => Promise.resolve({ error: null }),
        then: (ok: any) => Promise.resolve({ data: [{ id: pedido.id }], error: null }).then(ok),
      };
      return q;
    },
    rpc: (name: string) => {
      llamadas.push(name);
      if (name === 'faltantes_pedido') return Promise.resolve({ data: [], error: null });
      if (name === 'entregar_pedido') return Promise.resolve({ data: { venta: { venta_id: 'v-1' } }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { svc: new PedidosService(db, { aCliente: jest.fn() } as any), llamadas, updates };
}

async function errorDe(p: Promise<unknown>) {
  try { await p; } catch (e) { return e as any; }
  throw new Error('no frenó');
}

describe('un pedido no se cierra con un cambio sin contestar (DOM-F0CF53FF6465)', () => {
  it('entregar con el cambio del Feta abierto no registra la venta: pide lo que dijo el cliente', async () => {
    const { svc, llamadas } = armar({ estado: 'listo', cambios: [FETA] });
    const e = await errorDe(svc.avanzar('d410a70a', 'entregado'));
    expect(e).toBeInstanceOf(ConflictException);
    const cuerpo = e.getResponse();
    expect(cuerpo.codigo).toBe('CAMBIO_SIN_RESPUESTA');
    expect(cuerpo.cambios).toEqual([expect.objectContaining({ id: FETA.id, falta: FETA.nombre_falta, reemplazo: FETA.nombre_reemplazo, cantidad: 0.2, hay: 0 })]);
    expect(cuerpo.message).toContain('Crottin');
    expect(llamadas).not.toContain('entregar_pedido');
  });

  it('tampoco pasa a listo ni sale con el cambio abierto', async () => {
    for (const [de, a] of [['en_preparacion', 'listo'], ['listo', 'en_camino']]) {
      const { svc, updates } = armar({ estado: de, canal: 'domicilio', cambios: [FETA] });
      const e = await errorDe(svc.avanzar('d410a70a', a));
      expect(e.getResponse().codigo).toBe('CAMBIO_SIN_RESPUESTA');
      expect(updates.filter((x) => x.tabla === 'pedidos')).toEqual([]);
    }
  });

  it('con el cambio contestado (sí o no) entrega como siempre', async () => {
    for (const estado of ['aceptado', 'rechazado', 'anulado']) {
      const { svc, llamadas } = armar({ estado: 'listo', cambios: [{ ...FETA, estado }] });
      await expect(svc.avanzar('d410a70a', 'entregado')).resolves.toBeTruthy();
      expect(llamadas).toContain('entregar_pedido');
    }
  });

  it('sin cambios, y si la consulta de cambios falla, no traba el pedido', async () => {
    for (const o of [{ cambios: [] }, { cambios: [FETA], reemplazosFalla: true }]) {
      const { svc, llamadas } = armar({ estado: 'listo', ...o });
      await expect(svc.avanzar('d410a70a', 'entregado')).resolves.toBeTruthy();
      expect(llamadas).toContain('entregar_pedido');
    }
  });

  it('cancelar con un cambio abierto sigue andando', async () => {
    const { svc, llamadas } = armar({ estado: 'listo', cambios: [FETA] });
    await svc.avanzar('d410a70a', 'cancelado').catch(() => null);
    expect(llamadas).toContain('cancelar_pedido');
  });

  it('el mensaje dice qué se le ofreció', async () => {
    const { svc } = armar({ estado: 'listo', cambios: [FETA] });
    const db = (svc as any).db;
    const cambios = await cambiosAbiertos(db, 'd410a70a');
    expect(mensajeDeCambiosAbiertos(cambios)).toBe('Falta anotar lo que dijo el cliente: si le sirve Cabaña Piedras Blancas Queso Crottin en lugar de Cabaña Piedras Blancas queso Feta x 200g. Anotá si dijo que sí o que no y seguí.');
    const variedad = { id: 'v', tipo: 'variedad' as const, falta: 'Saphirus', reemplazo: null, cantidad: null, pide: 1, hay: 0, pedida: 'lavanda', variedades: ['coco'], estado: 'preguntado' };
    expect(mensajeDeCambiosAbiertos([cambios[0], variedad])).toContain('2 cambios');
    expect(mensajeDeCambiosAbiertos([variedad])).toContain('qué variedad quiere de Saphirus (pidió lavanda)');
  });
});
