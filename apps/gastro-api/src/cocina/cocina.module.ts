import { Module } from '@nestjs/common';
import { CocinaController } from './cocina.controller';
import { CocinaService } from './cocina.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CocinaController],
  providers: [CocinaService, supabaseProvider],
})
export class CocinaModule {}
