import { Module } from '@nestjs/common';
import { BalanzasController } from './balanzas.controller';
import { BalanzasService } from './balanzas.service';
import { supabaseProvider } from '../supabase.provider';

// Balanzas Kretz: la lista de PLU con precio para iTegra (11/11/2026)
@Module({
  controllers: [BalanzasController],
  providers: [BalanzasService, supabaseProvider],
})
export class BalanzasModule {}
