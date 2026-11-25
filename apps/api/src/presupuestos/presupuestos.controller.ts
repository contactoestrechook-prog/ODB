import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { PresupuestosService } from './presupuestos.service';

// Presupuestos (25/11/2026): los arma cualquiera del local. Op salón y fiambrería
// entran solo donde se los nombra (están acá a propósito); el repartidor, no.
const DEL_LOCAL = ['cajero', 'op_salon', 'fiambreria', 'deposito', 'administrativo', 'comprador', 'gerente', 'dueno'] as const;

const id36 = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new BadRequestException('Presupuesto inválido');
  return id;
};

@Roles(...DEL_LOCAL)
@Controller('presupuestos')
export class PresupuestosController {
  constructor(private readonly presupuestos: PresupuestosService) {}

  @Get()
  listar(@Query('filtro') filtro?: string) {
    return this.presupuestos.listar(filtro || 'abiertos');
  }

  // antes de ':id'
  @Get('productos')
  productos(@Query('q') q: string, @Query('sucursalId') sucursalId?: string) {
    return this.presupuestos.buscarProductos(q, sucursalId && /^[0-9a-f-]{36}$/i.test(sucursalId) ? sucursalId : null);
  }

  @Get('sucursales')
  sucursales() {
    return this.presupuestos.sucursales();
  }

  @Get(':id')
  uno(@Param('id') id: string) {
    return this.presupuestos.uno(id36(id));
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: any) {
    const { numero, pdf } = await this.presupuestos.pdf(id36(id));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="presupuesto-odb-${numero}.pdf"` });
    res.send(pdf);
  }

  @Post()
  crear(@Body() dto: any, @Req() req: any) {
    return this.presupuestos.guardar(dto, req.usuario ?? {});
  }

  @Post(':id')
  corregir(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.presupuestos.guardar(dto, req.usuario ?? {}, id36(id));
  }

  @Post(':id/enviar')
  enviar(@Param('id') id: string, @Req() req: any) {
    return this.presupuestos.enviar(id36(id), req.usuario ?? {});
  }

  @Post(':id/pedido')
  pasarAPedido(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.presupuestos.pasarAPedido(id36(id), dto ?? {}, req.usuario ?? {});
  }

  @Post(':id/anular')
  anular(@Param('id') id: string, @Req() req: any) {
    return this.presupuestos.anular(id36(id), req.usuario ?? {});
  }
}
