import { Module } from '@nestjs/common';
import { SommelierController } from './sommelier.controller';
import { SommelierService } from './sommelier.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [SommelierController],
  providers: [SommelierService, supabaseProvider],
})
export class SommelierModule {}
