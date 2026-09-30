import { Module } from '@nestjs/common';
import { ProveedoresController } from './proveedores.controller';
import { ProveedoresService } from './proveedores.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [ProveedoresController],
  providers: [ProveedoresService, supabaseProvider],
})
export class ProveedoresModule {}
