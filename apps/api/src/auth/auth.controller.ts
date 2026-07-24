import { Body, Controller, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Publico } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
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
