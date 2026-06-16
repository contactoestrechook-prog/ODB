import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { ImagenesController } from './imagenes.controller';
import { ProductosAdminController } from './productos-admin.controller';
import { CatalogoService } from './catalogo.service';
import { ProductosAdminService } from './productos-admin.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CatalogoController, ImagenesController, ProductosAdminController],
  providers: [CatalogoService, ProductosAdminService, supabaseProvider],
  exports: [CatalogoService],
})
export class CatalogoModule {}
