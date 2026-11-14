import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { CharlaAPedidoController } from './charla-a-pedido.controller';
import { CharlaAPedidoService } from './charla-a-pedido.service';
import { MensajesModule } from '../mensajes/mensajes.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [MensajesModule],
  controllers: [CharlaAPedidoController, PedidosController],
  providers: [PedidosService, CharlaAPedidoService, supabaseProvider],
  exports: [PedidosService],
})
export class PedidosModule {}
