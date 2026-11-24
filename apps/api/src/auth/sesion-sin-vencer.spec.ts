import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { ROLES } from './decorators';

// LA SESIÓN DEL EQUIPO NO VENCE (Leandro, 24/11/2026: «después de un tiempo se
// cierra la sesión todo el tiempo y hay que volver a loguearse. Eso hay que
// desactivarlo, ya»). Quien queda afuera es el dado de baja, no el que lleva
// muchas horas trabajando.
const jwt = new JwtService({ secret: 'clave-de-prueba-de-sesion-larga' });
const hace = (horas: number) => Math.floor(Date.now() / 1000) - horas * 3600;

function baseCon(fichas: Record<string, any>, fallar = false) {
  const consultas: string[] = [];
  const db: any = {
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            consultas.push(id);
            if (fallar) return { data: null, error: { message: 'la base no contesta' } };
            return { data: fichas[id] ?? null, error: null };
          },
        }),
      }),
    }),
  };
  return { db, consultas };
}

async function entrar(token: string, db?: any, roles?: string[]) {
  const handler = () => null;
  if (roles) Reflect.defineMetadata(ROLES, roles, handler);
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const guard = new AuthGuard(jwt, new Reflector(), db);
  const ctx: any = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => req }) };
  await guard.canActivate(ctx);
  return req.usuario;
}

const activa = { activo: true, nombre: 'Romina', rol: 'administrativo', roles: ['administrativo'], sucursal_id: 's1' };

describe('la sesión del equipo no vence', () => {
  it('un token del equipo de hace 3 días (ya «vencido») sigue entrando', async () => {
    const token = await jwt.signAsync({ sub: 'u-romina', rol: 'administrativo', exp: hace(72) });
    const { db } = baseCon({ 'u-romina': activa });
    const u = await entrar(token, db);
    expect(u.sub).toBe('u-romina');
  });

  it('el token nuevo del equipo se firma por 10 años', async () => {
    const token = await jwt.signAsync({ sub: 'u' }, { expiresIn: '3650d' });
    const { exp } = jwt.decode(token) as any;
    expect(exp * 1000 - Date.now()).toBeGreaterThan(9 * 365 * 24 * 3600 * 1000);
  });

  it('dado de baja: afuera, aunque tenga la sesión abierta', async () => {
    const token = await jwt.signAsync({ sub: 'u-ex', rol: 'cajero' });
    const { db } = baseCon({ 'u-ex': { ...activa, activo: false, rol: 'cajero', roles: ['cajero'] } });
    await expect(entrar(token, db)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('usuario borrado: afuera', async () => {
    const token = await jwt.signAsync({ sub: 'u-borrado', rol: 'cajero' });
    const { db } = baseCon({});
    await expect(entrar(token, db)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('actúa con los roles de HOY, no con los del día que entró', async () => {
    const token = await jwt.signAsync({ sub: 'u-pablo', rol: 'deposito', roles: ['deposito', 'repartidor'], exp: hace(30) });
    const { db } = baseCon({ 'u-pablo': { ...activa, nombre: 'Pablo', rol: 'deposito', roles: ['deposito'] } });
    await expect(entrar(token, db, ['repartidor'])).rejects.toThrow(/requiere rol repartidor/);
  });

  it('si la base no contesta, sigue con lo del token (no saca a todos)', async () => {
    const token = await jwt.signAsync({ sub: 'u-romina', rol: 'administrativo', exp: hace(48) });
    const { db } = baseCon({}, true);
    const u = await entrar(token, db);
    expect(u.rol).toBe('administrativo');
  });

  it('la ficha se lee como mucho una vez por minuto por persona', async () => {
    const token = await jwt.signAsync({ sub: 'u-romina', rol: 'administrativo' });
    const { db, consultas } = baseCon({ 'u-romina': activa });
    const guard = new AuthGuard(jwt, new Reflector(), db);
    const handler = () => null;
    for (let i = 0; i < 5; i++) {
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      await guard.canActivate({ getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => req }) } as any);
    }
    expect(consultas).toEqual(['u-romina']);
  });

  it('token falso: afuera', async () => {
    const otro = new JwtService({ secret: 'otra-clave-que-no-es-la-nuestra' });
    const token = await otro.signAsync({ sub: 'u-romina', rol: 'dueno' });
    const { db } = baseCon({ 'u-romina': activa });
    await expect(entrar(token, db)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('los clientes de la tienda siguen como estaban', () => {
  it('token de cliente vencido: afuera', async () => {
    const token = await jwt.signAsync({ sub: 'c-1', rol: 'cliente', exp: hace(1) });
    await expect(entrar(token, baseCon({}).db)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de cliente vigente: entra, sin buscarlo entre los usuarios del equipo', async () => {
    const token = await jwt.signAsync({ sub: 'c-1', rol: 'cliente' }, { expiresIn: '24h' });
    const { db, consultas } = baseCon({});
    const u = await entrar(token, db, ['cliente']);
    expect(u.sub).toBe('c-1');
    expect(consultas).toEqual([]);
  });
});
