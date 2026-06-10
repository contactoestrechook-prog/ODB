import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CatalogoController],
  providers: [CatalogoService, supabaseProvider],
})
export class CatalogoModule {}
