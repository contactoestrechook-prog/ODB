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
  registro(@Body() body: { dni: string; nombre: string; clave: string }) {
    return this.auth.registro(body.dni, body.nombre, body.clave);
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('app/login')
  login(@Body() body: { dni: string; clave: string }) {
    return this.auth.login(body.dni, body.clave);
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
  webhook(@Body() payload: any) {
    return this.auth.webhook(payload);
  }
}
