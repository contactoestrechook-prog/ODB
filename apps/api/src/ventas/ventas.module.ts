import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [VentasController],
  providers: [VentasService, supabaseProvider],
})
export class VentasModule {}
