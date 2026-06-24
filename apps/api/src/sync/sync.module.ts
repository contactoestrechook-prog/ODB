import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [SyncController],
  providers: [SyncService, supabaseProvider],
})
export class SyncModule {}
