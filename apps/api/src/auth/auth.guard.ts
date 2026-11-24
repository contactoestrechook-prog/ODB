import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { ES_PUBLICO, PARA_CUALQUIER_ROL, ROLES, SIN_HERENCIA } from './decorators';
import { estaEncerrado, implicados, rolQueEntra, rolesDe } from './roles';

// qué roles "hereda" cada rol compuesto (además de sí mismo): ver roles.ts
export { ROLES_IMPLICADOS } from './roles';

// La sesión del equipo NO vence (Leandro, 24/11/2026: «después de un tiempo se
// cierra la sesión todo el tiempo y hay que volver a loguearse. Eso hay que
// desactivarlo, ya»). Antes el token duraba 24 h y la cookie del panel 12 h: a
// mitad del turno los mandaba al login. Ahora el token del equipo no se mira por
// fecha; lo que manda es la ficha del usuario, leída cada minuto como mucho:
// - dado de baja (activo = false) o borrado → afuera, aunque tenga sesión abierta;
// - sus roles, nombre y sucursal son los de HOY, no los del día que entró.
// Los clientes de la tienda (rol 'cliente') siguen como estaban.
const FICHA_VALE_MS = 60_000;
type Ficha = { activo: boolean; nombre: string | null; rol: string | null; roles: unknown; sucursal_id: string | null } | null;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly fichas = new Map<string, { ficha: Ficha; hasta: number }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Optional() @Inject(SUPABASE) private readonly db?: SupabaseClient,
  ) {}

  // undefined = no se pudo leer (la base no contestó): se sigue con lo del token,
  // para que un tropiezo de la base no saque a todo el equipo del sistema
  private async fichaDe(id: string): Promise<Ficha | undefined> {
    if (!this.db || !id) return undefined;
    const guardada = this.fichas.get(id);
    if (guardada && guardada.hasta > Date.now()) return guardada.ficha;
    try {
      const { data, error } = await this.db
        .from('usuarios')
        .select('activo, nombre, rol, roles, sucursal_id')
        .eq('id', id)
        .maybeSingle();
      if (error) return undefined;
      const ficha = (data as Ficha) ?? null;
      this.fichas.set(id, { ficha, hasta: Date.now() + FICHA_VALE_MS });
      return ficha;
    } catch {
      return undefined;
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Falta el token de acceso');

    let datos: any;
    try {
      datos = await this.jwt.verifyAsync(token, { ignoreExpiration: true });
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
    if (datos?.rol === 'cliente') {
      // clientes de la tienda: su token vence como siempre
      if (typeof datos.exp === 'number' && datos.exp * 1000 < Date.now()) {
        throw new UnauthorizedException('Token inválido o vencido');
      }
    } else {
      const ficha = await this.fichaDe(String(datos?.sub ?? ''));
      if (ficha === null || ficha?.activo === false) {
        throw new UnauthorizedException('Tu usuario ya no está activo en ODB');
      }
      if (ficha) {
        datos = { ...datos, nombre: ficha.nombre ?? datos.nombre, rol: ficha.rol ?? datos.rol, roles: ficha.roles ?? datos.roles, sucursalId: ficha.sucursal_id ?? datos.sucursalId };
      }
    }
    req.usuario = datos;

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
