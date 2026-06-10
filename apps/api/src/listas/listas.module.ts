import { Module } from '@nestjs/common';
import { ListasController } from './listas.controller';
import { ListasService } from './listas.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ListasController],
  providers: [ListasService, supabaseProvider],
})
export class ListasModule {}
