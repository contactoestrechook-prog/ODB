import { Module } from '@nestjs/common';
import { AnalistaController } from './analista.controller';
import { AnalistaService } from './analista.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [AnalistaController],
  providers: [AnalistaService, supabaseProvider],
})
export class AnalistaModule {}
