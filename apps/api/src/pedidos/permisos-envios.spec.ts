import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES } from '../auth/decorators';
import { PedidosController } from './pedidos.controller';
import { RepartosController } from '../repartos/repartos.controller';
import { RepartidoresController } from '../repartidores/repartidores.controller';
import { CajaController } from '../caja/caja.controller';

// Quién entra a lo nuevo de envíos (revisión del 21/10/2026):
// - administrativo hereda depósito, pero envíos, entregas y faltantes son del
//   local, no de backoffice: no entra por herencia (@SinHerencia). Sí sigue
//   pidiendo el PIN de supervisor (caja/autorizar) para cerrar un conteo.
// - el repartidor solo toca los pedidos que lleva él.
// - la autorización para la guardia (DNI y teléfono de quien lleva, patente y
//   póliza) es de gerencia y dueño, como el resto del módulo de repartidores.

function guardia() {
  const jwt = { verifyAsync: async (t: string) => JSON.parse(t) } as any;
  return new AuthGuard(jwt, new Reflector());
}

async function puede(rol: string, clase: any, metodo: string): Promise<boolean> {
  const req: any = { headers: { authorization: `Bearer ${JSON.stringify({ sub: `u-${rol}`, rol })}` } };
  const ctx: any = {
    getHandler: () => clase.prototype[metodo],
    getClass: () => clase,
    switchToHttp: () => ({ getRequest: () => req }),
  };
  try {
    return await guardia().canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('envíos y entregas: administrativo no entra por herencia', () => {
  const nuevos: [any, string][] = [
    [PedidosController, 'seEntrego'],
    [PedidosController, 'cambiarEnvio'],
    [PedidosController, 'resolverFaltante'],
    [PedidosController, 'misEntregas'],
    [PedidosController, 'repartidorUbicacion'],
    [PedidosController, 'quienLleva'],
    [RepartosController, 'posicion'],
  ];

  it.each(nuevos.map(([c, m]) => [`${c.name}.${m}`, c, m]))('%s: depósito sí, administrativo no', async (_n, clase, metodo) => {
    expect(await puede('deposito', clase, metodo)).toBe(true);
    expect(await puede('administrativo', clase, metodo)).toBe(false);
  });

  it('la herencia sigue valiendo donde no se la sacó: el PIN de supervisor para cerrar un conteo', async () => {
    expect(await puede('administrativo', CajaController, 'autorizar')).toBe(true);
    expect(await puede('comprador', CajaController, 'autorizar')).toBe(false);
  });

  it('caja y depósito, que llevan envíos desde «Mis entregas», mandan su posición al mapa de flota', async () => {
    for (const rol of ['repartidor', 'cajero', 'deposito', 'gerente', 'dueno']) {
      expect(await puede(rol, RepartosController, 'posicion')).toBe(true);
    }
  });
});

describe('autorización para la guardia: solo gerencia y dueño', () => {
  it('no tiene roles propios: quedan los del módulo', () => {
    expect(Reflect.getMetadata(ROLES, RepartidoresController.prototype.autorizacion)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES, RepartidoresController)).toEqual(['gerente', 'dueno']);
  });

  it.each(['cajero', 'deposito', 'administrativo', 'repartidor'])('%s no la puede pedir', async (rol) => {
    expect(await puede(rol, RepartidoresController, 'autorizacion')).toBe(false);
  });

  it('gerencia y dueño sí', async () => {
    expect(await puede('gerente', RepartidoresController, 'autorizacion')).toBe(true);
    expect(await puede('dueno', RepartidoresController, 'autorizacion')).toBe(true);
  });
});

describe('el repartidor solo toca los pedidos que lleva', () => {
  const armar = (repartidorDelPedido: string | null) => {
    const pedidos = {
      loLleva: jest.fn(async (_id: string, u?: string) => !!u && u === repartidorDelPedido),
      resolverFaltante: jest.fn(async () => ({ ok: true })),
      avanzar: jest.fn(async () => ({ ok: true })),
    } as any;
    return { ctrl: new PedidosController(pedidos, {} as any), pedidos };
  };
  const REP = { usuario: { sub: 'u-rep', rol: 'repartidor' } };

  it('sacar un faltante de un pedido ajeno: 403 y no llega a la base', async () => {
    const { ctrl, pedidos } = armar('u-otro');
    await expect(ctrl.resolverFaltante('p-1', { productoId: 'prod-q' }, REP)).rejects.toBeInstanceOf(ForbiddenException);
    expect(pedidos.resolverFaltante).not.toHaveBeenCalled();
  });

  it('en uno que lleva él, sí', async () => {
    const { ctrl, pedidos } = armar('u-rep');
    await ctrl.resolverFaltante('p-1', { productoId: 'prod-q' }, REP);
    expect(pedidos.resolverFaltante).toHaveBeenCalledWith('p-1', 'prod-q', undefined, undefined, 'u-rep');
  });

  it('avanzar un pedido ajeno: 403', async () => {
    const { ctrl, pedidos } = armar(null);
    await expect(ctrl.avanzar('p-1', { estado: 'entregado' }, REP)).rejects.toBeInstanceOf(ForbiddenException);
    expect(pedidos.avanzar).not.toHaveBeenCalled();
  });

  it('caja, depósito y encargado no pasan por ese control (manejan cualquiera desde Pedidos)', async () => {
    const { ctrl, pedidos } = armar(null);
    await ctrl.resolverFaltante('p-1', { productoId: 'prod-q' }, { usuario: { sub: 'u-caj', rol: 'cajero' } });
    await ctrl.avanzar('p-1', { estado: 'en_preparacion' }, { usuario: { sub: 'u-dep', rol: 'deposito' } });
    expect(pedidos.loLleva).not.toHaveBeenCalled();
    expect(pedidos.resolverFaltante).toHaveBeenCalled();
    expect(pedidos.avanzar).toHaveBeenCalled();
  });
});
