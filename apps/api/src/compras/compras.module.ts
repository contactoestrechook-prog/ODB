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
})
export class ComprasModule {}
