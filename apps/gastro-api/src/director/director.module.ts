import { Module } from '@nestjs/common';
import { DirectorController } from './director.controller';
import { DirectorService } from './director.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [DirectorController],
  providers: [DirectorService, supabaseProvider],
})
export class DirectorModule {}
