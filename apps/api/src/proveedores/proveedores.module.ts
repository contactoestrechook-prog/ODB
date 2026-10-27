import { Module } from '@nestjs/common';
import { ProveedoresFichaController } from './proveedores-ficha.controller';
import { ProveedoresFichaService } from './proveedores-ficha.service';
import { LogosSemanalService } from './logos-semanal.service';
import { supabaseProvider } from '../supabase.provider';
import { PedidosProveedorModule } from '../pedidos-proveedor/pedidos-proveedor.module';

@Module({
  // el WhatsApp del proveedor se verifica con la misma función de «Por llegar»
  imports: [PedidosProveedorModule],
  controllers: [ProveedoresFichaController],
  providers: [ProveedoresFichaService, LogosSemanalService, supabaseProvider],
})
export class ProveedoresModule {}
