import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SommelierService } from './sommelier.service';
import type { MensajeChat } from './sommelier.service';
import { Publico } from '../auth/decorators';

// Público pero con límite estricto: cada consulta cuesta tokens de IA
@Controller('sommelier')
export class SommelierController {
  constructor(private readonly sommelier: SommelierService) {}

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @Post('charla')
  charlar(@Body() body: { mensajes: MensajeChat[] }) {
    return this.sommelier.charlar(body.mensajes);
  }
}
