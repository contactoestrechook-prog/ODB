import { Module } from '@nestjs/common';
import { AvisosCelularController } from './avisos-celular.controller';
import { AvisosCelularService } from './avisos-celular.service';
import { supabaseProvider } from '../supabase.provider';

@Module({ controllers: [AvisosCelularController], providers: [AvisosCelularService, supabaseProvider] })
export class AvisosCelularModule {}
