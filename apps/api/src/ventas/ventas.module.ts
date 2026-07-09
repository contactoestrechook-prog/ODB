import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';
import { supabaseProvider } from '../supabase.provider';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [FacturacionModule, CajaModule],
  controllers: [VentasController],
  providers: [VentasService, supabaseProvider],
})
export class VentasModule {}
