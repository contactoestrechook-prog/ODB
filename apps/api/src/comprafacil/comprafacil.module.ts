import { Module } from '@nestjs/common';
import { CompraFacilController } from './comprafacil.controller';
import { CompraFacilService } from './comprafacil.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CompraFacilController],
  providers: [CompraFacilService, supabaseProvider],
})
export class CompraFacilModule {}
