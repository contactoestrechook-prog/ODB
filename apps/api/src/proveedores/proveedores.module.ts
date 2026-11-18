import { Module } from '@nestjs/common';
import { ProveedoresFichaController } from './proveedores-ficha.controller';
import { ProveedoresFichaService } from './proveedores-ficha.service';
import { LogosSemanalService } from './logos-semanal.service';
import { ProveedorDeProductoController } from './proveedor-de-producto.controller';
import { ProveedorDeProductoService } from './proveedor-de-producto.service';
import { supabaseProvider } from '../supabase.provider';
import { PedidosProveedorModule } from '../pedidos-proveedor/pedidos-proveedor.module';

@Module({
  // el WhatsApp del proveedor se verifica con la misma función de «Por llegar»
  imports: [PedidosProveedorModule],
  // el proveedor de cada producto y el cambio desde cualquier pantalla (18/11/2026)
  controllers: [ProveedoresFichaController, ProveedorDeProductoController],
  providers: [ProveedoresFichaService, LogosSemanalService, ProveedorDeProductoService, supabaseProvider],
})
export class ProveedoresModule {}
