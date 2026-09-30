import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, supabaseProvider],
})
export class ClientesModule {}
