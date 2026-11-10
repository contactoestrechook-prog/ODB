import { Module } from '@nestjs/common';
import { ReportesModule } from '../reportes/reportes.module';
import { ManualController } from './manual.controller';
import { ManualService } from './manual.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [ReportesModule],
  controllers: [ManualController],
  providers: [ManualService, supabaseProvider],
})
export class ManualModule {}
