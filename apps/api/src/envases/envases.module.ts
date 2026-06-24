import { Module } from '@nestjs/common';
import { EnvasesController } from './envases.controller';
import { EnvasesService } from './envases.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [EnvasesController],
  providers: [EnvasesService, supabaseProvider],
})
export class EnvasesModule {}
