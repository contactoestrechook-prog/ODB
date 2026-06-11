import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [PedidosController],
  providers: [PedidosService, supabaseProvider],
})
export class PedidosModule {}
