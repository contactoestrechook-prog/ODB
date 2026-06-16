import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { FidelizacionService } from './fidelizacion.service';

// Todo lo que el cliente ve/usa de su fidelización en la app (token rol 'cliente').
@Roles('cliente')
@Controller('mi')
export class FidelizacionController {
  constructor(private readonly fid: FidelizacionService) {}

  @Get('compras')
  compras(@Req() req: any) {
    return this.fid.compras(req.usuario.sub);
  }

  @Get('frecuentes')
  frecuentes(@Req() req: any) {
    return this.fid.frecuentes(req.usuario.sub);
  }

  @Get('favoritos')
  favoritos(@Req() req: any) {
    return this.fid.favoritos(req.usuario.sub);
  }

  @Post('favoritos/:productoId')
  toggleFavorito(@Req() req: any, @Param('productoId') productoId: string) {
    return this.fid.toggleFavorito(req.usuario.sub, productoId);
  }

  @Get('puntos')
  puntos(@Req() req: any) {
    return this.fid.puntos(req.usuario.sub);
  }

  @Post('puntos/canjear')
  canjear(@Req() req: any, @Body() body: { recompensaId?: string }) {
    if (!body?.recompensaId) throw new BadRequestException('Falta la recompensa');
    return this.fid.canjear(req.usuario.sub, body.recompensaId);
  }

  @Get('avisos')
  avisos(@Req() req: any) {
    return this.fid.avisos(req.usuario.sub);
  }

  @Post('avisos/:productoId')
  suscribirAviso(@Req() req: any, @Param('productoId') productoId: string) {
    return this.fid.suscribirAviso(req.usuario.sub, productoId);
  }

  @Get('referidos')
  referidos(@Req() req: any) {
    return this.fid.referidos(req.usuario.sub);
  }
}
