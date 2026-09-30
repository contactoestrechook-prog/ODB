import { Module } from '@nestjs/common';
import { TermometroController } from './termometro.controller';
import { TermometroService } from './termometro.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [TermometroController],
  providers: [TermometroService, supabaseProvider],
  exports: [TermometroService],
})
export class TermometroModule {}
