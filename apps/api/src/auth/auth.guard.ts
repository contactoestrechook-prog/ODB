import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ES_PUBLICO, PARA_CUALQUIER_ROL, ROLES, ROLES_ENCERRADOS, SIN_HERENCIA } from './decorators';

// qué roles "hereda" cada rol compuesto (además de sí mismo)
export const ROLES_IMPLICADOS: Record<string, string[]> = {
  administrativo: ['administrativo', 'comprador', 'deposito'],
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Falta el token de acceso');

    try {
      req.usuario = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // Roles compuestos: "administrativo" (backoffice) puede todo lo que pueden
    // comprador Y depósito — cargar facturas y remitos, recibir mercadería,
    // órdenes de compra, proveedores — y nada más (ni caja, ni ventas, ni
    // dirección). Así no hace falta tocar cada @Roles del sistema.
    // @SinHerencia: solo el rol propio (ver decorators.ts)
    const sinHerencia = this.reflector.getAllAndOverride<boolean>(SIN_HERENCIA, [ctx.getHandler(), ctx.getClass()]);
    // un rol encerrado (op salón) solo pasa donde lo nombran
    if (ROLES_ENCERRADOS.includes(req.usuario.rol) && !roles?.includes(req.usuario.rol)
      && !this.reflector.getAllAndOverride<boolean>(PARA_CUALQUIER_ROL, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('Tu usuario solo entra a Salón');
    }
    const rolesEfectivos = sinHerencia ? [req.usuario.rol] : ROLES_IMPLICADOS[req.usuario.rol] ?? [req.usuario.rol];
    if (roles?.length && !roles.some((r) => rolesEfectivos.includes(r))) {
      throw new ForbiddenException(
        `Esta acción requiere rol ${roles.join(' o ')} (tu rol: ${req.usuario.rol})`,
      );
    }
    return true;
  }
}
