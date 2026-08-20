import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import { ProductosAdminService } from './productos-admin.service';
import type { CrearProductoDto, EditarProductoDto } from './productos-admin.service';
import { Roles } from '../auth/decorators';

// Escritura del catálogo: solo staff con poder de decisión sobre surtido
// (backoffice entra por "comprador", que su rol implica)
@Roles('dueno', 'gerente', 'comprador')
@Controller('productos')
export class ProductosAdminController {
  constructor(private readonly servicio: ProductosAdminService) {}

  // POST y no GET a propósito: 'productos/:sku' es público y se comería
  // 'productos/revisar' según el orden en que Nest registre las rutas
  @Post('revisar')
  revisar(@Body() dto: { codigo?: string; nombre?: string }) {
    return this.servicio.revisar(dto ?? {});
  }

  @Post()
  crear(@Body() dto: CrearProductoDto, @Req() req: any) {
    return this.servicio.crear(dto, req.usuario?.sub);
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: EditarProductoDto, @Req() req: any) {
    return this.servicio.editar(id, dto, req.usuario?.sub);
  }
}
