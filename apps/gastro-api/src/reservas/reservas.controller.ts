import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReservasService } from './reservas.service';
import type { EstadoReserva, ReservaInput } from './reservas.service';
import { Publico } from '../auth/decorators';

@Controller()
export class ReservasController {
  constructor(private readonly reservas: ReservasService) {}

  // Público, con tope propio: guarda datos personales.
  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  @Post('reservas')
  crearPublica(
    @Body() body: { nombre: string; telefono: string; personas: number; fecha: string; hora: string; idioma?: 'es' | 'pt' | 'en'; notas?: string; derivador?: string },
  ) {
    return this.reservas.crearPublica(body);
  }

  @Get('admin/reservas/agenda')
  agenda(@Query('fecha') fecha?: string) {
    return this.reservas.agenda(fecha || undefined);
  }

  @Get('admin/reservas/proximos')
  proximos() {
    return this.reservas.proximosDias(7);
  }

  @Post('admin/reservas')
  crear(@Body() body: ReservaInput) {
    return this.reservas.crear(body);
  }

  @Put('admin/reservas/:id')
  actualizar(@Param('id') id: string, @Body() body: Partial<ReservaInput>) {
    return this.reservas.actualizar(id, body);
  }

  @Post('admin/reservas/:id/estado')
  estado(@Param('id') id: string, @Body() body: { estado: EstadoReserva }) {
    return this.reservas.cambiarEstado(id, body.estado);
  }

  @Post('admin/reservas/:id/sentar')
  sentar(@Param('id') id: string, @Body() body: { mesaId: string; mozoId?: string }) {
    return this.reservas.sentar(id, body.mesaId, body.mozoId);
  }

  @Post('admin/reservas/:id/recordatorio')
  recordatorio(@Param('id') id: string) {
    return this.reservas.recordatorio(id);
  }
}
