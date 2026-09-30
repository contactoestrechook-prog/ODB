import { Module } from '@nestjs/common';
import { EsperaController } from './espera.controller';
import { EsperaService } from './espera.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [EsperaController],
  providers: [EsperaService, supabaseProvider],
})
export class EsperaModule {}
