import { Module } from '@nestjs/common';
import { ListasVentaController } from './listas-venta.controller';
import { ListasVentaService } from './listas-venta.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ListasVentaController],
  providers: [ListasVentaService, supabaseProvider],
})
export class ListasVentaModule {}
