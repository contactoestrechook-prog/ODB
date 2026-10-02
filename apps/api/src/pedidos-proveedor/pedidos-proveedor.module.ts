import { Module } from '@nestjs/common';
import { PedidosProveedorController } from './pedidos-proveedor.controller';
import { PedidosProveedorService } from './pedidos-proveedor.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [PedidosProveedorController],
  providers: [PedidosProveedorService, supabaseProvider],
  // la bandeja de aprobaciones lo manda apenas se firma
  exports: [PedidosProveedorService],
})
export class PedidosProveedorModule {}
