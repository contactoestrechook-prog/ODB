import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [InventarioController],
  providers: [InventarioService, supabaseProvider],
})
export class InventarioModule {}
