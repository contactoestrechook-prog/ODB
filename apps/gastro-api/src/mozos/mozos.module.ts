import { Module } from '@nestjs/common';
import { MozosController } from './mozos.controller';
import { MozosService } from './mozos.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [MozosController],
  providers: [MozosService, supabaseProvider],
})
export class MozosModule {}
