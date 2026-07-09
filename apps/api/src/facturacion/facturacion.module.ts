import { Module } from '@nestjs/common';
import { FacturacionController } from './facturacion.controller';
import { MiCuentaController } from './mi-cuenta.controller';
import { FacturacionService } from './facturacion.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [FacturacionController, MiCuentaController],
  providers: [FacturacionService, supabaseProvider],
  // la caja (VentasModule) emite el comprobante fiscal de cada venta
  exports: [FacturacionService],
})
export class FacturacionModule {}
