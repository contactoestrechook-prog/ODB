import { Module } from '@nestjs/common';
import { AgenteController } from './agente.controller';
import { AgenteService } from './agente.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [AgenteController],
  providers: [AgenteService, supabaseProvider],
})
export class AgenteModule {}
