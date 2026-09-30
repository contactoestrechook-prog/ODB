import { Module } from '@nestjs/common';
import { ResenasController } from './resenas.controller';
import { ResenasService } from './resenas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ResenasController],
  providers: [ResenasService, supabaseProvider],
  exports: [ResenasService],
})
export class ResenasModule {}
