import { Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CatalogoService } from './catalogo.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ImagenesController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Post('productos/:sku/imagen')
  @UseInterceptors(FileInterceptor('imagen'))
  subir(@Param('sku') sku: string, @UploadedFile() imagen: Express.Multer.File) {
    return this.catalogo.subirImagen(sku, imagen);
  }
}
