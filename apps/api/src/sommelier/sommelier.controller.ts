import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { SommelierService } from './sommelier.service';
import type { MensajeChat, PedidoVendedor } from './sommelier.service';
import { Publico, Roles } from '../auth/decorators';

// Público pero con límite estricto: cada consulta cuesta tokens de IA.
// Si llega el token del cliente, el somelier personaliza según su historial.
@Controller('sommelier')
export class SommelierController {
  constructor(
    private readonly sommelier: SommelierService,
    private readonly jwt: JwtService,
  ) {}

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @Post('charla')
  charlar(@Body() body: { mensajes: MensajeChat[] }, @Headers('authorization') auth?: string) {
    return this.sommelier.charlar(body.mensajes, this.clienteDelToken(auth));
  }

  // El somelier del panel (13/11/2026): la cava entera por local y el pedido
  // del vendedor. Con sesión: lo usan la caja y quien atiende el WhatsApp.
  @Roles('cajero', 'deposito', 'comprador', 'gerente', 'dueno')
  @Get('cava')
  cava() {
    return this.sommelier.cavaPanel();
  }

  @Roles('cajero', 'deposito', 'comprador', 'gerente', 'dueno')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('vendedor')
  vendedor(@Body() body: PedidoVendedor) {
    return this.sommelier.vendedor(body);
  }

  private clienteDelToken(auth?: string): string | undefined {
    const token = auth?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return undefined;
    try {
      const payload: any = this.jwt.verify(token, { secret: process.env.JWT_SECRET });
      return payload?.rol === 'cliente' && payload?.sub ? String(payload.sub) : undefined;
    } catch {
      return undefined;
    }
  }
}
