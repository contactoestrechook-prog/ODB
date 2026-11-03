import { Module } from '@nestjs/common';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [GpsController],
  providers: [GpsService, supabaseProvider],
})
export class GpsModule {}
