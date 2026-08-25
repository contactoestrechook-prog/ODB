import { Module } from '@nestjs/common';
import { AprobacionesController } from './aprobaciones.controller';
import { ComprasModule } from '../compras/compras.module';
import { supabaseProvider } from '../supabase.provider';

@Module({ imports: [ComprasModule], controllers: [AprobacionesController], providers: [supabaseProvider] })
export class AprobacionesModule {}
