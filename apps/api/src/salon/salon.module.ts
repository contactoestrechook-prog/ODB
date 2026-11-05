import { Module } from '@nestjs/common';
import { SalonController } from './salon.controller';
import { SalonService } from './salon.service';
import { supabaseProvider } from '../supabase.provider';
import { ComprasModule } from '../compras/compras.module';
import { PedidosModule } from '../pedidos/pedidos.module';

// Op salón: stock con ubicación, puerta de depósito y armado de pedidos (5/11/2026)
@Module({
  imports: [ComprasModule, PedidosModule],
  controllers: [SalonController],
  providers: [SalonService, supabaseProvider],
})
export class SalonModule {}
