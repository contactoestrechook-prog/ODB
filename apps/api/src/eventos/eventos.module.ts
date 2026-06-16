import { Module } from '@nestjs/common';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';
import { MensajesModule } from '../mensajes/mensajes.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [MensajesModule],
  controllers: [EventosController],
  providers: [EventosService, supabaseProvider],
})
export class EventosModule {}
