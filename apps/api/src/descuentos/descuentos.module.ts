import { Module } from '@nestjs/common';
import { DescuentosController } from './descuentos.controller';
import { DescuentosService } from './descuentos.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [DescuentosController],
  providers: [DescuentosService, supabaseProvider],
})
export class DescuentosModule {}
