import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PARA_CUALQUIER_ROL, ROLES } from './decorators';

// Op salón (5/11/2026): entra solo donde @Roles lo nombra
function contexto(meta: Record<string, unknown>, rol: string) {
  const handler = () => null;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  const req: any = { headers: { authorization: 'Bearer x' } };
  const guard = new AuthGuard({ verifyAsync: async () => ({ sub: 'u', rol }) } as any, new Reflector());
  const ctx: any = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => req }) };
  return guard.canActivate(ctx);
}

describe('rol encerrado (op salón)', () => {
  it('no entra a lo que no declara roles', async () => {
    await expect(contexto({}, 'op_salon')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('no entra a lo de otros roles', async () => {
    await expect(contexto({ [ROLES]: ['cajero', 'dueno'] }, 'op_salon')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('entra donde lo nombran y a cambiar su clave', async () => {
    await expect(contexto({ [ROLES]: ['op_salon', 'deposito'] }, 'op_salon')).resolves.toBe(true);
    await expect(contexto({ [PARA_CUALQUIER_ROL]: true }, 'op_salon')).resolves.toBe(true);
  });
  it('a los demás roles no les cambia nada', async () => {
    await expect(contexto({}, 'cajero')).resolves.toBe(true);
  });
});
