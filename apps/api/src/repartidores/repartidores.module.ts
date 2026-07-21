import { Module } from '@nestjs/common';
import { RepartidoresController } from './repartidores.controller';
import { RepartidoresService } from './repartidores.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [RepartidoresController],
  providers: [RepartidoresService, supabaseProvider],
})
export class RepartidoresModule {}
