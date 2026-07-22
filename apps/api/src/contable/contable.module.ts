import { Module } from '@nestjs/common';
import { ContableController } from './contable.controller';
import { ContableService } from './contable.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ContableController],
  providers: [ContableService, supabaseProvider],
})
export class ContableModule {}
