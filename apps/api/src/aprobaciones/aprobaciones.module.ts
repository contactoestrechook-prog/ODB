import { Module } from '@nestjs/common';
import { AprobacionesController } from './aprobaciones.controller';
import { ComprasModule } from '../compras/compras.module';
import { VentasModule } from '../ventas/ventas.module';
import { supabaseProvider } from '../supabase.provider';

@Module({ imports: [ComprasModule, VentasModule], controllers: [AprobacionesController], providers: [supabaseProvider] })
export class AprobacionesModule {}
