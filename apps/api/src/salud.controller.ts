import { Controller, Get } from '@nestjs/common';
import { Publico } from './auth/decorators';

@Controller()
export class SaludController {
  // usado por los health checks del hosting (Railway/Render) y el E2E
  @Publico()
  @Get(['/', 'salud'])
  salud() {
    return { ok: true, servicio: 'odb-api', hora: new Date().toISOString() };
  }
}
