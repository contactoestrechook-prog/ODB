import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { supabaseProvider } from '../supabase.provider';

@Module({ controllers: [ReportesController], providers: [ReportesService, supabaseProvider] })
export class ReportesModule {}
