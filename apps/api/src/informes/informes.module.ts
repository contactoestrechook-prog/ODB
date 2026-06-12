import { Module } from '@nestjs/common';
import { InformesController } from './informes.controller';
import { InformesService } from './informes.service';
import { AnalistaService } from '../analista/analista.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [InformesController],
  providers: [InformesService, AnalistaService, supabaseProvider],
})
export class InformesModule {}
