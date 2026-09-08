import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
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

  // ---- OLVIDÉ MI CONTRASEÑA (público, sin sesión) ----
  // Límite bajo: pedir enlaces manda mails y toca cuentas ajenas.
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('olvide-clave')
  olvideClave(@Body() body: { email: string }, @Req() req: any) {
    const origen = req?.ip ?? req?.headers?.['x-forwarded-for'] ?? null;
    return this.auth.pedirReseteo(body?.email ?? '', typeof origen === 'string' ? origen : undefined);
  }

  // ¿El enlace sirve? (para mostrar el formulario o el cartel de vencido)
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('reseteo/verificar')
  verificarReseteo(@Query('token') token: string) {
    return this.auth.verificarTokenReseteo(token ?? '');
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('reseteo/confirmar')
  confirmarReseteo(@Body() body: { token: string; claveNueva: string }) {
    return this.auth.resetearClave(body?.token ?? '', body?.claveNueva ?? '');
  }

  // Cambiar la propia clave (cualquier usuario logueado). El AuthGuard global
  // ya exige token; req.usuario.sub es el dueño de la sesión.
  @Post('cambiar-clave')
  cambiarClave(@Body() body: { claveActual: string; claveNueva: string }, @Req() req: any) {
    return this.auth.cambiarClave(req.usuario.sub, body?.claveActual ?? '', body?.claveNueva ?? '');
  }
}
