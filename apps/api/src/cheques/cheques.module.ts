import { Module } from '@nestjs/common';
import { ChequesController } from './cheques.controller';
import { ChequesService } from './cheques.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ChequesController],
  providers: [ChequesService, supabaseProvider],
})
export class ChequesModule {}
