import { Module } from '@nestjs/common';
import { DerivadoresController } from './derivadores.controller';
import { DerivadoresService } from './derivadores.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [DerivadoresController],
  providers: [DerivadoresService, supabaseProvider],
  exports: [DerivadoresService],
})
export class DerivadoresModule {}
