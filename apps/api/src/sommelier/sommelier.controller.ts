import { Body, Controller, Post } from '@nestjs/common';
import { SommelierService } from './sommelier.service';
import type { MensajeChat } from './sommelier.service';
import { Publico } from '../auth/decorators';

// Público: es la cara del somelier en la app del cliente.
// TODO(produccion): rate limit por IP/dispositivo.
@Controller('sommelier')
export class SommelierController {
  constructor(private readonly sommelier: SommelierService) {}

  @Publico()
  @Post('charla')
  charlar(@Body() body: { mensajes: MensajeChat[] }) {
    return this.sommelier.charlar(body.mensajes);
  }
}
