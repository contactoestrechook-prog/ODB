import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { MensajesModule } from '../mensajes/mensajes.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [MensajesModule],
  controllers: [PedidosController],
  providers: [PedidosService, supabaseProvider],
})
export class PedidosModule {}
