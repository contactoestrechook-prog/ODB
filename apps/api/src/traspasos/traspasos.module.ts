import { Module } from '@nestjs/common';
import { supabaseProvider } from '../supabase.provider';
import { TraspasosController } from './traspasos.controller';
import { TraspasosService } from './traspasos.service';

@Module({
  controllers: [TraspasosController],
  providers: [TraspasosService, supabaseProvider],
})
export class TraspasosModule {}
