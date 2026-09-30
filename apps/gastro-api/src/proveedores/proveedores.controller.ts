import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ProveedoresService } from './proveedores.service';

@Controller('admin/proveedores')
export class ProveedoresController {
  constructor(private readonly proveedores: ProveedoresService) {}

  @Get()
  listar() {
    return this.proveedores.listar();
  }

  @Post()
  crear(@Body() body: { nombre: string; cuit?: string }) {
    return this.proveedores.crear(body.nombre, body.cuit);
  }

  @Get('compras')
  listarCompras() {
    return this.proveedores.listarCompras();
  }

  @Post('compras')
  crearCompra(
    @Body() body: { proveedorId: string; numeroComprobante?: string; fecha: string; subtotal?: number; iva105?: number; iva21?: number; total: number },
  ) {
    return this.proveedores.crearCompra(body);
  }

  @Post('compras/:id/items')
  agregarItem(@Param('id') id: string, @Body() body: { descripcion: string; cantidad?: number; precioUnitario?: number; total?: number }) {
    return this.proveedores.agregarItem(id, body);
  }

  @Delete('compras/items/:itemId')
  eliminarItem(@Param('itemId') itemId: string) {
    return this.proveedores.eliminarItem(itemId);
  }

  @Get('variaciones')
  variaciones() {
    return this.proveedores.variaciones();
  }
}
