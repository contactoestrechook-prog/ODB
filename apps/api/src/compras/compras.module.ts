import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { MesaComprasService } from './mesa-compras.service';
import { ComprasService } from './compras.service';
import { supabaseProvider } from '../supabase.provider';
import { ListasModule } from '../listas/listas.module';

@Module({
  imports: [ListasModule],
  controllers: [ComprasController],
  providers: [MesaComprasService, ComprasService, supabaseProvider],
  // la bandeja única de aprobaciones despacha a estos mismos circuitos
  exports: [ComprasService, MesaComprasService],
})
export class ComprasModule {}
