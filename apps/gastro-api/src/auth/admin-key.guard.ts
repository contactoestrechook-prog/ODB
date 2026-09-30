import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ES_PUBLICO } from './decorators';

// Fase 1: un solo usuario administrador (Damián/encargado), sin roles ni JWT
// todavía — una clave compartida alcanza y es más simple de operar. Cuando
// haya más de una persona operando el panel, esto se reemplaza por el mismo
// esquema JWT + roles que usa ODB (ver apps/api/src/auth).
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const req = ctx.switchToHttp().getRequest();
    const clave = req.headers['x-admin-key'];
    const esperada = process.env.ADMIN_KEY;
    if (!esperada) {
      throw new UnauthorizedException('ADMIN_KEY no configurada en el servidor');
    }
    if (clave !== esperada) {
      throw new UnauthorizedException('Clave de administrador inválida');
    }
    return true;
  }
}
