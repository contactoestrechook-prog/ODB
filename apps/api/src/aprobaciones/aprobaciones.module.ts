import { Module } from '@nestjs/common';
import { AprobacionesController } from './aprobaciones.controller';
import { ComprasModule } from '../compras/compras.module';
import { VentasModule } from '../ventas/ventas.module';
import { PedidosProveedorModule } from '../pedidos-proveedor/pedidos-proveedor.module';
import { supabaseProvider } from '../supabase.provider';

@Module({ imports: [ComprasModule, VentasModule, PedidosProveedorModule], controllers: [AprobacionesController], providers: [supabaseProvider] })
export class AprobacionesModule {}
