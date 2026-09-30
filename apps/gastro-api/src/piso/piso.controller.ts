import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PisoService } from './piso.service';

// Todo admin-only: lo usan el panel de Damián y la PWA del mozo (ambos entran
// con x-admin-key — ver AdminKeyGuard). Nada acá es público.
@Controller('admin')
export class PisoController {
  constructor(private readonly piso: PisoService) {}

  @Get('piso-vivo')
  pisoVivo() {
    return this.piso.pisoVivo();
  }

  @Post('mesas/:mesaId/abrir')
  abrir(@Param('mesaId') mesaId: string, @Body() body: { cubiertos?: number; mozoId?: string }) {
    return this.piso.abrir(mesaId, body?.cubiertos, body?.mozoId);
  }

  @Post('mesas/:mesaId/avanzar')
  avanzar(@Param('mesaId') mesaId: string, @Body() body?: { monto?: number }) {
    return this.piso.avanzar(mesaId, body?.monto);
  }

  @Post('mesas/:mesaId/llamado-atendido')
  llamadoAtendido(@Param('mesaId') mesaId: string) {
    return this.piso.llamadoAtendido(mesaId);
  }
}
