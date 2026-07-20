import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { VentasService } from './ventas.service';
import type { CrearVentaDto, DevolverDto } from './ventas.service';
import { Roles } from '../auth/decorators';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Roles('cajero', 'gerente', 'dueno')
  @Post()
  registrar(@Body() dto: CrearVentaDto, @Req() req: any) {
    const rol = req.usuario?.rol;
    // El descuento manual nunca confía en un "autorizadoPor" que mande el
    // cliente: gerencia se autoriza con su propia sesión, el cajero necesita
    // el token de PIN de un solo uso (ver /caja/autorizar).
    let autorizadoPor: string | undefined;
    if ((dto.descuentoExtra ?? 0) > 0) {
      if (rol !== 'cajero') {
        autorizadoPor = req.usuario?.sub;
      } else if (!dto.autorizacionToken) {
        throw new ForbiddenException('El descuento manual requiere autorización de un supervisor (PIN)');
      }
    }
    // la venta queda a nombre del cajero logueado, SIEMPRE tomado del JWT
    // (nunca del usuarioId del body: si no, un cajero podría atribuir su venta
    // a otro empleado y ensuciar el arqueo por cajero).
    return this.ventas.registrar({ ...dto, autorizadoPor, usuarioId: req.usuario?.sub });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get()
  listar(
    @Query('limite') limite?: string,
    @Query('estado') estado?: string,
    @Query('sucursalId') sucursalId?: string,
    @Query('medioPago') medioPago?: string,
    @Query('dias') dias?: string,
    @Query('buscar') buscar?: string,
  ) {
    return this.ventas.listar({
      limite: limite ? Number(limite) : undefined,
      estado: estado || undefined,
      sucursalId: sucursalId || undefined,
      medioPago: medioPago || undefined,
      dias: dias ? Number(dias) : undefined,
      buscar: buscar || undefined,
    });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('resumen')
  resumen() {
    return this.ventas.resumenHoy();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('cliente/:dni')
  cliente(@Param('dni') dni: string) {
    return this.ventas.clientePorDni(dni);
  }

  // Anular es sensible: solo gerencia, queda auditado y emite nota de crédito
  @Roles('gerente', 'dueno')
  @Post(':id/anular')
  anular(@Param('id') id: string, @Req() req: any) {
    return this.ventas.anular(id, req.usuario?.sub);
  }

  // Devolución parcial: el cajero necesita la autorización de un supervisor
  // (PIN validado en /caja/autorizar → autorizadoPor); gerencia se autoriza sola.
  @Roles('cajero', 'gerente', 'dueno')
  @Post(':id/devolver')
  devolver(@Param('id') id: string, @Body() dto: DevolverDto, @Req() req: any) {
    const rol = req.usuario?.rol;
    let autorizadoPor: string | undefined;
    if (rol !== 'cajero') {
      autorizadoPor = req.usuario?.sub;
    } else if (!dto.autorizacionToken) {
      throw new ForbiddenException('La devolución requiere autorización de un supervisor (PIN)');
    }
    return this.ventas.devolver(id, { ...dto, autorizadoPor, usuarioId: req.usuario?.sub });
  }
}
