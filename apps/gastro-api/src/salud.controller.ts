import { Controller, Get } from '@nestjs/common';
import { Publico } from './auth/decorators';

// usado por los health checks del hosting (Railway) y para chequear que el API responde
@Controller()
export class SaludController {
  @Publico()
  @Get(['/', 'salud'])
  salud() {
    return { ok: true, servicio: 'gastro-api', restaurante: 'Gran Caminito', hora: new Date().toISOString() };
  }
}
