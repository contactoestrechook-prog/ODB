import { Module } from '@nestjs/common';
import { PisoController } from './piso.controller';
import { PisoService } from './piso.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [PisoController],
  providers: [PisoService, supabaseProvider],
  exports: [PisoService],
})
export class PisoModule {}
