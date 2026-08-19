import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Publico } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // El login del staff es la puerta a roles dueño/gerente: límite propio, mucho
  // más chico que el global de 300/min, para frenar fuerza bruta de claves.
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  login(@Body() body: { email: string; clave: string }) {
    return this.auth.login(body.email, body.clave);
  }

  // Cambiar la propia clave (cualquier usuario logueado). El AuthGuard global
  // ya exige token; req.usuario.sub es el dueño de la sesión.
  @Post('cambiar-clave')
  cambiarClave(@Body() body: { claveActual: string; claveNueva: string }, @Req() req: any) {
    return this.auth.cambiarClave(req.usuario.sub, body?.claveActual ?? '', body?.claveNueva ?? '');
  }
}
