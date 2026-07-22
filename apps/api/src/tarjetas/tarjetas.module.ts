import { Module } from '@nestjs/common';
import { TarjetasController } from './tarjetas.controller';
import { TarjetasService } from './tarjetas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [TarjetasController],
  providers: [TarjetasService, supabaseProvider],
})
export class TarjetasModule {}
