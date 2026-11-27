// LA SESIÓN CON LOS PERMISOS DE HOY (27/11/2026): el panel cambia el token una vez por minuto
// por uno con los roles de hoy (María Belén Avalos: creada cajera, pasada a salón y fiambrería,
// la app la seguía mandando a la Caja). Ver AuthService.sesionAlDia y apps/admin/middleware.ts.
import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PARA_CUALQUIER_ROL } from './decorators';

const servicio = (ficha: any) => {
  const db: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ficha }) }) }) }) };
  const jwt: any = { signAsync: async (p: any) => JSON.stringify(p) };
  return new AuthService(db, jwt);
};

describe('La sesión con los permisos de hoy', () => {
  it('el token nuevo trae los roles, el nombre y la sucursal de la ficha de hoy', async () => {
    const r = await servicio({ id: 'b', nombre: 'Maria belen avalos', rol: 'op_salon', roles: ['op_salon', 'fiambreria'], sucursal_id: 'st', activo: true }).sesionAlDia('b');
    const datos = JSON.parse(r.token);
    expect(datos).toMatchObject({ sub: 'b', rol: 'op_salon', roles: ['op_salon', 'fiambreria'], sucursalId: 'st' });
    expect(r.roles).toEqual(['op_salon', 'fiambreria']);
  });

  it('al dado de baja no le da sesión', async () => {
    await expect(servicio({ id: 'b', rol: 'op_salon', roles: ['op_salon'], activo: false }).sesionAlDia('b')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(servicio(null).sesionAlDia('x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('la pueden pedir todos los roles, también salón y fiambrería (encerrados)', () => {
    expect(Reflect.getMetadata(PARA_CUALQUIER_ROL, AuthController.prototype.sesionAlDia)).toBe(true);
  });
});
