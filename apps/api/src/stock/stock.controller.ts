import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { StockService } from './stock.service';
import type { AjusteDto, TransferenciaDto } from './stock.service';
import { Roles } from '../auth/decorators';

// Quién se autoriza solo en un ajuste, una merma o un conteo grande: gerencia
// y dueño. Cualquier otro rol que llegue (depósito, administrativo por
// herencia) necesita el PIN de un supervisor arriba del tope.
export function autorizaSolo(req: any): string | undefined {
  const rol = req?.usuario?.rol;
  return rol === 'gerente' || rol === 'dueno' ? req.usuario.sub : undefined;
}

// Datos operativos de inventario (valorización, ABC, movimientos): solo staff.
// Las escrituras redefinen roles más estrictos a nivel de método.
@Roles('cajero', 'deposito', 'gerente', 'dueno')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('bajo-minimo')
  bajoMinimo() {
    return this.stock.bajoMinimo();
  }

  @Get('movimientos')
  movimientos(
    @Query('limite') limite?: string,
    @Query('tipo') tipo?: string,
    @Query('sucursalId') sucursalId?: string,
    @Query('sku') sku?: string,
    @Query('dias') dias?: string,
  ) {
    return this.stock.movimientos({
      limite: limite ? Number(limite) : undefined,
      tipo: tipo || undefined,
      sucursalId: sucursalId || undefined,
      sku: sku || undefined,
      dias: dias ? Number(dias) : undefined,
    });
  }

  @Get('resumen')
  resumen() {
    return this.stock.resumen();
  }

  @Get('valorizacion')
  valorizacion() {
    return this.stock.valorizacion();
  }

  @Get('negativos')
  negativos() {
    return this.stock.negativos();
  }

  @Get('abc')
  abc() {
    return this.stock.abc();
  }

  @Get('sin-rotacion')
  sinRotacion(@Query('dias') dias?: string) {
    return this.stock.sinRotacion(dias ? Number(dias) : undefined);
  }

  // Ajustes/mermas grandes exigen PIN de supervisor: gerencia y dueño se
  // autorizan solos; el resto necesita el token de /caja/autorizar (nunca
  // confiar en un autorizadoPor que mande el cliente). "El resto" incluye a
  // administrativo, que entra acá heredando depósito: antes la cuenta era
  // "rol !== 'deposito'" y quedaba autorizado por sí mismo, sin tope ni PIN
  // (21/10/2026).
  @Roles('deposito', 'gerente', 'dueno')
  @Post('ajustes')
  ajuste(@Body() dto: AjusteDto, @Req() req: any) {
    return this.stock.registrarAjuste({ ...dto, autorizadoPor: autorizaSolo(req) }, 'ajuste', req.usuario?.sub);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('mermas')
  merma(@Body() dto: AjusteDto, @Req() req: any) {
    return this.stock.registrarAjuste({ ...dto, autorizadoPor: autorizaSolo(req) }, 'merma', req.usuario?.sub);
  }

  // fraccionables / fraccionar: ver fracciones.controller.ts

  @Get('motivos-merma')
  motivosMerma() {
    return StockService.MOTIVOS_MERMA;
  }

  // ---------- conteo cíclico ----------

  @Roles('deposito', 'gerente', 'dueno')
  @Post('conteos')
  crearConteo(@Body() dto: { sucursalId: string; sector?: string }, @Req() req: any) {
    return this.stock.crearConteo(dto, req.usuario?.sub);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Get('conteos')
  conteos() {
    return this.stock.conteosAbiertos();
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('conteos/:id/items')
  conteoItem(@Param('id') id: string, @Body() dto: { sku: string; cantidad: number }) {
    return this.stock.conteoCargarItem(id, dto);
  }

  // aplicar el conteo ajusta stock masivamente: exige supervisor. Gerencia se
  // autoriza sola; depósito necesita el token de un solo uso de /caja/autorizar
  // (nunca un autorizadoPor que mande el cliente directamente).
  @Roles('deposito', 'gerente', 'dueno')
  @Post('conteos/:id/finalizar')
  finalizarConteo(@Param('id') id: string, @Body() body: { autorizacionToken?: string }, @Req() req: any) {
    const autorizadoPor = autorizaSolo(req);
    if (!autorizadoPor && !body.autorizacionToken) {
      throw new ForbiddenException('Aplicar el conteo requiere autorización de un supervisor (PIN)');
    }
    return this.stock.finalizarConteo(id, autorizadoPor, body.autorizacionToken, req.usuario?.sub);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('conteos/:id/descartar')
  descartarConteo(@Param('id') id: string) {
    return this.stock.descartarConteo(id);
  }

  @Get('transferencias')
  transferencias() {
    return this.stock.transferenciasPendientes();
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('transferencias')
  transferencia(@Body() dto: TransferenciaDto, @Req() req: any) {
    // quién la manda sale del token (antes quedaba sin autor)
    return this.stock.crearTransferencia(dto, req.usuario?.sub);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('transferencias/:id/recibir')
  recibir(@Param('id') id: string, @Req() req: any) {
    // quién la recibe sale del token; la fecha la pone la base (recibida_en)
    return this.stock.recibirTransferencia(id, req.usuario?.sub);
  }

  // anular devuelve el stock al origen: solo gerencia (queda auditado)
  @Roles('gerente', 'dueno')
  @Post('transferencias/:id/anular')
  anularTransferencia(@Param('id') id: string, @Body() body: { motivo?: string }, @Req() req: any) {
    return this.stock.anularTransferencia(id, body.motivo, req.usuario?.sub);
  }
}
