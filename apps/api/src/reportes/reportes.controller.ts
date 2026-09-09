import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ReportesService } from './reportes.service';
import type { CrearReporteDto } from './reportes.service';

@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  // Cualquier persona logueada puede decir "esto está mal" desde donde esté.
  @Roles('cajero', 'gerente', 'dueno', 'comprador', 'deposito', 'administrativo', 'repartidor')
  @Post()
  crear(@Body() dto: CrearReporteDto, @Req() req: any) {
    return this.reportes.crear(dto ?? ({} as any), req?.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Get()
  listar(@Query('estado') estado?: string) {
    return this.reportes.listar(estado);
  }

  @Roles('dueno')
  @Post(':id/resolver')
  resolver(@Param('id') id: string, @Body() b: { respuesta?: string; estado?: 'resuelto' | 'descartado' | 'en_curso' }, @Req() req: any) {
    return this.reportes.resolver(id, req?.usuario?.sub, b?.respuesta ?? '', b?.estado ?? 'resuelto');
  }
}
