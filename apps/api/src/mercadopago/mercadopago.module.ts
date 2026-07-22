import { Module } from '@nestjs/common';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [MercadoPagoController],
  providers: [MercadoPagoService, supabaseProvider],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
