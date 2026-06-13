import { Module } from '@nestjs/common';
import { DifusionesController } from './difusiones.controller';
import { DifusionesService } from './difusiones.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [DifusionesController],
  providers: [DifusionesService, supabaseProvider],
})
export class DifusionesModule {}
