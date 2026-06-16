import { Module } from '@nestjs/common';
import { ComparadorController } from './comparador.controller';
import { ComparadorService } from './comparador.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ComparadorController],
  providers: [ComparadorService, supabaseProvider],
})
export class ComparadorModule {}
