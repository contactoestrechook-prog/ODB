import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

// Los bots de WhatsApp (n8n) llaman server-to-server, no con sesión de usuario.
// Se autentican con una API key en el header x-api-key contra BOT_API_KEY.
@Injectable()
export class BotGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const esperada = process.env.BOT_API_KEY;
    if (!esperada) {
      // fail-closed: sin API key configurada, nadie entra (evita bot abierto por olvido)
      throw new UnauthorizedException('Bot sin configurar (falta BOT_API_KEY en el .env)');
    }
    const req = context.switchToHttp().getRequest();
    const recibida = String(req.headers['x-api-key'] ?? '');
    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('API key inválida');
    }
    return true;
  }
}
