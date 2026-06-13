import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { DifusionesService } from './difusiones.service';
import { Roles } from '../auth/decorators';

@Roles('dueno', 'gerente')
@Controller('difusiones')
export class DifusionesController {
  constructor(private readonly difusiones: DifusionesService) {}

  @Get()
  listar() {
    return this.difusiones.listar();
  }

  @Get('audiencia')
  audiencia(@Query('segmento') segmento?: string, @Query('soloComunidad') soloComunidad?: string) {
    return this.difusiones.audiencia({ segmento: segmento || undefined, soloComunidad: soloComunidad === 'true' });
  }

  @Post('redactar')
  redactar(@Body() body: { contexto?: string }) {
    return this.difusiones.redactar(body?.contexto ?? '');
  }

  @Post()
  crear(@Body() dto: any, @Req() req: any) {
    return this.difusiones.crear({ ...dto, usuarioId: req.usuario?.sub });
  }
}
