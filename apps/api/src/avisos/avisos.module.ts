import { Module } from '@nestjs/common';
import { supabaseProvider } from '../supabase.provider';
import { AvisosController } from './avisos.controller';
import { AvisosPedidosService } from './avisos-pedidos.service';

@Module({
  controllers: [AvisosController],
  providers: [AvisosPedidosService, supabaseProvider],
  exports: [AvisosPedidosService],
})
export class AvisosModule {}
