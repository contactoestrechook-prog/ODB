import { Module } from '@nestjs/common';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { supabaseProvider } from '../supabase.provider';
import { PisoModule } from '../piso/piso.module';

@Module({
  imports: [PisoModule],
  controllers: [MesasController],
  providers: [MesasService, supabaseProvider],
  exports: [MesasService],
})
export class MesasModule {}
