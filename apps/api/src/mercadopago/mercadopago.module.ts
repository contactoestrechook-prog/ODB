import { Module } from '@nestjs/common';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';
import { MpReportesService } from './mp-reportes.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [MercadoPagoController],
  providers: [MercadoPagoService, MpReportesService, supabaseProvider],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
