import { Module } from '@nestjs/common';
import { TiendanubeController } from './tiendanube.controller';
import { TiendanubeService } from './tiendanube.service';
import { PedidosModule } from '../pedidos/pedidos.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [PedidosModule],
  controllers: [TiendanubeController],
  providers: [TiendanubeService, supabaseProvider],
})
export class TiendanubeModule {}
