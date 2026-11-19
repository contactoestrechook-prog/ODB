import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { ROLES, SIN_HERENCIA } from './decorators';
import { estaEncerrado, normalizarRoles, rolQueEntra, rolesDe } from './roles';

// Varios roles por persona (Leandro, 19/11/2026, planilla de St Thomas y Santa Inés)
async function entrar(meta: Record<string, unknown>, usuario: Record<string, unknown>) {
  const handler = () => null;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  const req: any = { headers: { authorization: 'Bearer x' } };
  const guard = new AuthGuard({ verifyAsync: async () => ({ sub: 'u', ...usuario }) } as any, new Reflector());
  const ctx: any = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => req }) };
  await guard.canActivate(ctx);
  return req.usuario;
}

describe('varios roles por persona', () => {
  it('el token viejo (solo rol) sigue andando igual', async () => {
    const u = await entrar({ [ROLES]: ['cajero'] }, { rol: 'cajero' });
    expect(u.rol).toBe('cajero');
    expect(u.roles).toEqual(['cajero']);
  });

  it('administrativa + caja: en la caja actúa como cajera (no abre la caja a nombre de otro)', async () => {
    const u = await entrar({ [ROLES]: ['cajero', 'gerente', 'dueno'] }, { rol: 'administrativo', roles: ['administrativo', 'cajero'] });
    expect(u.rol).toBe('cajero');
    expect(u.rolPrincipal).toBe('administrativo');
  });

  it('administrativa + caja: en facturas de compra sigue siendo administrativa', async () => {
    const u = await entrar({ [ROLES]: ['comprador', 'deposito'] }, { rol: 'administrativo', roles: ['administrativo', 'cajero'] });
    expect(u.rol).toBe('administrativo');
  });

  it('caja + op salón: donde solo entra el op salón, actúa como op salón (su sucursal)', async () => {
    const u = await entrar({ [ROLES]: ['op_salon', 'deposito', 'gerente', 'dueno'] }, { rol: 'cajero', roles: ['cajero', 'op_salon'] });
    expect(u.rol).toBe('op_salon');
  });

  it('caja + op salón no queda encerrado: entra a lo que no declara roles', async () => {
    const u = await entrar({}, { rol: 'cajero', roles: ['cajero', 'op_salon'] });
    expect(u.rol).toBe('cajero');
  });

  it('fiambrería entra donde entra el op salón y queda encerrada', async () => {
    const u = await entrar({ [ROLES]: ['op_salon', 'deposito'] }, { rol: 'fiambreria', roles: ['fiambreria'] });
    expect(u.rol).toBe('fiambreria');
    await expect(entrar({}, { rol: 'fiambreria', roles: ['fiambreria'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(entrar({ [ROLES]: ['cajero'] }, { rol: 'fiambreria', roles: ['fiambreria'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ninguno de sus roles sirve: no pasa', async () => {
    await expect(entrar({ [ROLES]: ['dueno'] }, { rol: 'deposito', roles: ['deposito', 'repartidor'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@SinHerencia: administrativo no entra por depósito, pero sí por su rol de caja', async () => {
    await expect(entrar({ [ROLES]: ['deposito'], [SIN_HERENCIA]: true }, { rol: 'administrativo', roles: ['administrativo'] })).rejects.toBeInstanceOf(ForbiddenException);
    const u = await entrar({ [ROLES]: ['cajero', 'deposito'], [SIN_HERENCIA]: true }, { rol: 'administrativo', roles: ['administrativo', 'cajero'] });
    expect(u.rol).toBe('cajero');
  });
});

describe('helpers de roles', () => {
  it('rolesDe pone el principal primero y sin repetidos', () => {
    expect(rolesDe({ rol: 'cajero', roles: ['op_salon', 'cajero', 'repartidor'] })).toEqual(['cajero', 'op_salon', 'repartidor']);
    expect(rolesDe({ rol: 'deposito' })).toEqual(['deposito']);
  });
  it('normalizarRoles elige el de más alcance como principal', () => {
    expect(normalizarRoles(['op_salon', 'repartidor', 'cajero'])).toEqual(['cajero', 'repartidor', 'op_salon']);
    expect(normalizarRoles(['cajero', 'administrativo'])).toEqual(['administrativo', 'cajero']);
    expect(normalizarRoles(['repartidor', 'deposito'])).toEqual(['deposito', 'repartidor']);
    expect(normalizarRoles(['inventado'])).toEqual([]);
  });
  it('encerrado solo si todos sus roles lo son', () => {
    expect(estaEncerrado(['op_salon'])).toBe(true);
    expect(estaEncerrado(['fiambreria', 'op_salon'])).toBe(true);
    expect(estaEncerrado(['cajero', 'op_salon'])).toBe(false);
  });
  it('rolQueEntra prefiere el principal', () => {
    expect(rolQueEntra(['administrativo', 'cajero'], ['deposito', 'cajero'])).toBe('administrativo');
    expect(rolQueEntra(['deposito', 'repartidor'], ['repartidor'])).toBe('repartidor');
    expect(rolQueEntra(['deposito'], ['dueno'])).toBeNull();
  });
});
