import { Module } from '@nestjs/common';
import { MensajesController } from './mensajes.controller';
import { MisSolicitudesController } from './mis-solicitudes.controller';
import { MensajesService } from './mensajes.service';
import { NotificarService } from './notificar.service';
import { AutomaticasService } from './automaticas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [MensajesController, MisSolicitudesController],
  providers: [MensajesService, NotificarService, AutomaticasService, supabaseProvider],
  exports: [NotificarService],
})
export class MensajesModule {}
