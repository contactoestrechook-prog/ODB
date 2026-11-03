import { Module } from '@nestjs/common';
import { FrioController } from './frio.controller';
import { FrioLector } from './frio.lector';
import { supabaseProvider } from '../supabase.provider';

// Frío: los sensores QBIT de las cámaras y heladeras (3/11/2026)
@Module({
  controllers: [FrioController],
  providers: [FrioLector, supabaseProvider],
})
export class FrioModule {}
