import { Module } from '@nestjs/common';
import { AbastecimientoController } from './abastecimiento.controller';
import { AbastecimientoService } from './abastecimiento.service';
import { supabaseProvider } from '../supabase.provider';
import { ComprasModule } from '../compras/compras.module';

@Module({
  imports: [ComprasModule],
  controllers: [AbastecimientoController],
  providers: [AbastecimientoService, supabaseProvider],
})
export class AbastecimientoModule {}
