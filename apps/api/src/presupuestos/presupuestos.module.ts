import { Module } from '@nestjs/common';
import { PresupuestosController } from './presupuestos.controller';
import { PresupuestosService } from './presupuestos.service';
import { PedidosModule } from '../pedidos/pedidos.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [PedidosModule],
  controllers: [PresupuestosController],
  providers: [PresupuestosService, supabaseProvider],
})
export class PresupuestosModule {}
