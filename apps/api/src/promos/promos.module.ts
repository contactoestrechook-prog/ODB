import { Module } from '@nestjs/common';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';
import { AnalistaService } from '../analista/analista.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [PromosController],
  providers: [PromosService, AnalistaService, supabaseProvider],
})
export class PromosModule {}
