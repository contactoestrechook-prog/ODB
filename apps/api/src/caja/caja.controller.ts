import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { CajaService } from './caja.service';
import { ArcaService } from './arca.service';
import { Roles } from '../auth/decorators';

@Controller()
export class CajaController {
  constructor(
    private readonly caja: CajaService,
    private readonly arca: ArcaService,
  ) {}

  @Roles('gerente', 'dueno')
  @Get('caja/resumen')
  resumen() {
    return this.caja.resumen();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('caja/cajas')
  cajas() {
    return this.caja.cajas();
  }

  @Roles('gerente', 'dueno')
  @Get('caja/por-cajero')
  porCajero() {
    return this.caja.porCajero();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/abrir')
  abrir(@Body() body: { cajaId: string; montoInicial: number; empleadoId?: string }, @Req() req: any) {
    // La caja se abre a nombre del usuario logueado. Solo gerencia puede abrirla
    // a nombre de otro empleado (turno que arranca alguien más); un cajero no
    // puede endosar su caja a un tercero.
    const rol = req.usuario?.rol;
    const empleadoId = (rol !== 'cajero' && body.empleadoId) ? body.empleadoId : req.usuario.sub;
    return this.caja.abrir(body.cajaId, Number(body.montoInicial), empleadoId);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/cerrar')
  cerrar(@Body() body: { sesionId: string; montoCierre: number }, @Req() req: any) {
    return this.caja.cerrar(body.sesionId, Number(body.montoCierre), req.usuario?.sub, req.usuario?.rol);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('caja/sesiones')
  sesiones(@Query('limite') limite?: string) {
    return this.caja.sesiones(limite ? Number(limite) : undefined);
  }

  // ingreso/retiro de efectivo de la sesión (entra al arqueo)
  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/movimiento')
  movimiento(
    @Body() body: { sesionId: string; tipo: 'ingreso' | 'egreso'; monto: number; motivo: string },
    @Req() req: any,
  ) {
    return this.caja.registrarMovimiento(body, req.usuario?.sub);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('caja/movimientos')
  movimientos(@Query('sesionId') sesionId: string) {
    return this.caja.movimientos(sesionId);
  }

  // el supervisor teclea su PIN en la caja para autorizar descuentos/devoluciones
  @Roles('cajero', 'gerente', 'dueno')
  @Post('caja/autorizar')
  autorizar(@Body() body: { pin: string }) {
    return this.caja.autorizar(body.pin);
  }

  @Roles('gerente', 'dueno')
  @Get('arca/pendientes')
  pendientes() {
    return this.arca.pendientes();
  }

  // Prueba la conexión con ARCA (certificado + WSAA + WSFE) sin emitir nada
  @Roles('gerente', 'dueno')
  @Get('arca/estado')
  estadoArca() {
    return this.arca.estado();
  }

  @Roles('gerente', 'dueno')
  @Post('arca/emitir')
  emitir() {
    return this.arca.emitirPendientes();
  }
}
