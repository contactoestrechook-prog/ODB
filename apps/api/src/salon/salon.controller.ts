import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { SalonService } from './salon.service';

// Op salón (5/11/2026): stock con ubicación, ingreso por puerta trasera y armado
// de pedidos asignados. Ver salon.service.ts.
@Controller('salon')
export class SalonController {
  constructor(private readonly salon: SalonService) {}

  // --- stock y ubicación ---
  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Get('stock')
  stock(@Query('q') q: string) {
    return this.salon.buscarStock(q);
  }

  @Roles('op_salon', 'deposito', 'gerente', 'dueno')
  @Patch('ubicacion')
  ubicacion(@Body() dto: any, @Req() req: any) {
    return this.salon.guardarUbicacion(dto ?? {}, req.usuario?.sub);
  }

  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Get('codigo/:codigo')
  codigo(@Param('codigo') codigo: string) {
    return this.salon.codigo(codigo);
  }

  // --- puerta trasera: el salón lo carga, administración confirma con la factura ---
  @Roles('op_salon', 'deposito', 'gerente', 'dueno')
  @Post('ingresos')
  crearIngreso(@Body() dto: any, @Req() req: any) {
    return this.salon.crearIngreso(dto ?? {}, req.usuario?.sub);
  }

  @Roles('op_salon', 'deposito', 'comprador', 'gerente', 'dueno')
  @Get('ingresos')
  ingresos(@Query('estado') estado?: string) {
    return this.salon.ingresos(estado || 'espera_factura');
  }

  // administrativo entra por herencia (comprador)
  @Roles('comprador', 'gerente', 'dueno')
  @Post('ingresos/:id/confirmar')
  confirmar(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.salon.confirmarIngreso(id, dto ?? {}, req.usuario?.sub);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('ingresos/:id/rechazar')
  rechazar(@Param('id') id: string, @Body() dto: { motivo?: string }, @Req() req: any) {
    return this.salon.rechazarIngreso(id, dto?.motivo ?? '', req.usuario?.sub);
  }

  // --- armado de pedidos ---
  @Roles('cajero', 'deposito', 'gerente', 'dueno', 'op_salon')
  @Get('preparadores')
  preparadores() {
    return this.salon.preparadores();
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post('pedidos/:id/asignar')
  asignar(@Param('id') id: string, @Body() dto: { usuarioId?: string }, @Req() req: any) {
    return this.salon.asignar(id, String(dto?.usuarioId ?? ''), req.usuario ?? {});
  }

  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Get('pedidos')
  misPedidos(@Query('todos') todos: string, @Req() req: any) {
    return this.salon.misPedidos(req.usuario ?? {}, todos === '1');
  }

  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Post('pedidos/:id/carro')
  sumar(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.salon.sumarAlCarro(id, dto ?? {}, req.usuario ?? {});
  }

  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Delete('pedidos/:id/carro/:carga')
  sacar(@Param('id') id: string, @Param('carga') carga: string, @Req() req: any) {
    return this.salon.sacarDelCarro(id, carga, req.usuario ?? {});
  }

  @Roles('op_salon', 'deposito', 'cajero', 'gerente', 'dueno')
  @Post('pedidos/:id/terminar')
  terminar(@Param('id') id: string, @Req() req: any) {
    return this.salon.terminar(id, req.usuario ?? {});
  }

  @Roles('gerente', 'dueno')
  @Get('tiempos')
  tiempos(@Query('dias') dias?: string) {
    return this.salon.tiempos(Number(dias) || 7);
  }
}
