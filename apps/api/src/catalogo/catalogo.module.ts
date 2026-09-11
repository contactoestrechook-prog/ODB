import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { ImagenesController } from './imagenes.controller';
import { ProductosAdminController } from './productos-admin.controller';
import { CatalogoService } from './catalogo.service';
import { ProductosAdminService } from './productos-admin.service';
import { FotosExternasController } from './fotos-externas.controller';
import { FotosExternasService } from './fotos-externas.service';
import { CalidadFotosService } from './calidad-fotos.service';
import { NormalizarFotosService } from './normalizar-fotos.service';
import { supabaseProvider } from '../supabase.provider';

@Module({
  controllers: [CatalogoController, ImagenesController, ProductosAdminController, FotosExternasController],
  providers: [CatalogoService, ProductosAdminService, FotosExternasService,
    CalidadFotosService, NormalizarFotosService, supabaseProvider],
  exports: [CatalogoService],
})
export class CatalogoModule {}
