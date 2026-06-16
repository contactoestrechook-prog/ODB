import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PromosService } from './promos.service';
import { Roles } from '../auth/decorators';

const IA = { default: { ttl: 60_000, limit: 8 } };

// Submódulos inteligentes de Promociones
@Roles('dueno', 'gerente')
@Controller('promos')
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get('segun-stock')
  segunStock() {
    return this.promos.segunStock();
  }

  @Throttle(IA)
  @Post('sugerir')
  sugerir() {
    return this.promos.sugerir();
  }

  @Throttle(IA)
  @Post('contexto')
  contexto(@Body() body: { contexto?: string }) {
    return this.promos.porContexto(body?.contexto ?? '');
  }

  @Get('rendimiento')
  rendimiento() {
    return this.promos.rendimiento();
  }

  @Throttle(IA)
  @Post('anuncio')
  anuncio(@Body() body: { nombre?: string; descripcion?: string; segmento?: string; red?: string }) {
    return this.promos.anuncio(body ?? {});
  }
}
