import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ListasService } from './listas.service';
import { Roles } from '../auth/decorators';

@Roles('comprador', 'gerente', 'dueno')
@Controller('listas-precios')
export class ListasController {
  constructor(private readonly listas: ListasService) {}

  @Post('analizar')
  @UseInterceptors(FileInterceptor('archivo'))
  analizar(
    @UploadedFile() archivo: Express.Multer.File,
    @Body('proveedorId') proveedorId: string,
  ) {
    return this.listas.analizar(archivo, proveedorId);
  }

  @Post('aplicar')
  aplicar(@Body() body: { proveedorId: string; items: { sku: string; costo: number }[] }) {
    return this.listas.aplicar(body.proveedorId, body.items);
  }
}
