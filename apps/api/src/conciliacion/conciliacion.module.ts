import { Module } from '@nestjs/common';
import { ConciliacionController } from './conciliacion.controller';
import { ConciliacionService } from './conciliacion.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ConciliacionController],
  providers: [ConciliacionService, supabaseProvider],
})
export class ConciliacionModule {}
