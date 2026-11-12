import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { supabaseProvider } from '../supabase.provider';

// exporta el servicio: el manual manda por acá lo que el sistema no tiene (10/11/2026)
@Module({ controllers: [ReportesController], providers: [ReportesService, supabaseProvider], exports: [ReportesService] })
export class ReportesModule {}
