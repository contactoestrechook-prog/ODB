import { Module } from '@nestjs/common';
import { CarneController } from './carne.controller';
import { CarneService } from './carne.service';
import { TableroModule } from '../tablero/tablero.module';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [TableroModule],
  controllers: [CarneController],
  providers: [CarneService, supabaseProvider],
})
export class CarneModule {}
