import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { FacturaChatController } from './factura-chat.controller';
import { FacturaChatService } from './factura-chat.service';
import { MesaComprasService } from './mesa-compras.service';
import { ComprasService } from './compras.service';
import { supabaseProvider } from '../supabase.provider';
import { ListasModule } from '../listas/listas.module';

@Module({
  imports: [ListasModule],
  controllers: [ComprasController, FacturaChatController],
  providers: [MesaComprasService, ComprasService, FacturaChatService, supabaseProvider],
  // la bandeja única de aprobaciones despacha a estos mismos circuitos
  exports: [ComprasService, MesaComprasService],
})
export class ComprasModule {}
