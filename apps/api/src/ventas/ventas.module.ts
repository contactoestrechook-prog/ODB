import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';
import { NotasVentaService } from './notas-venta.service';
import { supabaseProvider } from '../supabase.provider';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { CajaModule } from '../caja/caja.module';
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';

@Module({
  imports: [FacturacionModule, CajaModule, MercadoPagoModule],
  controllers: [VentasController],
  providers: [VentasService, NotasVentaService, supabaseProvider],
  exports: [VentasService],
})
export class VentasModule {}
