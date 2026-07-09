import { Module } from '@nestjs/common';
import { ListasController } from './listas.controller';
import { ListasService } from './listas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ListasController],
  providers: [ListasService, supabaseProvider],
  // Compras reutiliza el lector para importar pedidos de portales de proveedor
  exports: [ListasService],
})
export class ListasModule {}
