import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { VentasService } from './ventas.service';
import { NotasVentaService } from './notas-venta.service';
import type { NotaNueva } from './notas-venta.service';
import type { CrearVentaDto, DevolverDto } from './ventas.service';
import { Roles } from '../auth/decorators';

@Controller('ventas')
export class VentasController {
  constructor(
    private readonly ventas: VentasService,
    private readonly notas: NotasVentaService,
  ) {}

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

  // Todo lo de un ticket para el panel de la caja (renglones, pagos, factura)
  @Roles('cajero', 'gerente', 'dueno')
  @Get(':id/detalle')
  async detalle(@Param('id') id: string) {
    const [d, notas, reimpresiones] = await Promise.all([
      this.ventas.detalle(id),
      this.notas.listar(id),
      this.notas.reimpresiones(id),
    ]);
    return { ...d, notas, reimpresiones };
  }

  // Notas del ticket: escritas o en audio (Leandro, 5/11/2026). Quién la
  // escribió sale SIEMPRE del JWT.
  @Roles('cajero', 'gerente', 'dueno')
  @Post(':id/notas')
  agregarNota(@Param('id') id: string, @Body() dto: NotaNueva, @Req() req: any) {
    return this.notas.agregar(id, dto ?? {}, req.usuario?.sub);
  }

  // Se volvió a imprimir el ticket (falló la impresora, el cliente pidió otro):
  // queda quién y cuándo.
  @Roles('cajero', 'gerente', 'dueno')
  @Post(':id/reimpresion')
  reimpresion(@Param('id') id: string, @Req() req: any) {
    return this.notas.reimpresion(id, req.usuario?.sub);
  }

  // El cliente se arrepintió del medio de pago. Cambia los pagos dejando la
  // venta y su factura intactas. Igual que el descuento y la devolución: el
  // cajero necesita el PIN de un supervisor; gerencia se autoriza sola.
  @Roles('cajero', 'gerente', 'dueno')
  @Post(':id/medio-pago')
  cambiarMedioPago(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    const rol = req.usuario?.rol;
    let autorizadoPor: string | undefined;
    if (rol !== 'cajero') {
      autorizadoPor = req.usuario?.sub;
    } else if (!dto?.autorizacionToken) {
      throw new ForbiddenException('Cambiar el medio de pago requiere autorización de un supervisor (PIN)');
    }
    return this.ventas.cambiarMedioPago(id, { ...(dto ?? {}), autorizadoPor, usuarioId: req.usuario?.sub });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('cliente/:dni')
  cliente(@Param('dni') dni: string) {
    return this.ventas.clientePorDni(dni);
  }

  // El cajero suma el WhatsApp del cliente y su consentimiento en el momento de
  // cobrar. Es el único camino para construir la lista de difusión con permiso.
  @Roles('cajero', 'gerente', 'dueno')
  @Post('cliente/:dni/whatsapp')
  sumarWhatsapp(@Param('dni') dni: string, @Body() dto: { telefono?: string; acepta: boolean }, @Req() req: any) {
    return this.ventas.sumarContactoWhatsapp(dni, dto, req.usuario?.sub);
  }

  // Anular es sensible: solo gerencia, queda auditado y emite nota de crédito
  @Roles('gerente', 'dueno')
  @Post(':id/anular')
  anular(@Param('id') id: string, @Req() req: any) {
    return this.ventas.anular(id, req.usuario?.sub);
  }

  // Sin supervisor en el local: la cajera pide la autorización a distancia y la sigue.
  @Roles('cajero', 'gerente', 'dueno')
  @Post(':id/devolucion-pedir')
  pedirDevolucion(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.ventas.pedirDevolucion(id, { ...(dto ?? {}), usuarioId: req.usuario?.sub });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('devolucion-estado/:id')
  estadoDevolucion(@Param('id') id: string) {
    return this.ventas.estadoDevolucion(id);
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
