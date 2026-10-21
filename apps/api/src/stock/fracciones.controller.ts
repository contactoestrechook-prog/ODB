import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { FraccionesService } from './fracciones.service';
import type { CargarPozoDto, EditarPresentacionDto, VincularDto } from './fracciones.service';

// Pantalla Fraccionar (21/10/2026). Armar y abrir: todo el personal del local
// (como antes). Cargar el pozo: los mismos roles que un ajuste de stock, con
// el mismo PIN de supervisor. Configurar el grupo (sumar, editar, quitar
// presentaciones): solo gerencia y dueño.
@Roles('cajero', 'deposito', 'gerente', 'dueno')
@Controller('stock')
export class FraccionesController {
  constructor(private readonly fracciones: FraccionesService) {}

  @Get('fraccionables')
  listar(@Req() req: any) {
    return this.fracciones.listar(req?.usuario?.rol);
  }

  @Get('fraccionables/historial')
  historial(@Query('sucursalId') sucursalId: string, @Query('limite') limite?: string) {
    return this.fracciones.historial(sucursalId, limite ? Number(limite) : undefined);
  }

  @Post('fraccionar')
  fraccionar(@Body() body: { destinoId: string; cantidad: number; sucursalId: string }, @Req() req: any) {
    return this.fracciones.fraccionar(body, req?.usuario?.sub);
  }

  // Igual que POST /stock/ajustes: gerencia y dueño se autorizan solos; el
  // resto (depósito, y administrativo que hereda depósito) necesita el token
  // de un solo uso de /caja/autorizar si la carga supera el tope. Nunca se
  // confía en un autorizadoPor que mande el cliente.
  @Roles('deposito', 'gerente', 'dueno')
  @Post('fraccionables/:pozoId/cargar')
  cargarPozo(@Param('pozoId') pozoId: string, @Body() dto: CargarPozoDto, @Req() req: any) {
    const rol = req?.usuario?.rol;
    const autorizadoPor = rol === 'gerente' || rol === 'dueno' ? req.usuario.sub : undefined;
    return this.fracciones.cargarPozo(pozoId, dto ?? ({} as CargarPozoDto), autorizadoPor, req?.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('fraccionables/presentaciones')
  vincular(@Body() dto: VincularDto, @Req() req: any) {
    return this.fracciones.vincular(dto ?? ({} as VincularDto), req?.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Patch('fraccionables/presentaciones/:id')
  editar(@Param('id') id: string, @Body() dto: EditarPresentacionDto, @Req() req: any) {
    return this.fracciones.editar(id, dto ?? {}, req?.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('fraccionables/presentaciones/:id/quitar')
  quitar(@Param('id') id: string, @Req() req: any) {
    return this.fracciones.quitar(id, req?.usuario?.sub);
  }
}
