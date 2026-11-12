import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { TraspasosService } from './traspasos.service';

// TRASPASOS ENTRE LOCALES (10/11/2026). Lo usan cajeros, depósito,
// administración, gerencia y dueños; el repartidor ve lo que lleva y marca la
// entrega. Las diferencias las decide gerencia o un dueño.
const OPERAN = ['cajero', 'deposito', 'administrativo', 'gerente', 'dueno'] as const;

@Controller('traspasos')
export class TraspasosController {
  constructor(private readonly traspasos: TraspasosService) {}

  @Roles(...OPERAN)
  @Get()
  listar(@Req() req: any, @Query('dias') dias?: string) {
    return this.traspasos.listar(req.usuario ?? {}, Number(dias) || 60);
  }

  @Roles(...OPERAN)
  @Get('sugerencias')
  sugerencias(@Query('origen') origen: string, @Query('destino') destino: string) {
    return this.traspasos.sugerencias(origen, destino);
  }

  @Roles(...OPERAN, 'repartidor')
  @Get('para-llevar')
  paraLlevar(@Req() req: any) {
    return this.traspasos.paraLlevar(req.usuario ?? {});
  }

  @Roles(...OPERAN)
  @Get(':id')
  uno(@Param('id') id: string) {
    return this.traspasos.uno(id);
  }

  @Roles(...OPERAN)
  @Get(':id/remito')
  async remito(@Param('id') id: string, @Req() req: any, @Res() res: any) {
    const pdf = await this.traspasos.remito(id, req.usuario?.sub);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="traspaso-${id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  }

  @Roles(...OPERAN)
  @Post('pedir')
  pedir(@Req() req: any, @Body() b: any) {
    return this.traspasos.pedir(req.usuario ?? {}, b);
  }

  // sin pedido: de un local al otro
  @Roles(...OPERAN)
  @Post('enviar')
  enviarSinPedido(@Req() req: any, @Body() b: any) {
    return this.traspasos.enviar(req.usuario ?? {}, null, b);
  }

  @Roles(...OPERAN)
  @Post(':id/enviar')
  enviar(@Param('id') id: string, @Req() req: any, @Body() b: any) {
    return this.traspasos.enviar(req.usuario ?? {}, id, b);
  }

  @Roles(...OPERAN, 'repartidor')
  @Post(':id/entregado')
  entregado(@Param('id') id: string, @Req() req: any) {
    return this.traspasos.entregado(req.usuario ?? {}, id);
  }

  @Roles(...OPERAN)
  @Post(':id/recibir')
  recibir(@Param('id') id: string, @Req() req: any, @Body() b: any) {
    return this.traspasos.recibir(req.usuario ?? {}, id, b ?? {});
  }

  @Roles('gerente', 'dueno')
  @Post(':id/resolver')
  resolver(@Param('id') id: string, @Req() req: any, @Body() b: any) {
    return this.traspasos.resolver(req.usuario ?? {}, id, b ?? {});
  }

  @Roles(...OPERAN)
  @Post(':id/anular')
  anular(@Param('id') id: string, @Req() req: any, @Body() b: { motivo?: string }) {
    return this.traspasos.anular(req.usuario ?? {}, id, b?.motivo ?? '');
  }
}
