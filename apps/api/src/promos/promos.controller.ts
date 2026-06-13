import { Body, Controller, Get, Post } from '@nestjs/common';
import { PromosService } from './promos.service';
import { Roles } from '../auth/decorators';

// Submódulos inteligentes de Promociones
@Roles('dueno', 'gerente')
@Controller('promos')
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get('segun-stock')
  segunStock() {
    return this.promos.segunStock();
  }

  @Post('sugerir')
  sugerir() {
    return this.promos.sugerir();
  }

  @Post('contexto')
  contexto(@Body() body: { contexto?: string }) {
    return this.promos.porContexto(body?.contexto ?? '');
  }

  @Get('rendimiento')
  rendimiento() {
    return this.promos.rendimiento();
  }

  @Post('anuncio')
  anuncio(@Body() body: { nombre?: string; descripcion?: string; segmento?: string; red?: string }) {
    return this.promos.anuncio(body ?? {});
  }
}
