import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ComprasController],
  providers: [ComprasService, supabaseProvider],
})
export class ComprasModule {}
