import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClientesAuthService } from './clientes-auth.service';
import { Publico } from '../auth/decorators';

@Controller()
export class ClientesAuthController {
  constructor(private readonly auth: ClientesAuthService) {}

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('app/registro')
  registro(@Body() body: { dni: string; nombre: string; clave: string; fechaNacimiento?: string; codigoReferido?: string }) {
    return this.auth.registro(body.dni, body.nombre, body.clave, body.fechaNacimiento, body.codigoReferido);
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('app/login')
  login(@Body() body: { dni: string; clave: string }) {
    return this.auth.login(body.dni, body.clave);
  }

  // Tienda web: alta y acceso por email
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('app/registro-email')
  registroEmail(@Body() body: { email: string; nombre: string; clave: string; codigoReferido?: string }) {
    return this.auth.registroEmail(body.email, body.nombre, body.clave, body.codigoReferido);
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('app/login-email')
  loginEmail(@Body() body: { email: string; clave: string }) {
    return this.auth.loginEmail(body.email, body.clave);
  }

  // Requiere sesión de cliente (token con rol 'cliente')
  @Post('app/verificacion')
  verificacion(@Req() req: any) {
    if (req.usuario?.rol !== 'cliente') {
      throw new UnauthorizedException('Requiere sesión de cliente');
    }
    return this.auth.crearVerificacion(req.usuario.dni);
  }

  @Publico()
  @Post('didit/webhook')
  webhook(@Req() req: any) {
    return this.auth.webhook(req.rawBody, req.headers ?? {});
  }
}
