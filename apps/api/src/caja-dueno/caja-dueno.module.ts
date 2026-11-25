import { Module } from '@nestjs/common';
import { CajaDuenoController } from './caja-dueno.controller';
import { CajaDuenoService } from './caja-dueno.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CajaDuenoController],
  providers: [CajaDuenoService, supabaseProvider],
})
export class CajaDuenoModule {}
