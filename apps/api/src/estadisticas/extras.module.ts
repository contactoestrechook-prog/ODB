import { Module } from '@nestjs/common';
import { EstadisticasController } from './estadisticas.controller';
import { VencimientosController } from './vencimientos.controller';
import { ClientesController } from '../clientes/clientes.controller';
import { CobranzasController } from '../clientes/cobranzas.controller';
import { AnalistaService } from '../analista/analista.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [EstadisticasController, VencimientosController, ClientesController, CobranzasController],
  providers: [supabaseProvider, AnalistaService],
})
export class ExtrasModule {}
