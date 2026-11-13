import { Module } from '@nestjs/common';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';
import { PisoModule } from '../piso/piso.module';
import { DerivadoresModule } from '../derivadores/derivadores.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [PisoModule, DerivadoresModule],
  controllers: [ReservasController],
  providers: [ReservasService, supabaseProvider],
  exports: [ReservasService],
})
export class ReservasModule {}
