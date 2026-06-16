import { Module } from '@nestjs/common';
import { FidelizacionController } from './fidelizacion.controller';
import { FidelizacionService } from './fidelizacion.service';
import { ReposicionTask } from './reposicion.task';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { MensajesModule } from '../mensajes/mensajes.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [CatalogoModule, MensajesModule],
  controllers: [FidelizacionController],
  providers: [FidelizacionService, ReposicionTask, supabaseProvider],
})
export class FidelizacionModule {}
