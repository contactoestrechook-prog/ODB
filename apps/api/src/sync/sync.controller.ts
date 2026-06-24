import { Controller, Get } from '@nestjs/common';
import { SyncService } from './sync.service';
import { Roles } from '../auth/decorators';

@Roles('deposito', 'cajero', 'gerente', 'dueno')
@Controller('sync')
export class SyncController {
  constructor(private readonly servicio: SyncService) {}

  @Get('estado')
  estado() {
    return this.servicio.estado();
  }
}
