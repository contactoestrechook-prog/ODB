import { Module } from '@nestjs/common';
import { TableroController } from './tablero.controller';
import { TableroService } from './tablero.service';
import { AnalistaModule } from '../analista/analista.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [AnalistaModule],
  controllers: [TableroController],
  providers: [TableroService, supabaseProvider],
  exports: [TableroService],
})
export class TableroModule {}
