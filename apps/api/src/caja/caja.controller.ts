import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { CajaService } from './caja.service';
import { ArcaService } from './arca.service';
import { Roles } from '../auth/decorators';

@Controller()
export class CajaController {
  constructor(
    private readonly caja: CajaService,
    private readonly arca: ArcaService,
  ) {}

  @Get('caja/resumen')
  resumen() {
    return this.caja.resumen();
  }

  @Get('caja/cajas')
  cajas() {
    return this.caja.cajas();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/abrir')
  abrir(@Body() body: { cajaId: string; montoInicial: number }, @Req() req: any) {
    return this.caja.abrir(body.cajaId, Number(body.montoInicial), req.usuario.sub);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/cerrar')
  cerrar(@Body() body: { sesionId: string; montoCierre: number }) {
    return this.caja.cerrar(body.sesionId, Number(body.montoCierre));
  }

  @Get('caja/sesiones')
  sesiones(@Query('limite') limite?: string) {
    return this.caja.sesiones(limite ? Number(limite) : undefined);
  }

  @Get('arca/pendientes')
  pendientes() {
    return this.arca.pendientes();
  }

  @Roles('gerente', 'dueno')
  @Post('arca/emitir')
  emitir() {
    return this.arca.emitirPendientes();
  }
}
