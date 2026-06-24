import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ChequesService } from './cheques.service';
import type { CrearChequeDto } from './cheques.service';
import { Roles } from '../auth/decorators';

// Cartera de cheques: administración la opera; anular queda para gerencia/dueño.
@Roles('cajero', 'gerente', 'dueno')
@Controller('cheques')
export class ChequesController {
  constructor(private readonly servicio: ChequesService) {}

  @Get('resumen')
  resumen() {
    return this.servicio.resumen();
  }

  @Get()
  listar(@Query() q: { tipo?: string; estado?: string; buscar?: string; limite?: string }) {
    return this.servicio.listar({ ...q, limite: q.limite ? Number(q.limite) : undefined });
  }

  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.servicio.detalle(id);
  }

  @Post()
  crear(@Body() dto: CrearChequeDto, @Req() req: any) {
    return this.servicio.crear({ ...dto, usuarioId: req.usuario?.sub });
  }

  @Post(':id/depositar')
  depositar(@Param('id') id: string, @Body() dto: { banco?: string }) {
    return this.servicio.depositar(id, dto);
  }

  @Post(':id/acreditar')
  acreditar(@Param('id') id: string) {
    return this.servicio.acreditar(id);
  }

  @Post(':id/rechazar')
  rechazar(@Param('id') id: string, @Body() dto: { motivo?: string }) {
    return this.servicio.rechazar(id, dto);
  }

  @Post(':id/aplicar')
  aplicar(@Param('id') id: string, @Body() dto: { proveedorId?: string; ordenPagoId?: string }) {
    return this.servicio.aplicar(id, dto);
  }

  @Post(':id/debitar')
  debitar(@Param('id') id: string) {
    return this.servicio.debitar(id);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/anular')
  anular(@Param('id') id: string, @Body() dto: { motivo?: string }) {
    return this.servicio.anular(id, dto);
  }
}
