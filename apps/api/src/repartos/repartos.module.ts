import { Module } from '@nestjs/common';
import { RepartosController } from './repartos.controller';
import { RepartosService } from './repartos.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [RepartosController],
  providers: [RepartosService, supabaseProvider],
})
export class RepartosModule {}
