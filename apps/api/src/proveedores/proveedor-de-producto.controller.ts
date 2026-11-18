import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ProveedorDeProductoService } from './proveedor-de-producto.service';
import { puedeCambiar } from './proveedor-de-producto';

// El proveedor de cada producto y el cambio desde cualquier pantalla
// (18/11/2026). Ver lo ve cualquiera que ve productos (depósito y caja también,
// en Stock y en la ficha); cambiarlo, los que compran: comprador (y
// administración, que lo hereda), gerencia y dueño.
@Controller('proveedor-de-producto')
export class ProveedorDeProductoController {
  constructor(private readonly serv: ProveedorDeProductoService) {}

  @Roles('comprador', 'gerente', 'dueno', 'deposito', 'cajero')
  @Post('actuales')
  async actuales(@Body() b: { refs?: unknown }, @Req() req: any) {
    return { puedeCambiar: puedeCambiar(req.usuario?.rol), actuales: await this.serv.actuales(b?.refs) };
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('proveedores')
  proveedores() {
    return this.serv.proveedores();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Get('de/:proveedorId')
  delProveedor(@Param('proveedorId') proveedorId: string) {
    return this.serv.delProveedor(proveedorId);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('reasignar')
  reasignar(@Body() b: { producto?: unknown; proveedorId?: unknown; pantalla?: unknown }, @Req() req: any) {
    return this.serv.reasignar(b ?? {}, req.usuario?.sub);
  }
}
