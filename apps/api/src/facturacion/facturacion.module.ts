import { Module } from '@nestjs/common';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [FacturacionController],
  providers: [FacturacionService, supabaseProvider],
})
export class FacturacionModule {}
