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
  // CharlaAPedidoService: también lo usa «Pasar a pedido» de los presupuestos (25/11/2026)
  exports: [PedidosService, CharlaAPedidoService],
})
export class PedidosModule {}
