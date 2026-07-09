import { BadRequestException, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CatalogoService } from './catalogo.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ImagenesController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Roles('comprador', 'gerente', 'dueno')
  @Post('productos/:sku/imagen')
  @UseInterceptors(
    FileInterceptor('imagen', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, archivo, cb) => cb(null, /^image\//.test(archivo.mimetype)),
    }),
  )
  subir(@Param('sku') sku: string, @UploadedFile() imagen: Express.Multer.File) {
    if (!imagen) throw new BadRequestException('Subí una imagen (máx. 8MB)');
    return this.catalogo.subirImagen(sku, imagen);
  }
}
