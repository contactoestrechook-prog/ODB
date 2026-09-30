import { Module } from '@nestjs/common';
import { CartaController } from './carta.controller';
import { CartaService } from './carta.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CartaController],
  providers: [CartaService, supabaseProvider],
  exports: [CartaService],
})
export class CartaModule {}
