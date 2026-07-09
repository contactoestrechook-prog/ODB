import { Module } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { ArcaService } from './arca.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CajaController],
  providers: [CajaService, ArcaService, supabaseProvider],
  exports: [CajaService],
})
export class CajaModule {}
