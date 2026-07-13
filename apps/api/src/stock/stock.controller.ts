import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { StockService } from './stock.service';
import type { AjusteDto, TransferenciaDto } from './stock.service';
import { Roles } from '../auth/decorators';

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

  // Ajustes/mermas grandes exigen PIN de supervisor: gerencia se autoriza
  // sola, depósito necesita el token de /caja/autorizar (nunca confiar en un
  // autorizadoPor que mande el cliente).
  @Roles('deposito', 'gerente', 'dueno')
  @Post('ajustes')
  ajuste(@Body() dto: AjusteDto, @Req() req: any) {
    const autorizadoPor = req.usuario?.rol !== 'deposito' ? req.usuario?.sub : undefined;
    return this.stock.registrarAjuste({ ...dto, autorizadoPor }, 'ajuste', req.usuario?.sub);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('mermas')
  merma(@Body() dto: AjusteDto, @Req() req: any) {
    const autorizadoPor = req.usuario?.rol !== 'deposito' ? req.usuario?.sub : undefined;
    return this.stock.registrarAjuste({ ...dto, autorizadoPor }, 'merma', req.usuario?.sub);
  }

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
    const rol = req.usuario?.rol;
    const autorizadoPor = rol !== 'deposito' ? req.usuario?.sub : undefined;
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
  transferencia(@Body() dto: TransferenciaDto) {
    return this.stock.crearTransferencia(dto);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('transferencias/:id/recibir')
  recibir(@Param('id') id: string) {
    return this.stock.recibirTransferencia(id);
  }

  // anular devuelve el stock al origen: solo gerencia (queda auditado)
  @Roles('gerente', 'dueno')
  @Post('transferencias/:id/anular')
  anularTransferencia(@Param('id') id: string, @Body() body: { motivo?: string }, @Req() req: any) {
    return this.stock.anularTransferencia(id, body.motivo, req.usuario?.sub);
  }
}
