import { Module } from '@nestjs/common';
import { EstadisticasController } from './estadisticas.controller';
import { ClientesController } from '../clientes/clientes.controller';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [EstadisticasController, ClientesController],
  providers: [supabaseProvider],
})
export class ExtrasModule {}
