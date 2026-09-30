import { Module } from '@nestjs/common';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionService } from './configuracion.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ConfiguracionController],
  providers: [ConfiguracionService, supabaseProvider],
  exports: [ConfiguracionService],
})
export class ConfiguracionModule {}
