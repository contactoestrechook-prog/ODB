import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ES_PUBLICO, PARA_CUALQUIER_ROL, ROLES, SIN_HERENCIA } from './decorators';
import { estaEncerrado, implicados, rolQueEntra, rolesDe } from './roles';

// qué roles "hereda" cada rol compuesto (además de sí mismo): ver roles.ts
export { ROLES_IMPLICADOS } from './roles';

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
    // Varios roles por persona (19/11/2026): pasa si alguno sirve, y en esta
    // acción ACTÚA con el que le abrió la puerta (req.usuario.rol). Así una
    // administrativa que también es cajera, en la caja, es una cajera: nada de
    // sumar lo de los dos roles en una misma acción.
    const suyos = rolesDe(req.usuario);
    req.usuario.roles = suyos;
    req.usuario.rolPrincipal = suyos[0] ?? req.usuario.rol;
    // un rol encerrado (op salón, fiambrería) solo pasa donde lo nombran; si la
    // persona además tiene un rol abierto (cajero), no está encerrada
    if (estaEncerrado(suyos)
      && !(roles ?? []).some((r) => suyos.some((s) => implicados(s).includes(r)))
      && !this.reflector.getAllAndOverride<boolean>(PARA_CUALQUIER_ROL, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('Tu usuario solo entra a Salón');
    }
    const entra = rolQueEntra(suyos, roles, sinHerencia);
    if (roles?.length && !entra) {
      throw new ForbiddenException(
        `Esta acción requiere rol ${roles.join(' o ')} (tu rol: ${suyos.join(', ')})`,
      );
    }
    if (entra) req.usuario.rol = entra;
    return true;
  }
}
