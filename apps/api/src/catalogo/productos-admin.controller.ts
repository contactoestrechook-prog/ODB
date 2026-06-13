import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import { ProductosAdminService } from './productos-admin.service';
import type { CrearProductoDto, EditarProductoDto } from './productos-admin.service';
import { Roles } from '../auth/decorators';

// Escritura del catálogo: solo staff con poder de decisión sobre surtido
@Roles('dueno', 'gerente', 'comprador')
@Controller('productos')
export class ProductosAdminController {
  constructor(private readonly servicio: ProductosAdminService) {}

  @Post()
  crear(@Body() dto: CrearProductoDto, @Req() req: any) {
    return this.servicio.crear(dto, req.usuario?.sub);
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: EditarProductoDto, @Req() req: any) {
    return this.servicio.editar(id, dto, req.usuario?.sub);
  }
}
